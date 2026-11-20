# open-ai-canvas-previs — 世界引擎（性能预演工作台）

本目录是 open-ai-canvas 的「世界引擎」源码快照，按 Shotloom 的三维导演台方式独立构建，
通过 iframe 运行，不使用 iframe 以外的运行时耦合。

## 来源与固定版本

- 上游仓库：`https://github.com/ddcat-ai/open-ai-canvas`
- 快照提交：`0dcf3f676411d6b20d505cbd490af6bbfd180392`（与本地 `/Users/nono/projects/open-ai-canvas` 同一提交）
- 上游路径：`web/src/lib/canvas/previs/`、`web/src/components/canvas/previs/`、`web/src/types/previs.ts`、
  `web/src/stores/canvas/use-previs-workbench-store.ts`
- 引入方式：整目录快照，保持文件内容与上游一致；只做以下可核对的结构性改动。

## 与上游的差异（全部是宿主解耦，不改引擎行为）

1. 目录扁平化：`src/lib/previs/`、`src/components/previs/`、`src/types/previs.ts`；
   导入前缀从 `@/lib/canvas/previs/*`、`@/components/canvas/previs/*` 改为新路径。
2. 应用耦合改为宿主端口（`src/host/`）：
   - `app-theme.ts`、`canvas-theme.ts`、`canvas-theme-store.ts`：AntD 主题与画布主题，工作台固定浅色。
   - `i18n.ts`：不再依赖应用 i18next 实例，由宿主注入翻译函数，缺省回退到 key 末段。
   - `files.ts`、`assets.ts`、`appearance.ts`、`persistence.ts`、`media.ts`、`diagnostics.ts`、
     `state-storage.ts`：文件上传/解析、3D 素材库、品牌名、保存回执、视频转码、诊断、KV 存储。
   - `ui/`：`tooltip`、`switch`、`select`、`cached-resource-image` 四个基础控件的本地实现。
3. `src/host/main.tsx`：iframe 宿主壳。工作台常驻 `open`，宿主通过 `shotloom:previs-*` 协议
   下发场景与画布图片，引擎回传场景变更。
4. `src/host/index.css`：Tailwind 只扫描本包源码；补齐工作台依赖的语义色 token。

## 构建

```bash
npm install --ignore-scripts
npm run typecheck
npm run build      # 产物在 dist/，由宿主脚本复制到 renderer/public/previs-world-app/
```

## 许可

代码版权归上游项目所有；分发时随应用保留上游许可证与署名。
