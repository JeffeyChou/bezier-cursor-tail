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
  version, so a blob can be identified from a hexdump.
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
  `point-count-mismatch`, `bad-reference`, …) instead of drawing something plausible but wrong.
- Unknown field numbers are skipped, so newer files still load in older builds.

## What is not stored

- Undo/redo history. `snapshot()` saves the drawing, not the session.
- Whole-curve erasures. They are applied before saving, so erased strokes are
  simply absent.
- Sampling thresholds. Every stored sample already passed them, and replay runs
  with them set to 0.
