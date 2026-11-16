# Canvas regression and performance fixture

The fixture in `tests/fixtures/canvas-benchmark.html` renders the real WorkflowCanvas and generation cards with synthetic, local-only content. It never submits generation tasks or writes a project. Its clip probe uses the real detached editor mounting hook, without loading a media engine.

Start Vite from the repository root:

```sh
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5197
```

Open `http://127.0.0.1:5197/@fs/<absolute-repository-path>/tests/fixtures/canvas-benchmark.html?nodes=200`. Repeat with 12, 200 and 1000 nodes. This HTML is a test fixture outside the production build inputs.

## Checks

- The first three nodes are selected. Choose **对齐与分布 → 顶部对齐**: their Y coordinates become 0. **Undo** restores 0, 30 and 60. Distribution needs at least three selected objects. Selected sections carry their members through the existing canvas controller.
- **Preview snapshot** opens a read-only graph. Pan and zoom the preview, then close it: the live graph must be unchanged. Snapshot media comes from the snapshot's own material table.
- **Measure zoom** dispatches 60 pinch (Ctrl+wheel) frames and reports frame intervals, React commit duration, mounted node count, optional browser heap size, and cold/cached input-index time. Image content is synthetic; video decoding, disk I/O and generation are not represented. Development-mode timings are diagnostics, not production FPS claims.
- `await window.canvasBenchmark.stability()` checks 24 frames after the last wheel update. `maximumLateWidthChange` and `maximumClipMismatch` should be at most 1 screen pixel. It covers text, image, video and detached clip geometry. The maximum comparison should also be checked visually while wheeling in both directions.

## Current rendering decisions

All live nodes remain mounted. Eligible offscreen card interiors use browser `content-visibility: auto`; selected, resizing, playing, director, clip and section content remains fully rendered. Input relationship indexing is reused while only zoom changes. Wheel cancellation uses a native non-passive listener with canvas/input boundaries.

The temporary viewport-transform/idle-commit approach was evaluated and withdrawn after visible scale jumps, including double scaling of the detached clip editor. The final implementation retains continuous semantic geometry updates. Do not reintroduce delayed geometry commits without validating all card types and detached mounts during the transition, not just after settling.

Regression commands:

```sh
node --test tests/canvas-*.test.mjs tests/project-version-history.test.mjs tests/project-snapshot.test.mjs
npm run typecheck
npm run check:layers
npm run check:styles
npm run check:ui
```
