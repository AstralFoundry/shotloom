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

Shotloom keeps this source at the repository root alongside `vendor/openreel`.
`renderer/director-desk.html` uses the Vite `/vendor/storyai-3d-director-desk`
alias to load `src/main.tsx` in development and emit its own production bundle.
Root TypeScript and module-discipline checks still include this source. Product
code communicates only through `renderer/src/app/adapters/directorDeskBridge.ts`;
the directory move does not change the HTML URL, bridge protocol or asset URLs.

The source is MIT licensed; see `LICENSE`. The bundled UE mannequin model has
its own attribution and license in
`renderer/public/3d-director-desk/models/ue-mannequin-retopology.license.txt`.
