# storyai-3d-director-desk

This directory contains readable source vendored from
[`jiguang132/storyai-3d-director-desk`](https://github.com/jiguang132/storyai-3d-director-desk)
at commit `8c8bd361790be4d37158a7430365e65546e358fe`.

The upstream application is embedded in its own Vite entry and iframe so its
global editor styles and runtime state cannot affect Shotloom. Local changes
are limited to the host bridge, lifecycle cleanup, asset paths, and removal of
catalog entries whose files were not distributed upstream.

The source is MIT licensed; see `LICENSE`. The bundled UE mannequin model has
its own attribution and license in
`renderer/public/3d-director-desk/models/ue-mannequin-retopology.license.txt`.
