# shotloom-director-desk

A web workbench for 3D scene previsualization: stage sets and characters, plan motion and camera moves, edit a timeline, and export reference video.

**Block a scene, plan blocking and camera moves, export a reference video.**

A 3D previz tool for AI short films: place mannequins in a white-model set, work out where they stand and how they move, then hand the reference video and prompts to a video model.

![Shotloom Director Desk editor with its original procedural character](docs/images/shotloom-editor.png)

## Workflow

1. **Stage** — open the scene drawer and add mannequins, furniture, buildings and props, or import GLB / glTF / FBX / OBJ.
2. **Block** — add action clips and draw ground/surface paths; select a camera to set focal length, framing and a camera path.
3. **Export** — review from the director view, switch to the camera view, then export PNG or MP4 / WebM.

## Kept

- White-model scene, asset browser, model import, grid snapping
- Character actions, joint posing, motion paths
- Multi-camera, focal length, framing presets, camera paths, cuts
- Timeline playback, split, trim, zoom, camera and action tracks
- Director / camera view toggle
- PNG stills and MP4/WebM camera-move export
- Autosave and recovery

## Original character model

The default character is generated from original code and basic geometry. Its body parts use the same joints for poses and animation, with no external character model file.

## Current limitations

- Live phone-based camera control is not available yet.
- Image and panorama backgrounds, scene-root transforms, and ground transparency/height controls are not available yet.

## Development

```bash
npm install
npm run dev          # http://127.0.0.1:5173
npm run build
npm run typecheck    # types only
npm test             # unit tests (run npm run test:assets first on a clean checkout)
npm run test:assets  # download and verify the pinned test fixtures
npm run format       # format with Prettier (CI enforces format:check)
npm run smoke        # browser smoke test (requires npm run dev)
```

The UI is React 19 + Ant Design 6; the 3D engine and domain logic stay framework-free.

Formatting is owned by Prettier (`.prettierrc.json`: 4-space indent, single quotes, 120 columns). Run `npm run format` before committing.

## License

[MIT](LICENSE)
