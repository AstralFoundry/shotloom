# Tauri → Electron 迁移

分支：`feat/electron-migration`（从 `develop` 切出）。中间提交可以落在这个分支上，**不推送远程**。

## 目标

桌面壳从 Tauri（Rust + WKWebView）换成 Electron（Node 主进程 + Chromium 渲染进程），
同时对用户可见的行为保持不变：同一份 `~/.config`/Application Support 数据、同一套 IPC
命令与错误信封、同一份菜单文案、同一套媒体 URL 语义。

渲染进程产品代码基本不动：只把 `@tauri-apps/*` 的 import 换成 `renderer/src/desktop/*`
这一层同形传输层。

## 结构

```
electron/
  main.ts            # 应用启动：窗口、自定义 scheme、协议、对话框、窗口控制、IPC 注册
  preload.ts         # window.shotloomDesktop：invoke / listen / Channel / convertFileSrc
  core/
    paths.ts         # 用户数据目录（与 Tauri 相同的 com.shotloom.app）
    db.ts            # node:sqlite 打开/迁移/事务；表结构与 sea-orm 实体逐列对齐
    storage.ts       # 设置、目录、最近项目、恢复/剪贴板记录、窗口绑定
    projectStorage.ts# project.sqlite 的工程读写、画布快照、编辑快照
    files.ts         # 文件路径工具、媒体/可执行边界、分块 sha256
    menu.ts          # 原生菜单（词条来自 i18n 的 native.menu.*）
    errors.ts        # shotloom:localized-error 信封
  ipc/
    registry.ts      # invoke 通道注册表（命令名与参数沿用 Tauri 契约）
    commands/*.ts    # 按领域拆分的命令实现，对应 src-tauri/src/commands/*.rs

renderer/src/desktop/
  core.ts            # invoke / Channel / convertFileSrc
  event.ts           # listen
  dialog.ts          # open / save
  window.ts          # getCurrentWindow
  updater.ts         # check + Update（version/body/download/install）
  process.ts         # relaunch
  types.ts           # preload 暴露的桥类型（window.shotloomDesktop）
```

## 契约约定

- **命令名与参数名**直接沿用 Tauri：`invoke('file_write', { path, data, append })`。
  `renderer/src/services/tauriApi.ts` 里的 `command()` 映射表不需要改。
- **错误**：handler 抛出的字符串/`Error.message` 会原样作为 invoke 的拒绝值（和 Tauri 一样是字符串），
  所以 `localizeNativeError` 仍按 `shotloom:localized-error` 信封解析。
- **事件**：`emitEvent(webContents, name, payload)` → 渲染进程 `listen(name, cb)`。
- **Channel**：`Channel` 实例序列化为 `{ __shotloomChannelId }`，主进程用
  `emitChannel(webContents, id, payload)` 回推。
- **本地文件 URL**：`convertFileSrc(path)` → `shotloom://asset/<urlencoded path>`；
  渲染页面本身走 `shotloom://app/index.html`（standard scheme，CSP 的 `'self'` 与
  localStorage/Worker 才成立）。协议支持 Range，视频拖动可用。
- **用户数据**：`~/Library/Application Support/com.shotloom.app/{app.sqlite,project.sqlite,...}`，
  与 Tauri 版本完全一致；数据库版本迁移逻辑（v1→v2→v3）已按 Rust 实现逐条移植。

## 已迁移（当前状态）

- Electron 主进程/preload、开发启动（`npm run dev:electron`）、冒烟验证（`npm run smoke:electron` / `smoke:electron:prod`）。
- 设置 / 存储目录 / 最近项目 / 项目默认根目录 / 项目树 / 工程读写 / 画布快照 / 编辑快照。
- 文件基础通道（读写、复制、校验和、唯一路径、回收站、在文件夹中显示、打开路径）。
- 媒体与图像：`file_probe_media`、`file_read_image_preview`、`file_crop_image`、
  `file_apply_colored_pencil`、`file_capture_video_frame`、`file_concat_videos`、
  `file_has_audio`、`file_separate_audio`、`media_task_cancel`、资源包导入/导出（ffmpeg + fflate）。
- 生成网关：`generation_request` / `generation_stream` / `generation_download` /
  `generation_cancel`（凭据注入、作用域 URL、主机边界、multipart、流式事件）。
