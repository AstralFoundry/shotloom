# Publishing a desktop release

Pushing a `v*` tag runs the release workflow. It publishes notarized macOS DMGs for Apple Silicon and Intel Macs, plus a Windows x64 NSIS installer, to a GitHub Release. Workflow artifacts are retained for one day and used only to transfer files between build and publish jobs; end users download the native files from the Release page.

## Required repository secrets

Configure these in **Settings → Secrets and variables → Actions** before pushing a release tag:

- `APPLE_CERTIFICATE`: Base64-encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: Password used when exporting the `.p12` certificate.
- `APPLE_SIGNING_IDENTITY`: Full certificate identity, for example `Developer ID Application: Example Inc. (TEAMID)`.
- `APPLE_ID`: Apple Developer account email address.
- `APPLE_PASSWORD`: App-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The Apple account must be a paid Apple Developer Program account. A free account cannot notarize macOS applications.

Encode the exported certificate without line breaks:

```sh
openssl base64 -A -in certificate.p12 -out certificate-base64.txt
```

Use the contents of `certificate-base64.txt` as `APPLE_CERTIFICATE`.

## Publish

Ensure the version in `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` is the release version, then create and push the matching tag:

```sh
git tag v0.1.2
git push origin v0.1.2
```

The workflow intentionally fails the macOS jobs if signing or notarization credentials are absent. It does not upload unsigned macOS applications as successful release assets.
