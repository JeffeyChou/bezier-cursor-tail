import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BezierCanvasBrush,
  createStrokeModel,
  finishStrokeModel,
  insertStrokePoint,
  replayStroke,
} from '../src/bezier-cursor-tail.js';
import {
  StrokeDecodeError,
  StrokeEncodeError,
  base64ToBytes,
  bytesToBase64,
  decodeDrawing,
  deflateDrawing,
  encodeDrawing,
  inflateDrawing,
} from '../src/stroke-format.js';
import { draw, fakeCanvas, strokeEvents } from './helpers.mjs';

function drawing({ strokes = 6, seed = 1 } = {}) {
  // A layout width off any decimal grid, as Chromium reports them.
  const canvas = fakeCanvas({ width: 1165.078125, height: 678.03125 });
  const brush = new BezierCanvasBrush(canvas, { color: '#2563eb', size: 7 });
  for (let i = 0; i < strokes; i += 1) {
    if (i === strokes - 1) brush.setOptions({ tool: 'eraser' });
    draw(brush, strokeEvents(seed + i));
  }
  return brush;
}

function reasonOf(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof StrokeDecodeError, `expected StrokeDecodeError, got ${error}`);
    return error.reason;
  }
  assert.fail('should have thrown');
}

test('the samples alone rebuild the curve the brush drew, bit for bit', () => {
  const brush = drawing();
  const live = brush.getRenderableOperations();

  const restored = new BezierCanvasBrush(fakeCanvas());
  restored.load(decodeDrawing(encodeDrawing(brush.snapshot())));
  const loaded = restored.getRenderableOperations();

  assert.equal(loaded.length, live.length);
  for (let i = 0; i < live.length; i += 1) {
    assert.deepEqual(loaded[i].points, live[i].points);
    assert.equal(loaded[i].tool, live[i].tool);
    assert.equal(loaded[i].color, live[i].color);
  }
  assert.equal(loaded.at(-1).tool, 'eraser');
});

test('decode then encode is byte-identical', () => {
  const bytes = encodeDrawing(drawing().snapshot());
  assert.deepEqual(encodeDrawing(decodeDrawing(bytes)), bytes);
});

test('a save and reload is a fixed point of snapshot()', () => {
  const brush = drawing();
  const snapshot = brush.snapshot();
  assert.deepEqual(decodeDrawing(encodeDrawing(snapshot)), snapshot);
});

test('whole-curve erasures are applied, not stored', () => {
  const brush = drawing({ strokes: 3 });
  brush.history.push({ type: 'erase-stroke', targetId: brush.history[0].id });
  const decoded = decodeDrawing(encodeDrawing(brush.snapshot()));
  assert.equal(decoded.length, 2);
});

test('a single-click dot round-trips without a taper', () => {
  const model = createStrokeModel({ minSampleMs: 0, minSampleDistance: 0 });
  insertStrokePoint(model, { x: 12.3, y: 45.6, time: 0 });
  const [dot] = decodeDrawing(encodeDrawing([{ ...model, canvasWidth: 100, canvasHeight: 100 }]));
  assert.equal(dot.end, null);
  assert.deepEqual(replayStroke(dot).points, model.points);
});

test('replay ignores the sampling thresholds the live model applied', () => {
  const live = createStrokeModel({ minSampleMs: 8, minSampleDistance: 2 });
  for (let i = 0; i < 40; i += 1) {
    insertStrokePoint(live, { x: i * 1.5, y: Math.sin(i / 4) * 20, time: i * 5 });
  }
  finishStrokeModel(live, { x: 61, y: 3, time: 205 });
  assert.ok(live.samples.length < 40, 'the live filter should have dropped samples');
  assert.deepEqual(replayStroke(live).points, live.points);
});

test('a field number this build does not know is skipped', () => {
  const bytes = encodeDrawing(drawing({ strokes: 2 }).snapshot());
  // Field 99, varint 42: tag 792 is the two-byte varint 0x98 0x06.
  const extended = new Uint8Array([...bytes, 0x98, 0x06, 42]);
  assert.deepEqual(decodeDrawing(extended), decodeDrawing(bytes));
});

