# Shotloom 发布

日常功能开发无需修改 CI、Release 工作流或逐项列出新增功能。所有入口都构建当前源码，依赖由锁文件安装，发布说明由 GitHub 自动生成。

## 日常发布

提交功能后，创建并推送新版本标签：

```sh
git tag v0.2.0
git push origin v0.2.0
```

标签是本次发布的版本来源。工作流自动在临时构建目录同步 package.json、package-lock.json、Tauri 配置及 Cargo.toml/Cargo.lock，不要求先手改这些文件，也不向源分支提交自动修改。

也可以在 Actions → Release → Run workflow 中选择分支，填写 `v0.2.0`。留空时使用该分支 package.json 的版本。同名标签若已指向其他提交会被拒绝，不会移动已有标签。

预发布使用 `v0.2.0-beta.1` 等标签，自动标记为 prerelease，且不会替换稳定版 latest。不要重用已公开发布的版本；修复后发布新的版本号。GitHub 自动决定稳定版本的 Latest 顺序，回补旧版本不强制覆盖最新版本。

如需同步本地开发版本（可选）：

```sh
npm run release:version -- 0.2.0
```

## 自动执行的工作

- PR 和 main 提交：产品检查、Harness 测试、完整前端构建及打包运行时启动验证；macOS/Windows Rust 测试。
- Release：复用上述检查，再构建 macOS Apple Silicon、macOS Intel 和 Windows x64 安装包。
- 每个平台按本次构建产物生成清单，确认安装包及更新签名存在。
- 汇总所有目标，验证版本、文件完整性及 SHA-256，生成 `latest.json` 和 `SHA256SUMS`。
- 所有构建完成后才创建草稿 Release，上传完整文件，再公开发布。上传失败保留草稿，可对同一提交重新运行；已公开的 Release 不会被重写。

平台定义集中在 `scripts/release-targets.json`，Node 版本集中在 `.node-version`；OpenReel 的 pnpm 版本直接读取其 packageManager。仓库地址从 GitHub 运行环境读取。新增页面、节点、Skill、模型、资源或测试通常无需改工作流；若增加新的构建工具、原生依赖或操作系统支持，仍需更新相应构建配置。

构建和打包逻辑应维护在 package.json 与 scripts 中：`npm run verify:product` 是统一产品验收入口，Tauri 的 beforeBuildCommand 自动执行完整产品构建。Harness 运行时及内置内容每次从当前源码重新打包，不复用过期产物。

仓库迁移时还需更新应用的 updater endpoint（src-tauri/tauri.conf.json），让客户端知道到哪里检查更新；安装包更新地址由当前仓库自动生成。

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

## 首次运行

只需一次配置上面的 updater 签名密钥；GitHub Actions 使用仓库自动提供的 GITHUB_TOKEN，无需额外 PAT。Apple 签名证书可选，未配置时会明确提示并构建未公证的 macOS 安装包。

本地检查可以运行 `npm run verify:product`；CI 与 Release 的共享验收工作流位于 `.github/workflows/verify.yml`。
