# Publishing a desktop release

Pushing a `v*` tag runs the release workflow. It publishes macOS DMGs for Apple Silicon and Intel Macs, a Windows x64 NSIS installer, the signed updater packages, and `latest.json` to a GitHub Release. When Apple credentials are configured, macOS artifacts are signed and notarized; otherwise they are published unsigned with a workflow warning. Workflow artifacts are retained for one day and used only to transfer files between build and publish jobs; end users download the native files from the Release page or through the in-app updater.

## Required repository secret

Configure these in **Settings → Secrets and variables → Actions** before pushing a release tag:

- `TAURI_SIGNING_PRIVATE_KEY`: Private key corresponding to `plugins.updater.pubkey` in `src-tauri/tauri.conf.json`. Tauri uses it to sign updater artifacts.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: Password for the private key. This secret may be omitted when the key was generated without a password.

If the existing private key is available, copy its complete contents into `TAURI_SIGNING_PRIVATE_KEY`. Do not generate a replacement while leaving the old public key in `tauri.conf.json`; signatures made by that replacement would fail verification in the application.

If the existing private key has been lost, generate a new pair locally:

  ```sh
  npm run tauri signer generate -- --write-keys /tmp/shotloom-updater.key
  cat /tmp/shotloom-updater.key
  cat /tmp/shotloom-updater.key.pub
  ```

Copy the private key into the `TAURI_SIGNING_PRIVATE_KEY` repository secret, set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` if one was used, and replace `plugins.updater.pubkey` with the complete public key from `/tmp/shotloom-updater.key.pub`. Commit the public-key change before publishing. Keep the private key secure or delete the local file after configuring the secret.

## Optional Apple signing secrets

Configure all of the following to sign and notarize macOS artifacts:

- `APPLE_CERTIFICATE`: Base64-encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: Password used when exporting the `.p12` certificate.
- `APPLE_SIGNING_IDENTITY`: Full certificate identity, for example `Developer ID Application: Example Inc. (TEAMID)`.
- `APPLE_ID`: Apple Developer account email address.
- `APPLE_PASSWORD`: App-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The Apple account must be a paid Apple Developer Program account. Without all six values, the workflow still publishes macOS artifacts, but they are unsigned and unnotarized and macOS Gatekeeper warns users before first launch.

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

The publish job also requires one signed updater package for each supported target. It fails instead of publishing an empty or incomplete `latest.json` when an updater signature is missing.
