# Bezier Cursor Tail

Dependency-free browser code for a smooth cursor tail and hand-written canvas strokes. The core stroke model is extracted from Maliang Deck's presenter runtime, where it powers the laser pointer trail and popup whiteboard brush.

The implementation uses pointer speed to estimate stroke width, then samples a quadratic bezier curve between pointer events. Rendering is deliberately simple: the generated points are drawn as short line segments whose widths vary along the path.

## Run The Demo

```sh
npm run serve
```

Open `http://127.0.0.1:5173/`.

The demo uses ES modules, so serve it over HTTP instead of opening `index.html` directly from the filesystem.

### [Live Demo](https://jeffeychou.github.io/bezier-cursor-tail/)

## Publish The Demo With GitHub Pages

This repository includes a GitHub Actions workflow at `.github/workflows/pages.yml`. It stages the static demo files into `_site` and deploys them to GitHub Pages whenever `main` is updated.

To enable the live demo:

1. Push this repository to GitHub.
2. Open the repository on GitHub.
3. Go to `Settings` -> `Pages`.
4. Under `Build and deployment`, set `Source` to `GitHub Actions`.
5. Push to `main`, or run `Deploy demo to GitHub Pages` manually from the `Actions` tab.

For `https://github.com/JeffeyChou/bezier-cursor-tail`, the demo URL will be:

```text
https://jeffeychou.github.io/bezier-cursor-tail/
```

The first deployment may take a minute or two after the workflow succeeds.

## Use The Stroke Model

```js
import {
  createStrokeModel,
  insertStrokePoint,
  finishStrokeModel,
  drawStrokePoints,
} from './src/bezier-cursor-tail.js';

const model = createStrokeModel({
  color: '#111827',
  maxWidth: 8,
  minWidth: 1,
  minSampleMs: 8,
  minSampleDistance: 2,
});

insertStrokePoint(model, { x: 10, y: 10, time: performance.now() });
insertStrokePoint(model, { x: 40, y: 16, time: performance.now() + 16 });
finishStrokeModel(model, { x: 45, y: 18 });
drawStrokePoints(ctx, model.points, model);
```

## Use The Browser Helpers

```js
import { BezierCanvasBrush, BezierCursorTail } from './src/bezier-cursor-tail.js';

const brush = new BezierCanvasBrush(document.querySelector('canvas'), {
  color: '#111827',
  size: 5,
});

const tail = new BezierCursorTail({
  color: '#ef4444',
  enabled: true,
});
```

`BezierCanvasBrush` handles pointer events, high-DPI canvas sizing, undo, redo, clear, pixel erasing, whole-curve erasing, and responsive redraws.

Set the canvas brush tool to:

- `pen`: draw a new variable-width stroke.
- `eraser`: erase pixels with a variable-width eraser stroke.
- `stroke-eraser`: remove one whole continuous stroke when the pointer hits it.

`BezierCursorTail` creates a fixed SVG overlay and a glowing pointer dot. Hold the primary pointer button and move to generate the fading bezier trail.

## API Surface

- `createStrokeModel(options)`: creates mutable stroke state.
- `insertStrokePoint(model, point)`: adds a pointer sample and returns `true` when new renderable points were generated.
- `finishStrokeModel(model, point)`: tapers the end of a stroke.
- `quadraticBezierStroke(points, begin, control, end, options)`: samples a quadratic bezier path into variable-width points.
- `strokeLineWidth(begin, end, beginWidth, options)`: computes normalized width from pointer speed.
- `findStrokeOperationIndex(operations, point, options)`: hit-tests rendered stroke operations for whole-curve erasing.
- `getRenderableOperations(history)`: resolves draw and whole-curve erase actions into visible stroke operations.
- `drawStrokePoints(ctx, points, model, startIndex)`: renders generated points to canvas.
- `BezierCanvasBrush`: ready-to-use handwriting canvas controller with undo/redo, pixel erasing, and whole-curve erasing.
- `BezierCursorTail`: ready-to-use SVG cursor tail controller.

The demo binds `Ctrl+Z` and `Cmd+Z` to `brush.undo()`.

## Source

This repo is derived from Maliang Deck's `runtime/runtime.js` laser pointer and whiteboard brush code. It packages that bezier cursor-tail and handwriting stroke logic as a small standalone browser library.

## License

MIT. See [LICENSE](./LICENSE).
