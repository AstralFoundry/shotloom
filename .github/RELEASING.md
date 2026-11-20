# Shotloom 发布

日常功能开发无需修改 CI、Release 工作流或逐项列出新增功能。所有入口都构建当前源码，依赖由锁文件安装，发布说明由 GitHub 自动生成。

云端与原生 App 的开发和发布基线为 `AstralFoundry/shotloom` 的 `supabase` 分支；PR 目标选择 `supabase`。本地保留 fork 为 `origin` 时，向上游推送使用 `upstream`。迁移仓库后，Actions 的签名及镜像凭据需要在上游仓库单独配置。`supabase` 提交及以它为目标的 PR 不自动运行 CI，可手动触发检查；Android 预览仍由功能分支或手动触发，配置 Android 签名凭据后再启用该分支自动出包。

## 日常发布

提交功能后，创建并推送新版本标签：

```sh
git tag v0.2.0
git push upstream v0.2.0
```

标签可使用 `v0.2.0` 或 `0.2.0`；工作流保留实际标签名称，不自动添加前缀。标签是本次发布的版本来源。工作流自动在临时构建目录同步 package.json、package-lock.json、Tauri 配置及 Cargo.toml/Cargo.lock，不要求先手改这些文件，也不向源分支提交自动修改。

也可以在 Actions → Release → Run workflow 中选择分支，填写 `v0.2.0`。留空时使用该分支 package.json 的版本。同名标签若已指向其他提交会被拒绝，不会移动已有标签。

预发布使用 `v0.2.0-beta.1` 等标签，自动标记为 prerelease，且不会替换稳定版 latest。不要重用已公开发布的版本；修复后发布新的版本号。GitHub 自动决定稳定版本的 Latest 顺序，回补旧版本不强制覆盖最新版本。

如需同步本地开发版本（可选）：

```sh
npm run release:version -- 0.2.0
```

## 自动执行的工作

- PR（目标为 supabase 除外）和 main 提交：产品检查、Harness 测试、完整前端构建及打包运行时启动验证；macOS/Windows Rust 测试。
- Release：复用上述检查，再构建 macOS Apple Silicon、Windows x64 安装包、Android ARM64 APK 和未签名 iOS ARM64 IPA；不构建 Intel Mac 版本。
- 每个平台按本次构建产物生成清单，确认安装包及更新签名存在。
- 汇总所有目标，验证版本、文件完整性及 SHA-256，生成 `latest.json` 和 `SHA256SUMS`。
- 所有构建完成后才创建草稿 Release，上传完整文件，再公开发布。上传失败保留草稿，可对同一提交重新运行；已公开的 Release 不会被重写。

## Android 和 iOS 包

移动端入口位于 `mobile/src-tauri/`，使用独立的轻量 Tauri 应用打开云端页面，不包含桌面 Node、FFmpeg、桌面 IPC 或本机数据库。默认服务地址为 `https://shotloom.0xfiang.com`，可通过仓库 Actions variable `SHOTLOOM_CLOUD_URL` 指定其他 HTTPS origin。移动包需要网络和已部署的云端服务；发布前须同步部署本次前端，确保包含移动端运行环境适配。

版本 tag 会同时构建并上传：

- `android-aarch64-Shotloom.apk`：Android 8.0 及以上 ARM64 设备使用的 release APK，经 zipalign、固定密钥签名与 apksigner 验签，可以侧载安装；不自动发布到 Google Play。
- `ios-aarch64-unsigned-Shotloom.ipa`：iOS 15 及以上 ARM64 真机架构的未签名 IPA，使用 `ios build --no-sign` 构建，无需 Apple Developer Program。它不能直接在 iPhone 安装，也不会自动上传 TestFlight 或 App Store；分发前需自行完成签名与 provisioning。

Android 签名使用仓库 Secrets：

- `ANDROID_KEYSTORE_BASE64`：PKCS12/JKS 密钥库的 Base64 内容，key alias 固定为 `shotloom`。
- `ANDROID_KEYSTORE_PASSWORD`：密钥库和 key 的共同密码。

必须持续使用同一 Android 签名密钥，否则已安装用户无法直接覆盖升级。初始化时生成的密钥库备份存放于配置者本机 Codex signing 目录，密码使用 Windows DPAPI 加密保存；不要将密钥或密码提交到仓库。