test('corrupt input fails with a name, never as a plausible wrong drawing', () => {
  const bytes = encodeDrawing(drawing({ strokes: 2 }).snapshot());

  assert.equal(reasonOf(() => decodeDrawing(bytes.subarray(0, 5))), 'truncated');
  assert.equal(reasonOf(() => decodeDrawing(bytes.subarray(0, bytes.length - 3))), 'truncated');

  const wrongMagic = bytes.slice();
  wrongMagic[0] = 0x00;
  assert.equal(reasonOf(() => decodeDrawing(wrongMagic)), 'bad-magic');

  const newerContainer = bytes.slice();
  newerContainer[4] = 2;
  assert.equal(reasonOf(() => decodeDrawing(newerContainer)), 'unsupported-container');

  // A one-stroke file ends with that stroke's last two fields:
  // point_count (tag 0x28, one-byte count) and tapered (tag 0x30, value 1).
  // Lie about the count in both directions.
  const one = encodeDrawing(drawing({ strokes: 1 }).snapshot());
  const count = one.length - 3;
  assert.deepEqual([one[count - 1], one[count + 1], one[count + 2]], [0x28, 0x30, 1]);
  assert.ok(one[count] < 127);

  const more = one.slice();
  more[count] += 1;
  assert.equal(reasonOf(() => decodeDrawing(more)), 'truncated');
  const fewer = one.slice();
  fewer[count] -= 1;
  assert.equal(reasonOf(() => decodeDrawing(fewer)), 'point-count-mismatch');
});

test('style and canvas are stored once per distinct value, not per stroke', () => {
  const brush = drawing({ strokes: 20, seed: 100 });
  const snapshot = brush.snapshot();
  const geometryOnly = encodeDrawing(snapshot.map((s) => ({ samples: s.samples, end: s.end }))).length;
  const full = encodeDrawing(snapshot).length;
  // Two styles (pen and eraser) and one canvas, whatever the stroke count.
  assert.ok(full - geometryOnly < 100, `${full - geometryOnly} B of shared tables`);
});

test('a coordinate that would wrap is refused at encode time', () => {
  assert.throws(
    () => encodeDrawing([{ samples: [{ x: 2 ** 28, y: 0, time: 0 }], canvasWidth: 1, canvasHeight: 1 }]),
    StrokeEncodeError,
  );
});

test('base64 round-trips every tail length', () => {
  const bytes = encodeDrawing(drawing({ strokes: 2 }).snapshot());
  for (const n of [0, 1, 2, 3, 4, bytes.length]) {
    const slice = bytes.subarray(0, n);
    assert.deepEqual(base64ToBytes(bytesToBase64(slice)), slice);
  }
  assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
});

/**
 * The regression guard on the whole point of the format. The baseline is the
 * history this library kept before: the expanded bezier polyline with a width
 * per point, as JSON. Asserted rather than reported, so the day someone stores
 * a derived array again a test fails instead of a drawing quietly growing.
 */
test('a drawing costs a small fraction of its JSON history', () => {
  const brush = drawing({ strokes: 20, seed: 100 });
  const legacy = JSON.stringify(brush.getRenderableOperations().map((operation) => ({
    id: operation.id,
    tool: operation.tool,
    color: operation.color,
    maxWidth: operation.maxWidth,
    minWidth: operation.minWidth,
    canvasWidth: operation.canvasWidth,
    canvasHeight: operation.canvasHeight,
    points: operation.points,
  }))).length;
  const bytes = encodeDrawing(brush.snapshot()).length;
  const samples = brush.snapshot().reduce((n, s) => n + s.samples.length + (s.end ? 1 : 0), 0);

  assert.ok(bytes * 100 < legacy, `${bytes} B vs ${legacy} B of JSON`);
  assert.ok(bytes / samples < 5, `${(bytes / samples).toFixed(2)} B per sample`);
});

test('deflate round-trips to the exact uncompressed container', async () => {
  const bytes = encodeDrawing(drawing({ strokes: 20, seed: 100 }).snapshot());
  const packed = await deflateDrawing(bytes);

  assert.equal(packed[5] & 1, 1, 'FLAG_DEFLATE is set');
  assert.ok(packed.length < bytes.length * 0.9, `${packed.length} B vs ${bytes.length} B`);
  assert.deepEqual(await inflateDrawing(packed), bytes);
  assert.deepEqual(await deflateDrawing(packed), packed, 'deflating twice is a no-op');
});

test('an uncompressed container passes through inflate', async () => {
  const bytes = encodeDrawing(drawing({ strokes: 2 }).snapshot());
  assert.equal(await inflateDrawing(bytes), bytes);
});

test('deflate keeps the plain container when it would not be smaller', async () => {
  const bytes = encodeDrawing([]);
  assert.equal(await deflateDrawing(bytes), bytes);
});

test('compressed input fails by name rather than as garbage', async () => {
  const packed = await deflateDrawing(encodeDrawing(drawing({ strokes: 4 }).snapshot()));
  assert.equal(reasonOf(() => decodeDrawing(packed)), 'compressed');

  const corrupt = packed.slice(0, 8 + 10);
  await assert.rejects(
    inflateDrawing(corrupt),
    (error) => error instanceof StrokeDecodeError && error.reason === 'bad-compression',
  );

  const unknownFlag = encodeDrawing([]);
  unknownFlag[5] = 2;
  assert.equal(reasonOf(() => decodeDrawing(unknownFlag)), 'unsupported-container');
});
