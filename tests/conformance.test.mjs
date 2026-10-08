/**
 * The test that keeps stroke-format.proto honest.
 *
 * The bytes come from a hand-written encoder, so the schema file is a claim
 * rather than a build input. This parses our output with a real protobuf
 * implementation, and parses a real implementation's output with ours.
 *
 * If this test is ever deleted, delete stroke-format.proto with it.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { inflateRawSync } from 'node:zlib';
import protobuf from 'protobufjs';
import { BezierCanvasBrush } from '../src/bezier-cursor-tail.js';
import {
  StrokeDecodeError,
  STROKE_FORMAT_VERSION,
  STROKE_QUANT,
  decodeDrawing,
  deflateDrawing,
  encodeDrawing,
} from '../src/stroke-format.js';
import { draw, fakeCanvas, strokeEvents } from './helpers.mjs';

const ENVELOPE_BYTES = 8;
const PROTO_PATH = fileURLToPath(new URL('../stroke-format.proto', import.meta.url));
const root = await protobuf.load(PROTO_PATH);
const Drawing = root.lookupType('bezier_cursor_tail.stroke.v1.Drawing');

const brush = new BezierCanvasBrush(fakeCanvas({ width: 1165.078125, height: 480 }), { color: '#e11d48', size: 6 });
draw(brush, strokeEvents(7));
brush.setOptions({ tool: 'eraser' });
draw(brush, strokeEvents(8, { moves: 12 }));
const snapshot = brush.snapshot();

test('protobufjs parses our output field for field', () => {
  const bytes = encodeDrawing(snapshot);
  const parsed = Drawing.toObject(Drawing.decode(bytes.subarray(ENVELOPE_BYTES)), {
    defaults: true,
    enums: String,
  });

  assert.equal(parsed.formatVersion, STROKE_FORMAT_VERSION);
  assert.equal(parsed.quant, STROKE_QUANT);
  assert.equal(parsed.strokes.length, 2);
  assert.equal(parsed.styles.length, 2);
  assert.equal(parsed.anchors.length, 1);

  const [pen, eraser] = parsed.strokes;
  assert.equal(pen.style, 0);
  assert.equal(eraser.style, 1);
  assert.equal(eraser.anchor, 0);

  const [penStyle, eraserStyle] = parsed.styles;
  assert.equal(penStyle.tool, 'TOOL_PEN');
  assert.equal(eraserStyle.tool, 'TOOL_ERASER');
  assert.equal(penStyle.color, '#e11d48');
  assert.equal(penStyle.brush.maxWidthM, 6000);
  assert.equal(penStyle.brush.minWidthM, 1080);
  assert.equal(penStyle.brush.initialWidthM, 400);
  assert.equal(penStyle.brush.maxSpeedM, 2000);
  assert.equal(parsed.anchors[0].width, 1165.078125);
  assert.equal(parsed.anchors[0].height, 480);

  assert.equal(pen.pointCount, snapshot[0].samples.length + 1);
  assert.equal(pen.tapered, true);
  assert.ok(pen.xy.length > 0 && pen.t.length > 0);
});

test('we read what protobufjs writes', () => {
  const ours = encodeDrawing(snapshot);
  const theirs = Drawing.encode(Drawing.decode(ours.subarray(ENVELOPE_BYTES))).finish();
  const withEnvelope = new Uint8Array([...ours.subarray(0, ENVELOPE_BYTES), ...theirs]);

  assert.deepEqual(decodeDrawing(withEnvelope), snapshot);
});

test('a stroke pointing past the tables fails as a bad reference', () => {
  const ours = encodeDrawing(snapshot);
  const message = Drawing.decode(ours.subarray(ENVELOPE_BYTES));
  message.strokes[0].style = 5;
  const theirs = Drawing.encode(message).finish();
  const withEnvelope = new Uint8Array([...ours.subarray(0, ENVELOPE_BYTES), ...theirs]);

  assert.throws(
    () => decodeDrawing(withEnvelope),
    (error) => error instanceof StrokeDecodeError && error.reason === 'bad-reference',
  );
});

test('a compressed body is plain deflate-raw around the same message', async () => {
  const plain = encodeDrawing(snapshot);
  const packed = await deflateDrawing(plain);
  // Inflated by zlib rather than by our own inflateDrawing, so another
  // language only needs a stock deflate library to read these files.
  const body = inflateRawSync(packed.subarray(ENVELOPE_BYTES));
  assert.deepEqual(new Uint8Array(body), plain.subarray(ENVELOPE_BYTES));
  assert.equal(Drawing.decode(body).strokes.length, 2);
});
