# Shotloom 发布

日常功能开发无需修改 CI、Release 工作流或逐项列出新增功能。所有入口都构建当前源码，依赖由锁文件安装，发布说明由 GitHub 自动生成。

## 日常发布

提交功能后，创建并推送新版本标签：

```sh
git tag v0.2.0
git push origin v0.2.0
```

标签可使用 `v0.2.0` 或 `0.2.0`；工作流保留实际标签名称，不自动添加前缀。标签是本次发布的版本来源。工作流自动在临时构建目录同步 package.json 与 package-lock.json，不要求先手改这些文件，也不向源分支提交自动修改。

也可以在 Actions → Release → Run workflow 中选择分支，填写 `v0.2.0`。留空时使用该分支 package.json 的版本。同名标签若已指向其他提交会被拒绝，不会移动已有标签。

预发布使用 `v0.2.0-beta.1` 等标签，自动标记为 prerelease，且不会替换稳定版 latest。不要重用已公开发布的版本；修复后发布新的版本号。GitHub 自动决定稳定版本的 Latest 顺序，回补旧版本不强制覆盖最新版本。

如需同步本地开发版本（可选）：

```sh
npm run release:version -- 0.2.0
```

## 自动执行的工作

- PR 和 main 提交：产品检查、Harness 测试、完整前端构建、Electron 主进程类型检查与真实启动冒烟；macOS/Windows 打包运行时验证。
- Release：复用上述检查，再用 electron-builder 构建 macOS Apple Silicon 和 Windows x64 安装包；不构建 Intel Mac 版本。
- 每个平台按本次构建产物生成清单，确认安装包、自动更新产物（zip/exe + blockmap）与 `latest*.yml` 更新元数据存在。
- 汇总所有目标，验证版本、文件完整性及 SHA-256，生成 `SHA256SUMS`；`latest*.yml` 保持原文件名，供 electron-updater 读取。
- 所有构建完成后才创建草稿 Release，上传完整文件，再公开发布。上传失败保留草稿，可对同一提交重新运行；已公开的 Release 不会被重写。

平台定义集中在 `scripts/release-targets.json`，Node 版本集中在 `.node-version`；OpenReel 的 pnpm 版本直接读取其 packageManager。仓库地址从 GitHub 运行环境读取。新增页面、节点、Skill、模型、资源或测试通常无需改工作流；若增加新的构建工具、原生依赖或操作系统支持，仍需更新相应构建配置。

构建和打包逻辑维护在 package.json 与 scripts 中：`npm run verify:product` 是统一产品验收入口，`npm run dist:electron` 执行渲染进程构建、主进程打包与 electron-builder 出包。Harness 运行时及内置内容每次从当前源码重新打包，不复用过期产物。

更新源由 `electron-builder.yml` 的 `publish` 配置决定（默认指向当前 GitHub 仓库的 Release）；客户端读取同一次发布的 `latest*.yml`，不需要额外的签名密钥。macOS 的自动更新依赖 Apple 代码签名，未配置签名凭据时只能手动安装新版本。

## Required repository settings

无需额外的 updater 私钥：electron-builder 为每个平台生成 `latest-mac.yml` / `latest.yml`，与安装包、blockmap 一起上传。GitHub Actions 使用仓库自动提供的 `GITHUB_TOKEN`，请确认 Release 工作流拥有 `contents: write` 权限。

## Optional Apple signing secrets

Configure all of the following to sign and notarize macOS artifacts:

- `APPLE_CERTIFICATE`: Base64-encoded Developer ID Application `.p12` certificate.
- `APPLE_CERTIFICATE_PASSWORD`: Password used when exporting the `.p12` certificate.
- `APPLE_SIGNING_IDENTITY`: Full certificate identity, for example `Developer ID Application: Example Inc. (TEAMID)`.
- `APPLE_ID`: Apple Developer account email address.
- `APPLE_PASSWORD`: App-specific password for that Apple ID.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The Apple account must be a paid Apple Developer Program account. Without all six values, the workflow builds ad-hoc signed artifacts (`CSC_IDENTITY_AUTO_DISCOVERY=false`) and verifies the complete app bundle before publishing. This signature preserves bundle integrity but does not establish an Apple-trusted developer identity or notarization; Gatekeeper can still block first launch, and automatic updates on macOS will not install.

电子签名使用 electron-builder 的 `CSC_NAME`（由 `APPLE_SIGNING_IDENTITY` 映射）与 `CSC_IDENTITY_AUTO_DISCOVERY`；公证尚未接入 electron-builder 配置，需要时在 `mac` 配置中添加 `notarize` 并传入 App Store Connect 凭据。

Encode the exported certificate without line breaks:

```sh
openssl base64 -A -in certificate.p12 -out certificate-base64.txt
```

Use the contents of `certificate-base64.txt` as `APPLE_CERTIFICATE`.

## 首次运行

无需配置 updater 签名密钥；GitHub Actions 使用仓库自动提供的 GITHUB_TOKEN，无需额外 PAT。Apple 签名证书可选，未配置时使用 ad-hoc 签名并校验整个应用包，安装包仍未公证，自动更新也不会在 macOS 上生效。

### 0.8.1 macOS 提示“已损坏，无法打开”

0.8.1 的 Mac 包只有可执行文件的链接器签名，缺少完整应用包的资源签名。对于确认从本仓库 Release 下载的 0.8.1，安装到 `/Applications` 后，可在终端修复本机副本：

```sh
codesign --force --deep --sign - /Applications/Shotloom.app
codesign --verify --deep --strict --verbose=2 /Applications/Shotloom.app
xattr -dr com.apple.quarantine /Applications/Shotloom.app
open /Applications/Shotloom.app
```

该操作只修改本机 Shotloom 副本，不关闭系统 Gatekeeper。后续版本在生成 DMG 和更新包前由 electron-builder 完成签名，并在 CI 校验；要让普通用户直接打开而无需手动处理，仍需配置上面的 Apple Developer ID 签名和公证凭据。

本地检查可以运行 `npm run verify:product`；CI 与 Release 的共享验收工作流位于 `.github/workflows/verify.yml`。
