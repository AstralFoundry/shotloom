# Third-party notices

Shotloom's original code is licensed under the MIT License in `LICENSE`.
Third-party code, dependencies and assets retain their own copyrights and
licenses. The project license does not replace those terms.

The following notices cover integrated source projects and selected bundled
assets. Other dependencies retain the license notices supplied in their packages;
this document is not a complete dependency inventory.

## OpenReel

Source: https://github.com/Augani/openreel-video
Local source: `vendor/openreel/`
License: MIT. The upstream license is preserved in `vendor/openreel/LICENSE`.

MIT License

Copyright (c) 2024-2026 Augustus Otu and Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Shotloom Director Desk

Source: https://github.com/AstralFoundry/shotloom-director-desk
Local source: `vendor/shotloom-director-desk/`
License: MIT. The upstream license is preserved in
`vendor/shotloom-director-desk/LICENSE`.

MIT License

Copyright (c) 2026 DirectorDesk contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## three.js face-cap mannequin derivative

`renderer/public/models/facecap-mannequin.glb` derives from the three.js face-cap
example model. Its texture was removed for a neutral mannequin preview.
The original attribution is preserved in
`renderer/public/models/facecap-mannequin.glb.LICENSE.md`.

Source: https://github.com/mrdoob/three.js

MIT License

Copyright © 2010-2024 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Director Desk motion library

The bundled motion library derives from Quaternius Universal Animation Library,
Standard collection, under CC0-1.0.

Source: https://quaternius.com/packs/universalanimationlibrary.html
License: https://creativecommons.org/publicdomain/zero/1.0/

The attribution and description of modifications are preserved in
`vendor/shotloom-director-desk/src/core/animation/library/NOTICE.txt`.

## FFmpeg

The desktop distribution includes a separate FFmpeg executable. Its GPL license
and source information are prepared by `scripts/prepare-media-sidecar.mjs` and
included in the desktop resources as `FFmpeg-GPL-3.0.txt` and `FFmpeg-SOURCE.txt`.
Those terms remain separate from Shotloom's MIT License.
