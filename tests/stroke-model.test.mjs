import assert from 'node:assert/strict';
import test from 'node:test';
import {
  actualStrokeWidth,
  createStrokeModel,
  findStrokeOperationIndex,
  finishStrokeModel,
  getRenderableOperations,
  insertStrokePoint,
  quadraticBezierStroke,
  strokeLineWidth,
} from '../src/bezier-cursor-tail.js';

test('stroke model creates smoothed variable-width points', () => {
  const model = createStrokeModel({
    maxWidth: 12,
    minWidth: 1,
    minSampleMs: 0,
    minSampleDistance: 0,
  });

  assert.equal(insertStrokePoint(model, { x: 10, y: 10, time: 0 }), true);
  assert.equal(insertStrokePoint(model, { x: 40, y: 16, time: 30 }), true);
  assert.equal(insertStrokePoint(model, { x: 90, y: 42, time: 80 }), true);
  assert.ok(model.points.length > 3);
  assert.equal(model.points[0].w, 0.4);

  for (const point of model.points) {
    assert.ok(point.w >= 0.05);
    assert.ok(point.w <= 1);
  }
});

test('quadratic bezier stroke samples along a curved path', () => {
  const points = [{ x: 0, y: 0, w: 0.2 }];

  quadraticBezierStroke(
    points,
    { x: 0, y: 0, w: 0.2 },
    { x: 50, y: 100 },
    { x: 100, y: 0, w: 0.8 },
  );

  assert.ok(Math.abs(points.at(-1).x - 100) < 1e-9);
  assert.ok(Math.abs(points.at(-1).y - 0) < 1e-9);
  assert.ok(points.some((point) => point.y > 40));
});

test('speed controls normalized line width', () => {
  const slow = strokeLineWidth(
    { x: 0, y: 0, time: 0 },
    { x: 5, y: 0, time: 100 },
    0.4,
    { step: 0.2 },
  );
  const fast = strokeLineWidth(
    { x: 0, y: 0, time: 0 },
    { x: 90, y: 0, time: 10 },
    0.4,
    { step: 0.2 },
  );

  assert.ok(slow > fast);
});

test('finish stroke tapers the tail', () => {
  const model = createStrokeModel({
    minSampleMs: 0,
    minSampleDistance: 0,
  });

  insertStrokePoint(model, { x: 0, y: 0, time: 0 });
  insertStrokePoint(model, { x: 20, y: 5, time: 20 });
  finishStrokeModel(model, { x: 25, y: 6 });

  assert.equal(model.points.at(-1).w, 0.1);
  assert.ok(actualStrokeWidth(model, model.points.at(-1).w) < actualStrokeWidth(model, 0.4));
});

test('whole-curve eraser hit-tests continuous stroke operations', () => {
  const operations = [
    {
      id: 1,
      tool: 'pen',
      maxWidth: 8,
      minWidth: 1,
      canvasWidth: 200,
      canvasHeight: 100,
      points: [
        { x: 10, y: 10, w: 0.4 },
        { x: 90, y: 10, w: 0.4 },
      ],
    },
    {
      id: 2,
      tool: 'pen',
      maxWidth: 8,
      minWidth: 1,
      canvasWidth: 200,
      canvasHeight: 100,
      points: [
        { x: 10, y: 70, w: 0.4 },
        { x: 90, y: 70, w: 0.4 },
      ],
    },
  ];

  assert.equal(
    findStrokeOperationIndex(operations, { x: 50, y: 12 }, {
      canvasWidth: 200,
      canvasHeight: 100,
      radius: 4,
    }),
    0,
  );
  assert.equal(
    findStrokeOperationIndex(operations, { x: 50, y: 68 }, {
      canvasWidth: 200,
      canvasHeight: 100,
      radius: 4,
    }),
    1,
  );
  assert.equal(
    findStrokeOperationIndex(operations, { x: 50, y: 42 }, {
      canvasWidth: 200,
      canvasHeight: 100,
      radius: 4,
    }),
    -1,
  );
});

test('renderable operations apply whole-curve eraser actions', () => {
  const history = [
    { id: 1, tool: 'pen', points: [{ x: 0, y: 0, w: 0.4 }] },
    { id: 2, tool: 'pen', points: [{ x: 10, y: 10, w: 0.4 }] },
    { type: 'erase-stroke', targetId: 1 },
  ];

  assert.deepEqual(
    getRenderableOperations(history).map((operation) => operation.id),
    [2],
  );
});