移动包与桌面包一同完成后才公开 GitHub Release，缺少任一平台或校验失败都会阻止发布。所有移动包都计入 `SHA256SUMS`，`latest.json` 只列出支持桌面自动更新的平台。`TAURI_SIGNING_PRIVATE_KEY` 是整套 Release 的必需配置，它用于桌面更新签名，与苹果开发者证书无关。

平台定义集中在 `scripts/release-targets.json`，Node 版本集中在 `.node-version`；OpenReel 的 pnpm 版本直接读取其 packageManager。仓库地址从 GitHub 运行环境读取。新增页面、节点、Skill、模型、资源或测试通常无需改工作流；若增加新的构建工具、原生依赖或操作系统支持，仍需更新相应构建配置。

构建和打包逻辑应维护在 package.json 与 scripts 中：`npm run verify:product` 是统一产品验收入口，Tauri 的 beforeBuildCommand 自动执行完整产品构建。Harness 运行时及内置内容每次从当前源码重新打包，不复用过期产物。

仓库迁移时还需更新应用的 updater endpoint（src-tauri/tauri.conf.json），让客户端知道到哪里检查更新；安装包更新地址由当前仓库自动生成。

## 容器镜像发布

推送任意 tag 会触发独立的 Container 工作流；它不依赖桌面端签名密钥。产品、原生端和服务端检查全部通过后，工作流使用本次验收生成的前端产物和 `server/Dockerfile` 构建 Linux amd64 镜像，推送到：

```text
crpi-045itdvshm4mk2lq.cn-beijing.personal.cr.aliyuncs.com/aigc-work/shotloom:<tag>
```

例如推送 `v0.9.2` 会发布 `shotloom:v0.9.2`。镜像标签由 docker/metadata-action 将 Git tag 规范化为 Docker 允许的格式，建议使用 `vX.Y.Z` 或 `vX.Y.Z-beta.N`。仅发布版本标签，不自动覆盖 `latest`。

仓库 Settings → Secrets and variables → Actions 需要配置 `ACR_USERNAME` 与 `ACR_PASSWORD`（阿里云镜像仓库登录账号和密码）。密码只用于镜像登录，不写入构建参数或镜像。运行时配置仍在部署端通过 `server/.env` 注入，参见 `server/.env.example`。

```sh
git tag v0.9.2
git push upstream v0.9.2
```

创建 tag 前必须先提交工作流、`server/Dockerfile`、`.dockerignore` 及其依赖源码；CI 只能构建 tag 指向的已提交内容。同一版本 tag 也可能触发现有桌面 Release 流程，其签名配置和结果独立。

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

The Apple account must be a paid Apple Developer Program account. Without all six values, the workflow uses an ad-hoc signature (`APPLE_SIGNING_IDENTITY=-`) and verifies the complete app bundle before publishing. This signature preserves bundle integrity but does not establish an Apple-trusted developer identity or notarization; Gatekeeper can still block first launch.

Encode the exported certificate without line breaks:

```sh
openssl base64 -A -in certificate.p12 -out certificate-base64.txt
```

Use the contents of `certificate-base64.txt` as `APPLE_CERTIFICATE`.

## 首次运行

只需一次配置上面的 updater 签名密钥；GitHub Actions 使用仓库自动提供的 GITHUB_TOKEN，无需额外 PAT。Apple 签名证书可选，未配置时使用 ad-hoc 签名并校验整个应用包，安装包仍未公证。Updater 签名只用于应用更新校验，不能替代 Apple 代码签名和公证。

### 0.8.1 macOS 提示“已损坏，无法打开”

0.8.1 的 Mac 包只有可执行文件的链接器签名，缺少完整应用包的资源签名。对于确认从本仓库 Release 下载的 0.8.1，安装到 `/Applications` 后，可在终端修复本机副本：

```sh
codesign --force --deep --sign - /Applications/Shotloom.app
codesign --verify --deep --strict --verbose=2 /Applications/Shotloom.app
xattr -dr com.apple.quarantine /Applications/Shotloom.app
open /Applications/Shotloom.app
```

该操作只修改本机 Shotloom 副本，不关闭系统 Gatekeeper。后续版本在生成 DMG 和更新包前由 Tauri 完成签名，并在 CI 校验；要让普通用户直接打开而无需手动处理，仍需配置上面的 Apple Developer ID 签名和公证凭据。

本地检查可以运行 `npm run verify:product`；CI 与 Release 的共享验收工作流位于 `.github/workflows/verify.yml`。
