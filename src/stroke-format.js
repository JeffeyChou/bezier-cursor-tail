/**
 * The binary stroke format: a drawing saved as input samples, not as curves.
 *
 * Ported from folio's `@folio/ink`. `BezierCanvasBrush#snapshot()` produces the
 * plain stroke data this encodes, and `BezierCanvasBrush#load()` takes what it
 * decodes; `replayStroke` turns one decoded stroke back into renderable points.
 * The schema is `stroke-format.proto` at the repository root, and
 * `tests/conformance.test.mjs` checks these bytes against it.
 *
 * Only proto3 wire types 0 (varint), 2 (length-delimited) and, for the canvas
 * anchor, 1 (a little-endian double) are written, which is the whole reason a
 * hand-written codec is reasonable here rather than reckless. No dependencies:
 * the same code runs in the browser and in Node.
 */
import { BRUSH_GRID, CAPTURE_GRID } from './bezier-cursor-tail.js';

/** ASCII "BCTS": Bezier Cursor Tail Strokes. */
const MAGIC = Uint8Array.from([0x42, 0x43, 0x54, 0x53]);
const ENVELOPE_BYTES = 8;

export const STROKE_CONTAINER_VERSION = 1;
export const STROKE_FORMAT_VERSION = 1;

/** Integer units per CSS px: the grid `pointFromEvent` already captures on. */
export const STROKE_QUANT = CAPTURE_GRID;

export const MIDPOINT_QUADRATIC_SPEED_V1 = 0;

/**
 * A coordinate past this is a bug upstream. Zigzag below is 32-bit, and
 * silently wrapping would store the stroke somewhere else on the canvas.
 */
const MAX_QUANTIZED = 2 ** 30;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LEN = 2;
const WIRE_FIXED32 = 5;

const TOOL_CODE = { pen: 0, eraser: 1 };

/* ------------------------------ errors ------------------------------ */

/**
 * Decode failures are a closed set, so a caller can say what was wrong rather
 * than "bad input":
 * bad-magic | unsupported-container | unsupported-format | truncated |
 * overlong-varint | bad-wire-type | point-count-mismatch | quant-zero |
 * bad-reference
 */
export class StrokeDecodeError extends Error {
  constructor(reason, detail) {
    super(detail ? `${reason}: ${detail}` : reason);
    this.name = 'StrokeDecodeError';
    this.reason = reason;
  }
}

export class StrokeEncodeError extends Error {
  constructor(detail) {
    super(detail);
    this.name = 'StrokeEncodeError';
  }
}

/* ------------------------------ bytes ------------------------------ */

const zigzag = (n) => (n << 1) ^ (n >> 31);
const unzigzag = (n) => (n >>> 1) ^ -(n & 1);

class ByteWriter {
  #buf = new Uint8Array(256);
  #len = 0;

  /** A view, not a copy. Valid until the next write. */
  bytes() {
    return this.#buf.subarray(0, this.#len);
  }

  u8(value) {
    this.#reserve(1);
    this.#buf[this.#len++] = value & 0xff;
  }

