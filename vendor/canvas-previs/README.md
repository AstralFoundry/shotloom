# canvas-previs — 世界引擎（性能预演工作台）

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
3. `src/host/main.tsx`：工作台 iframe 宿主壳。工作台常驻 `open`，宿主通过 `shotloom:previs-*`
   协议下发场景与画布图片，引擎在每次提交后回传完整场景；截图、白膜、深度与「加入画布」
   通过 captures / add-canvas 回执交回宿主。
4. `src/host/card.tsx` + `card.html`：画布节点卡片的迷你俯视图入口，只挂载
   `PrevisMiniViewport`，由 `shotloom:previs-card` 接收场景，不加载工作台外壳。
5. `src/host/messages.ts`：工作台实际用到的上游中英文词条，按上游 `{{param}}` 形式插值。
6. `src/host/index.css`：Tailwind 只扫描本包源码；补齐工作台与卡片依赖的宿主设计 token。
7. `previs-mini-viewport.tsx`：上游只传 `up` 未旋转正交相机，相机仍朝 -Z，俯视内容落在
   视锥外；这里补 `rotation={[-Math.PI/2,0,0]}`，让卡片真正显示俯视场景。
8. `public/previs/`：完整保留上游人偶 GLB 与 CC0 许可证；人偶与复现模型改用相对路径，
   让独立 iframe 在浏览器和桌面自定义协议下都能读取自带资源。
9. `lib/previs/canvas-video-transcode.ts`、`canvas-video-merge-args.ts`：复制上游
   `lib/canvas/canvas-video-merge.ts` 的转码部分与参数模块，去除无关的视频合并和文件服务依赖。
   FFmpeg worker、JS 与 WASM 随引擎构建，导出时按需加载，离线生成真实 MP4。
10. 宿主协议增加操作回执：截图、视频、提示词加入画布与保存必须收到成功确认；错误返回
    工作台供重试。同 ID 的外部场景修订可更新工作台，图片列表更新不重置场景。
    构图/白膜截图沿用上游行为，同时创建带真实截图连线和镜头提示词的视频生成节点。
11. 模型库订阅使用素材数组快照；IndexedDB 写入失败明确报告，图片优先解析持久 storageKey，
    不复用上次会话失效的 blob URL。模型导入流程将存储错误展示给用户。
12. `host/previs-foundation.css` 提取上游 `web/src/styles/globals.css` 中的预演基础规则，
    补齐时间轴轨道、标尺、播放头、动作网格与姿态控件；`host/index.css` 提供独立宿主所需的
    尺寸和浅色主题变量。角色动画步骤补上分组、编号、说明和按钮间距，时间轴颜色跟随工作台。
13. 白膜和深度导出显示常驻进度面板与侧栏加载状态：录制百分比来自实际渲染时间，转码进度
    来自编码回调，准备和回写阶段使用不定进度，不在宿主确认前宣称完成。添加弹窗使用布局尺寸
    测量画布，避免打开动画缩小 WebGL 画面；道具取景同时包含模型和参考人偶，随容器比例适配。

## 构建

```bash
npm install --ignore-scripts
npm run typecheck
npm run build      # 产物在 dist/，由宿主脚本复制到 renderer/public/previs-world-app/
```

## 许可

代码版权归上游项目所有；分发时随应用保留上游许可证与署名。
