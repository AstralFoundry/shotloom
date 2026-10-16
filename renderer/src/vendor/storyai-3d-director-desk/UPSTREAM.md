# storyai-3d-director-desk

This directory contains readable source vendored from
[`jiguang132/storyai-3d-director-desk`](https://github.com/jiguang132/storyai-3d-director-desk)
at commit `8c8bd361790be4d37158a7430365e65546e358fe`.

The upstream application is embedded in its own Vite entry and iframe so its
global editor styles and runtime state cannot affect Shotloom. Local changes
are limited to the host bridge, lifecycle cleanup, asset paths, removal of
catalog entries whose files were not distributed upstream, and viewport
rasterization density: upstream pins the WebGL canvases to `dpr={0.75}` /
`dpr={1}`, which Shotloom renders as an upscaled, blurry image on Retina
displays, so they now clamp to the device pixel ratio (`[1, 2]`).

The source is MIT licensed; see `LICENSE`. The bundled UE mannequin model has
its own attribution and license in
`renderer/public/3d-director-desk/models/ue-mannequin-retopology.license.txt`.