  /**
   * Base-128 varint. Division rather than `>>> 7` because the shift operators
   * truncate to 32 bits, and a length prefix is allowed to exceed that.
   */
  varint(value) {
    if (!Number.isInteger(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
      throw new StrokeEncodeError(`varint out of range: ${value}`);
    }
    this.#reserve(10);
    let n = value;
    while (n > 0x7f) {
      this.#buf[this.#len++] = (n % 128) | 0x80;
      n = Math.floor(n / 128);
    }
    this.#buf[this.#len++] = n;
  }

  f64(value) {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    this.raw(bytes);
  }

  raw(src) {
    this.#reserve(src.length);
    this.#buf.set(src, this.#len);
    this.#len += src.length;
  }

  #reserve(need) {
    if (this.#len + need <= this.#buf.length) return;
    let size = this.#buf.length;
    while (size < this.#len + need) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.#buf.subarray(0, this.#len));
    this.#buf = next;
  }
}

class ByteReader {
  #buf;
  #end;
  #pos;

  constructor(buf, start = 0, end = buf.length) {
    this.#buf = buf;
    this.#pos = start;
    this.#end = end;
  }

  get done() {
    return this.#pos >= this.#end;
  }

  get remaining() {
    return this.#end - this.#pos;
  }

  varint() {
    let result = 0;
    let scale = 1;
    for (let read = 0; read < 10; read += 1) {
      if (this.#pos >= this.#end) throw new StrokeDecodeError('truncated');
      const byte = this.#buf[this.#pos++];
      result += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) {
        if (result > Number.MAX_SAFE_INTEGER) throw new StrokeDecodeError('overlong-varint');
        return result;
      }
      scale *= 128;
    }
    throw new StrokeDecodeError('overlong-varint');
  }

  f64() {
    const view = this.take(8);
    return new DataView(view.buffer, view.byteOffset, 8).getFloat64(0, true);
  }

  /** A view, not a copy. */
  take(length) {
    if (length < 0 || this.#pos + length > this.#end) throw new StrokeDecodeError('truncated');
    const view = this.#buf.subarray(this.#pos, this.#pos + length);
    this.#pos += length;
    return view;
  }

  skipBytes(length) {
    this.take(length);
  }
}

/* ------------------------------ proto3 ------------------------------ */

function tag(w, field, wire) {
  w.varint((field << 3) | wire);
}

/** proto3 omits fields at their default, and so must we, or the bytes differ from protoc's. */
function u32(w, field, value) {
  if (!value) return;
  tag(w, field, WIRE_VARINT);
  w.varint(value);
}

function f64(w, field, value) {
  if (!value) return;
  tag(w, field, WIRE_FIXED64);
  w.f64(value);
}

function lenBytes(w, field, value) {
  tag(w, field, WIRE_LEN);
  w.varint(value.length);
  w.raw(value);
}

/**
 * A nested message, length-prefixed. Always emitted, even when every field is
 * at its default: a decoder that finds no anchor cannot tell "absent" from
 * "all zero", and encode -> decode -> encode has to be byte-identical.
 */
function message(w, field, fill) {
  const sub = new ByteWriter();
  fill(sub);
  lenBytes(w, field, sub.bytes());
}

function readHeader(r) {
  const key = r.varint();
  return { field: key >>> 3, wire: key & 7 };
}

/**
 * Skip a field this build does not know. An unknown field NUMBER is skipped
 * silently, which is what lets a later version add one without a flag day. An
 * unknown wire TYPE throws: 3 and 4 are deprecated groups and 6 and 7 do not
 * exist, so seeing one means the bytes are corrupt, not newer.
 */
function skip(r, wire) {
  switch (wire) {
    case WIRE_VARINT: r.varint(); return;
    case WIRE_FIXED64: r.skipBytes(8); return;
    case WIRE_LEN: r.skipBytes(r.varint()); return;
    case WIRE_FIXED32: r.skipBytes(4); return;
    default: throw new StrokeDecodeError('bad-wire-type', `wire type ${wire}`);
  }
}

function subMessage(r, wire) {
  if (wire !== WIRE_LEN) {
    throw new StrokeDecodeError('bad-wire-type', `expected a message, got wire type ${wire}`);
  }
  return new ByteReader(r.take(r.varint()));
}

/* ------------------------------ codec ------------------------------ */

/**
 * Encode the strokes `BezierCanvasBrush#snapshot()` returns. Each needs
 * `samples` ({x, y, time}) and may carry `end`; a derived `points` array is
 * ignored, because it is exactly what this format exists not to store.
 *
 * Tool, color, brush and canvas are the same for nearly every stroke, so they
 * go into two drawing-level tables, deduplicated by their encoded bytes, and a
 * stroke holds only indices. Index 0 is proto3's default and costs nothing.
 */
export function encodeDrawing(strokes, { quant = STROKE_QUANT } = {}) {
  if (!Number.isInteger(quant) || quant <= 0) {
    throw new StrokeEncodeError(`quant must be a positive integer, got ${quant}`);
  }

  const styles = new Table();
  const anchors = new Table();
  const encoded = strokes.map((stroke) => {
    const points = stroke.end ? [...stroke.samples, stroke.end] : stroke.samples;
    const w = new ByteWriter();
    u32(w, 1, styles.intern(styleBytes(stroke)));
    u32(w, 2, anchors.intern(anchorBytes(stroke)));
    lenBytes(w, 3, deltas(points, quant, ['x', 'y']));
    lenBytes(w, 4, deltas(points, 1, ['time']));
    u32(w, 5, points.length);
    u32(w, 6, stroke.end ? 1 : 0);
    return w.bytes().slice();
  });

  const body = new ByteWriter();
  u32(body, 1, STROKE_FORMAT_VERSION);
  u32(body, 2, quant);
  // Tables first, so a reader streaming the strokes already has them. The
  // decoder does not rely on it: proto fields may arrive in any order.
  for (const style of styles.entries) lenBytes(body, 4, style);
  for (const anchor of anchors.entries) lenBytes(body, 5, anchor);
  for (const stroke of encoded) lenBytes(body, 3, stroke);

  const out = new ByteWriter();
  out.raw(MAGIC);
  out.u8(STROKE_CONTAINER_VERSION);
  out.u8(0); // flags; bit 0 reserved for a future compression scheme
  out.u8(0);
  out.u8(0);
  out.raw(body.bytes());
  return out.bytes().slice();
}

class Table {
  entries = [];
  #index = new Map();

  intern(bytes) {
    const key = bytes.join(',');
    let index = this.#index.get(key);
    if (index === undefined) {
      index = this.entries.length;
      this.entries.push(bytes);
      this.#index.set(key, index);
    }
    return index;
  }
}

function styleBytes(stroke) {
  const w = new ByteWriter();
  u32(w, 1, TOOL_CODE[stroke.tool] ?? 0);
  if (stroke.color) lenBytes(w, 2, new TextEncoder().encode(stroke.color));
  message(w, 3, (b) => {
    u32(b, 1, MIDPOINT_QUADRATIC_SPEED_V1);
    u32(b, 2, scaled(stroke.maxWidth, BRUSH_GRID, 'maxWidth'));
    u32(b, 3, scaled(stroke.minWidth, BRUSH_GRID, 'minWidth'));
    u32(b, 4, scaled(stroke.initialWidth, BRUSH_GRID, 'initialWidth'));
    u32(b, 5, scaled(stroke.endWidth, BRUSH_GRID, 'endWidth'));
    u32(b, 6, scaled(stroke.maxSpeed, BRUSH_GRID, 'maxSpeed'));
    u32(b, 7, scaled(stroke.widthDiffStep, BRUSH_GRID, 'widthDiffStep'));
    u32(b, 8, scaled(stroke.bezierStep, BRUSH_GRID, 'bezierStep'));
  });
  return w.bytes().slice();
}

function anchorBytes(stroke) {
  const w = new ByteWriter();
  f64(w, 1, finite(stroke.canvasWidth, 'canvasWidth'));
  f64(w, 2, finite(stroke.canvasHeight, 'canvasHeight'));
  return w.bytes().slice();
}

/** The inverse of `encodeDrawing`: plain stroke data, ready for `BezierCanvasBrush#load()`. */
export function decodeDrawing(bytes) {
  if (bytes.length < ENVELOPE_BYTES) throw new StrokeDecodeError('truncated', 'shorter than the envelope');
  for (let i = 0; i < MAGIC.length; i += 1) {
    if (bytes[i] !== MAGIC[i]) throw new StrokeDecodeError('bad-magic');
  }
  if (bytes[4] !== STROKE_CONTAINER_VERSION) {
    throw new StrokeDecodeError('unsupported-container', `container version ${bytes[4]}`);
  }

  let formatVersion = 0;
  let quant = 0;
  // Strokes are resolved after the loop, because `quant` and the tables may
  // legally arrive after them: proto fields can come in any order.
  const raw = [];
  const styles = [];
  const anchors = [];
  const reader = new ByteReader(bytes, ENVELOPE_BYTES);
  while (!reader.done) {
    const { field, wire } = readHeader(reader);
    if (field === 1) formatVersion = reader.varint();
    else if (field === 2) quant = reader.varint();
    else if (field === 3) raw.push(readStroke(subMessage(reader, wire)));
    else if (field === 4) styles.push(readStyle(subMessage(reader, wire)));
    else if (field === 5) anchors.push(readAnchor(subMessage(reader, wire)));
    else skip(reader, wire);
  }

  if (formatVersion !== STROKE_FORMAT_VERSION) {
    throw new StrokeDecodeError('unsupported-format', `format version ${formatVersion}`);
  }
  if (!quant) throw new StrokeDecodeError('quant-zero');

  return raw.map((stroke) => {
    const style = styles[stroke.style];
    const anchor = anchors[stroke.anchor];
    if (!style) throw new StrokeDecodeError('bad-reference', `style ${stroke.style} of ${styles.length}`);
    if (!anchor) throw new StrokeDecodeError('bad-reference', `anchor ${stroke.anchor} of ${anchors.length}`);

    const xy = undelta(stroke.xy, stroke.count, 2, quant);
    const t = undelta(stroke.t, stroke.count, 1, 1);
    const points = [];
    for (let i = 0; i < stroke.count; i += 1) {
      points.push({ x: xy[i * 2], y: xy[i * 2 + 1], time: t[i] });
    }
    if (stroke.tapered && !points.length) {
      throw new StrokeDecodeError('point-count-mismatch', 'tapered stroke with no points');
    }
    return {
      tool: style.tool === 1 ? 'eraser' : 'pen',
      color: style.color,
      canvasWidth: anchor.width,
      canvasHeight: anchor.height,
      maxWidth: style.brush.maxWidth / BRUSH_GRID,
      minWidth: style.brush.minWidth / BRUSH_GRID,
      initialWidth: style.brush.initialWidth / BRUSH_GRID,
      endWidth: style.brush.endWidth / BRUSH_GRID,
      maxSpeed: style.brush.maxSpeed / BRUSH_GRID,
      widthDiffStep: style.brush.widthDiffStep / BRUSH_GRID,
      bezierStep: style.brush.bezierStep / BRUSH_GRID,
      samples: stroke.tapered ? points.slice(0, -1) : points,
      end: stroke.tapered ? points[points.length - 1] : null,
    };
  });
}

const BRUSH_FIELDS = [null, 'id', 'maxWidth', 'minWidth', 'initialWidth', 'endWidth',
  'maxSpeed', 'widthDiffStep', 'bezierStep'];

function readStyle(r) {
  const style = {
    tool: 0,
    color: '',
    brush: {
      id: 0, maxWidth: 0, minWidth: 0, initialWidth: 0, endWidth: 0,
      maxSpeed: 0, widthDiffStep: 0, bezierStep: 0,
    },
  };
  while (!r.done) {
    const { field, wire } = readHeader(r);
    if (field === 1) style.tool = r.varint();
    else if (field === 2) style.color = new TextDecoder().decode(r.take(r.varint()));
    else if (field === 3) {
      const sub = subMessage(r, wire);
      while (!sub.done) {
        const inner = readHeader(sub);
        const name = BRUSH_FIELDS[inner.field];
        if (name) style.brush[name] = sub.varint();
        else skip(sub, inner.wire);
      }
    } else skip(r, wire);
  }
  return style;
}

function readAnchor(r) {
  const anchor = { width: 0, height: 0 };
  while (!r.done) {
    const { field, wire } = readHeader(r);
    if (field === 1 && wire === WIRE_FIXED64) anchor.width = r.f64();
    else if (field === 2 && wire === WIRE_FIXED64) anchor.height = r.f64();
    else skip(r, wire);
  }
  return anchor;
}

function readStroke(r) {
  const stroke = {
    style: 0,
    anchor: 0,
    xy: new Uint8Array(0),
    t: new Uint8Array(0),
    count: 0,
    tapered: false,
  };
  while (!r.done) {
    const { field, wire } = readHeader(r);
    switch (field) {
      case 1: stroke.style = r.varint(); break;
      case 2: stroke.anchor = r.varint(); break;
      case 3: stroke.xy = r.take(r.varint()); break;
      case 4: stroke.t = r.take(r.varint()); break;
      case 5: stroke.count = r.varint(); break;
      case 6: stroke.tapered = r.varint() !== 0; break;
      default: skip(r, wire);
    }
  }
  return stroke;
}

function finite(value, label) {
  const n = value ?? 0;
  if (!Number.isFinite(n) || n < 0) throw new StrokeEncodeError(`${label} out of range: ${value}`);
  return n;
}

function scaled(value, scale, label) {
  const q = Math.round((value ?? 0) * scale);
  if (!Number.isFinite(q) || q < 0 || q > MAX_QUANTIZED) {
    throw new StrokeEncodeError(`${label} out of range: ${value}`);
  }
  return q;
}

/** Interleave the named channels of `points`, delta + zigzag + varint. */
function deltas(points, scale, keys) {
  const w = new ByteWriter();
  const previous = keys.map(() => 0);
  for (const point of points) {
    keys.forEach((key, i) => {
      const q = Math.round(point[key] * scale);
      if (!Number.isFinite(q) || Math.abs(q) > MAX_QUANTIZED) {
        throw new StrokeEncodeError(`${key} out of range: ${point[key]}`);
      }
      w.varint(zigzag(q - previous[i]));
      previous[i] = q;
    });
  }
  return w.bytes().slice();
}

/** The inverse of `deltas`: `count` points of `lanes` interleaved channels, flattened. */
function undelta(bytes, count, lanes, scale) {
  const reader = new ByteReader(bytes);
  const out = new Array(count * lanes);
  const previous = new Array(lanes).fill(0);
  for (let i = 0; i < out.length; i += 1) {
    const lane = i % lanes;
    previous[lane] += unzigzag(reader.varint());
    out[i] = previous[lane] / scale;
  }
  // Trailing bytes mean the writer and `point_count` disagree. Refusing here is
  // the difference between a loud failure and a plausible-looking wrong drawing.
  if (!reader.done) {
    throw new StrokeDecodeError('point-count-mismatch', `${reader.remaining} trailing byte(s)`);
  }
  return out;
}

/* ------------------------------ base64 ------------------------------ */

/**
 * Base64, written out rather than delegated, so a drawing can sit in
 * localStorage or JSON and the text is the same whichever host produced it.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const REVERSE = (() => {
  const table = new Int16Array(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i += 1) table[ALPHABET.charCodeAt(i)] = i;
  return table;
})();

export function bytesToBase64(bytes) {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    out += ALPHABET[(n >>> 18) & 63] + ALPHABET[(n >>> 12) & 63] + ALPHABET[(n >>> 6) & 63] + ALPHABET[n & 63];
  }
  const left = bytes.length - i;
  if (left === 1) {
    const n = bytes[i] << 16;
    out += `${ALPHABET[(n >>> 18) & 63]}${ALPHABET[(n >>> 12) & 63]}==`;
  } else if (left === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out += `${ALPHABET[(n >>> 18) & 63]}${ALPHABET[(n >>> 12) & 63]}${ALPHABET[(n >>> 6) & 63]}=`;
  }
  return out;
}

export function base64ToBytes(text) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 61 /* = */) end -= 1;
  const length = Math.floor((end * 3) / 4);
  const out = new Uint8Array(length);

  let accumulator = 0;
  let bits = 0;
  let cursor = 0;
  for (let i = 0; i < end; i += 1) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? REVERSE[code] : -1;
    if (value < 0) throw new StrokeDecodeError('truncated', `not base64 at offset ${i}`);
    accumulator = (accumulator << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[cursor++] = (accumulator >>> bits) & 0xff;
    }
  }
  return cursor === length ? out : out.subarray(0, cursor);
}