- 项目包：`project_export_package` / `project_import_package`（流式 ZIP、清单、路径重写、20k 文件 / 20GB 上限）。
- 厂商插件：`provider_plugins`（list/search/inspect/install/documentation/index/configure/
  enable/remove/rollback）、`provider_plugin_call`、`provider_plugin_cancel`（发行包 provisioning、
  子进程宿主、变更事件）。
- Harness：`harness_*`（spawn agent host、stdio transport、本地工具桥、会话绑定/归档、Channel 回推）。
- 恢复日志、工作流剪贴板、诊断包。
- 导出：`openreel_export_*`、`file_export_video_project`。
- 打包：`electron-builder.yml` + `npm run dist:electron`；打包后 App 已用真实冒烟验证
  （渲染进程、媒体探测、插件发行包、项目读写、Agent Host 启动/就绪/停止）。

## 已删除的 Tauri 面

- `src-tauri/` 整体删除；`scripts/tauri.mjs`、`shotloom.yml` 的 Tauri 覆盖函数、
  `@tauri-apps/*` 依赖全部移除，`npm run dev` 现在直接启动 Electron。
- 打包资源生成到 `electron/resources/`（agent-host、provider-plugins、ffmpeg 与许可文件），
  `electron/build/icons/` 存放应用图标。
- 发布流水线改为 electron-builder 产物：`scripts/desktop-release.mjs` 同步 npm 版本、
  按平台收齐安装包/更新包/`latest*.yml`/blockmap 并校验 SHA-256；workflow 使用
  electron-builder 构建，由同一个 publish job 上传。
- 测试里针对 Rust 的契约断言已改写为对 Electron 实现的断言（CSP、原生安全边界、
  存储纪律、恢复心跳、项目包、导出、发布脚本、i18n 文案键覆盖）。

## 待完成

1. 更新器：`shotloom:update-check` / `download` / `install` 目前仍返回"未配置"。
   计划接入 electron-updater：`electron-builder.yml` 已声明 GitHub publish，
   需要实现检查/下载进度/退出安装，并在设置页验证真实升级路径。
2. macOS 公证与自动更新：electron-builder 的 `notarize` 尚未接入；没有 Apple 签名时
   macOS 自动更新不可用（安装包可以手动安装）。
3. Windows/Linux 打包未在真机验证；`agent-host` 资源含完整 node_modules（约 488MB），
   可按生产依赖裁剪。
4. 系统代理：生成网关的 Node fetch 不读取 `HTTPS_PROXY`/macOS `scutil`，需要显式
   proxy agent 才能和原 Rust 实现行为一致。

## 验证

- `npm run typecheck`（渲染进程）与 `npm run typecheck:electron`（主进程）。
- `npm test`：881 个测试；原生桥测试通过 `tests/helpers/desktopBridge.mjs` 伪造 preload。
- `npm run smoke:electron`：开发模式真实启动 Electron，断言：
  页面渲染、`settings_get`、项目建库/保存/读取/快照、项目包导出/导入、最近项目、
  诊断包、媒体探测与预览（真实 ffmpeg）、厂商插件发行包（32 个）、Agent Host 启动/就绪/停止。
  用户数据写到 `tmp/electron-smoke/`，每次从空目录开始。
- `npm run smoke:electron:prod`：同上，但从 `dist/renderer` 通过 `shotloom://app` 加载，
  验证生产协议与 CSP。
- `npm run dist:electron`：electron-builder 产出；`release/mac-arm64/Shotloom.app` 可用
  `env -u ELECTRON_RUN_AS_NODE SHOTLOOM_SMOKE=1 .../Contents/MacOS/Shotloom` 冒烟。

## 环境注意事项

- 本机 `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化为 Node；`scripts/electron-dev.mjs`
  启动 GUI 前会删掉这个变量。
- `node:sqlite` 在 Electron 44（Node 24.22）上可用；数据库路径仍按绝对路径传，
  避免 `?`/`#` 被当成 URI 选项。
- Electron 二进制若因网络无法下载，可手动解压 `~/Library/Caches/electron/**/*.zip`
  到 `node_modules/electron/dist`（本机即如此）。
