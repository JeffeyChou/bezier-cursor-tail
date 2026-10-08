# The stroke format

How a drawing is saved, ported from folio's ink format (`docs/INK.md` there).

## The idea

- **Store the input, not the output.** Save the pointer samples each stroke
  accepted, plus the brush rule. The bezier polyline and its widths are rebuilt
  at load time by `replayStroke`.
- The old in-memory history kept the **expanded polyline with a width per
  point**. Measured on 20 synthetic strokes: 1,468 samples became 14,306
  points, which is 824 KB of JSON.
- Saved as samples in this format, the same drawing is **5.3 KB: 155× smaller,
  about 3.6 bytes per sample**. Roughly 16× comes from not storing the derived
  points, and about 10× from the encoding.
  `tests/stroke-format.test.mjs` fails if it ever drops below 100×.

## What is stored

| Field | Encoding |
| --- | --- |
| x, y samples | 1/10 px integers, delta, zigzag, varint, interleaved |
| time | whole ms, rebased to 0, delta, zigzag, varint |
| `tapered` | the last point is the pointer-up position passed to `finishStrokeModel` |
| brush rule | `createStrokeModel` options × 1000, saved with the drawing so later default changes do not alter it |
| canvas anchor | `double` width and height, used as the redraw scale |
| tool, color | `pen` or `eraser`, CSS color string |
| framing | about 6 B: two length prefixes, the point count, the taper flag |

- **Tool, color, brush and canvas live in shared tables.** `Drawing.styles`
  and `Drawing.anchors` are deduplicated by their encoded bytes, and each
  stroke stores only two indices. Index 0 is proto3's default and costs nothing.
  Repeating them on every stroke cost 45 of its 55 fixed bytes. The fixed cost
  per stroke is now about 8.5 B, and the tables are paid once (about 30 B per
  distinct style, 20 B per canvas size).

- Schema: `stroke-format.proto`. The encoder is hand-written in
  `src/stroke-format.js`, with no dependencies.
- An 8-byte envelope starts with the magic bytes `BCTS` plus a container
  version, so a blob can be identified from a hexdump. Byte 5 holds flags.

## Compression

- `deflateDrawing` deflates the body after the envelope and sets flag bit 0;
  `inflateDrawing` reverses it, and passes uncompressed containers through.
- **Why it helps:** a varint spends at least one byte per value, but most values
  here (time deltas of 14–19 ms, small dx/dy) come from a handful of distinct
  bytes. Huffman coding packs them into a few bits each.
- On the 20-stroke fixture, deflate takes **5,278 B down to 4,350 B (−18%)**.
  Short, regular strokes compress better: a 5-stroke demo drawing went from
  724 B to 363 B.
- It is container in, container out, so `encodeDrawing`/`decodeDrawing` stay
  synchronous. Only this step is async, because `CompressionStream` is. Browsers
  and Node share that API, so there is still one code path.
- If deflate would not make the file smaller, the plain container is kept.
- `decodeDrawing` on a compressed container fails as `compressed`, and an
  unknown flag bit fails as `unsupported-container`.
- **Compressed bytes are not canonical.** Two deflate implementations may emit
  different bytes for the same body. Byte-identity holds for the inflated
  container. The body is plain deflate-raw, so another language needs only a
  stock zlib to read it (tested with Node's `zlib`).
- `tests/conformance.test.mjs` checks the bytes in both directions with
  protobufjs. **If that test is ever deleted, delete the `.proto` with it.**

## Where this differs from folio

- **There is a time channel.** Folio has none, because its width depends only on
  distance. Here width is `distance / elapsed ms`, so time is a real input.
- **The renderer is kept.** Folio switched to Catmull-Rom. This repo keeps the
  midpoint quadratic bezier, because replaying the samples through the same
  model reproduces it exactly.
- **Grids are decimal, not powers of two.** Capture already snaps to 0.1 px, and
  `q / 10` gives back exactly the double that capture produced. Brush values use
  1/1000, so `0.4` round-trips as `0.4`.
- **The canvas anchor is a `double`.** Layout widths come in 1/64 px
  (Chromium) or 1/60 px (Firefox). Snapping them to 0.1 px made the redraw scale
  0.99998 and moved every stroke on undo.

## Invariants (all tested)

- Replaying the samples gives `points` that are bit-identical to the live
  stroke.
- `decode(encode(snapshot))` deep-equals `snapshot`.
- `encode(decode(bytes))` is byte-identical to `bytes`.
- Capture snaps to the storage grid (`capturePoint`, `snapToGrid`), so a
  save/reload cycle is a fixed point.
- In a real browser, live drawing, redraw after undo/redo, and reload from
  storage give pixel-identical canvases.
- Bad input fails with a named reason (`bad-magic`, `truncated`,
  `point-count-mismatch`, `bad-reference`, `bad-compression`, …) instead of drawing something plausible but wrong.
- Unknown field numbers are skipped, so newer files still load in older builds.

## What is not stored

- Undo/redo history. `snapshot()` saves the drawing, not the session.
- Whole-curve erasures. They are applied before saving, so erased strokes are
  simply absent.
- Sampling thresholds. Every stored sample already passed them, and replay runs
  with them set to 0.
