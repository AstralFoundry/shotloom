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

- Electron 主进程/preload、开发启动（`npm run dev:electron`）、冒烟验证（`npm run smoke:electron`）。
- 设置 / 存储目录 / 最近项目 / 项目默认根目录 / 项目树 / 工程读写 / 画布快照 / 编辑快照。
- 文件基础通道（读写、复制、校验和、唯一路径、回收站、在文件夹中显示、打开路径）。
- 原生菜单、窗口控制、文件对话框、CSP 相关协议。
- 渲染进程传输层替换（不再 import `@tauri-apps/*`）。

## 待迁移（按依赖顺序）

1. 媒体/图像：`file_probe_media`、`file_read_image_preview`、`file_crop_image`、
   `file_apply_colored_pencil`、`file_capture_video_frame`、`file_concat_videos`、
   `file_has_audio`、`file_separate_audio`、`media_task_cancel`（ffmpeg sidecar）。
2. 生成网关：`generation_request` / `generation_stream` / `generation_download` /
   `generation_cancel`（HTTP、multipart、流式事件）。
3. 项目包与资源包：`project_export_package` / `project_import_package` /
   `file_export_resource_package` / `file_import_resource_package` / 回收站目录条目。
4. Harness：`harness_*`（spawn agent host、transport Channel、tool respond）。
5. 厂商插件：`provider_plugins*`；诊断：`diagnostics_build`；恢复：`recovery_*`；
   剪贴板工作流：`clipboard_stage_workflow` / `clipboard_load_staged_payload`。
6. 编辑器导出：`file_export_video_project`、`openreel_export_*`。
7. 更新器与打包：electron-builder、`latest.json`/发布流水线、`npm run release:*`。
8. 收尾：删除 `src-tauri/`、更新 `.github/workflows`、`scripts/*`、测试里的
   `src-tauri` 契约断言（`tests/*.test.mjs` 共 11 个文件）以及文档。

## 验证

- `npm run typecheck`（渲染进程）与 `npm run typecheck:electron`（主进程）。
- `npm test`：881 个测试；原生桥测试通过 `tests/helpers/desktopBridge.mjs` 伪造 preload。
- `npm run smoke:electron`：真实启动 Electron、加载渲染进程、断言 `settings_get` /
  `project_get_default_root` / `recent_list` 与页面已渲染。用户数据写到 `tmp/electron-smoke/`。

## 环境注意事项

- 本机 `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化为 Node；`scripts/electron-dev.mjs`
  启动 GUI 前会删掉这个变量。
- `node:sqlite` 在 Electron 44（Node 24.22）上可用；数据库路径仍按绝对路径传，
  避免 `?`/`#` 被当成 URI 选项。
- Electron 二进制若因网络无法下载，可手动解压 `~/Library/Caches/electron/**/*.zip`
  到 `node_modules/electron/dist`（本机即如此）。
