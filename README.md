<p align="center"><img src="./src-tauri/icons/app.png" width="80" alt="Shotloom"></p>
<h1 align="center">织帧画布 Shotloom</h1>
<p align="center">把创意、空间预演、生成素材与剪辑放进同一个项目。</p>
<p align="center">简体中文 · <a href="./README.en.md">English</a> · <a href="https://github.com/AstralFoundry/shotloom/releases">下载</a></p>

![创作画布：角色参考、创作简报与生成节点](./docs/images/creative-canvas-zh.png)

Shotloom 是面向 AI 影像创作的桌面工作台。用无限画布组织提示词、参考图、视频和声音；用 3D 导演台先确定场景、角色走位与镜头；再把素材交给生成节点和剪辑台。项目保留节点之间的来源与依赖，方便继续迭代。

## 能力

| 工作区 | 可以做什么 |
| :-- | :-- |
| 创作画布 | 排布文本、图片、视频、音频与工具节点；连线表达参考与依赖；分区、多选、撤销和自动布局 |
| 3D 导演台 | 搭建场景、摆放角色与道具、设置灯光、动作和运动路径；多机位切镜、焦距关键帧、运镜预设、时间轴与实时预览 |
| Agent 助手 | 通过项目工具读取上下文、创建和编辑节点、搭景、编排走位与镜头、检查空间并生成真实预览；完整助手依赖桌面 Harness 运行时 |
| 多模态生成 | 配置自己的模型厂商，串联文本、图片、视频和音频生成；生成结果回到项目 |
| 剪辑台 | 内嵌 OpenReel，多轨时间线、字幕、贴图、转场、画面与音量调整，以及视频导出 |
| 项目与素材 | 管理本地项目、参考设定、生成素材和项目包；界面支持中文和英文 |

## 从创意到交付

以下为当前版本在本地网页版的实际截图，使用仓库内的角色参考和《归航》预演素材。生成节点展示的是输入与配置，未发起付费模型生成；技能库展示实际技能与 Agent 分配，完整 Agent 对话需要桌面运行时。

### 画布与多模态生成

把创作简报、角色参考、图像和视频节点放在同一张无限画布上，通过连线传递参考关系。选中生成节点后，可直接编写提示词、选择模型、配置比例与参考输入；文本、图片、视频和音频可以组成连续的创作流程。

![图片生成节点：提示词、模型与参考输入](./docs/images/generation-node-zh.png)

### 素材库

将角色、场景等参考设定收录到项目素材库，按名称与分类查找，继续引用到画布；通用素材可用于跨项目复用。素材文件与设定保留关联，便于找到来源。

![项目素材库：角色与表情参考](./docs/images/asset-library-zh.png)

### Agent 与技能

画布、文本、导演台和剪辑 Agent 在各自工作区使用真实产品工具。技能库显示技能的说明、版本、启用状态与可用 Agent；可导入、导出或创建技能，沉淀剧本、分镜、角色设定、电商与社交内容等制作方法。项目任务页用于查看生成任务与执行状态。

![技能库：内置技能、启用状态与 Agent 分配](./docs/images/skills-zh.png)

### 剪辑台

内嵌 OpenReel 将素材组织到多轨时间线，配合播放器检查节奏；支持文字、字幕、图形、效果、转场、画面调整和音频处理，再生成视频节点。下图将已有的《归航》视频载入真实剪辑时间线。

![剪辑台：归航素材、播放器与多轨时间线](./docs/images/video-editor-zh.png)

### 3D 导演台

先在空间中验证构图、角色走位与镜头运动，再将预演结果用于后续创作。导演台提供场景搭建、角色动作、运镜预设、多机位切镜与时间轴预览。

![3D 导演台：归航街区预演](./docs/images/director-homebound-zh.png)

<details>
<summary>查看运镜预设界面</summary>

![3D 导演台：运镜预设](./docs/images/director-motion-zh.png)

</details>

## 实际演示：归航 · Homebound

[观看 24 秒预演视频](./docs/demos/homebound/homebound-final.mp4) · [导演台场景文件](./docs/demos/homebound/homebound.scene.json) · [制作记录与工具限制](./docs/demos/homebound/README.md)

两位角色、一条街区、五个机位：俯拍建立空间、侧移跟拍、迎接者近景、双人相会、拉升离场。场景、动作、走位、机位和切镜通过现有 Agent 工具执行入口制作；预览拼图来自真实渲染。

![归航：七个时间点的真实预览](./docs/demos/homebound/storyboard.jpg)

视频为无声的 3D 预演，不是生成式成片。本次通过浏览器调用真实产品工具调度器验证制作能力，未运行桌面模型对话。视频编码成功；浏览器回写画布素材节点失败，详细回执与限制见制作记录。

导演台 Agent 现支持命名批内引用、镜头编排、动作时段、持久导出恢复、交付包与音频字幕剪辑交接。参见 [能力与验证范围](./docs/director-agent-capabilities.md)。

## 开始使用

在 [Releases](https://github.com/AstralFoundry/shotloom/releases) 下载 macOS Apple Silicon 或 Windows x64 安装包。使用生成模型前，进入 **设置 → API 厂商** 添加厂商、凭据与模型配置。不接模型也可以整理画布和使用导演台。

源码运行需要 Node.js ≥ 22.19.0、npm ≥ 10、Rust stable 和 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```bash
git clone https://github.com/AstralFoundry/shotloom.git
cd shotloom
npm ci
npm run dev
```

只查看或调试网页版：

```bash
npm run dev:web
```

网页版不包含完整桌面能力。Agent Host、原生文件保存、部分素材导出和剪辑集成依赖桌面运行时。开发地址、窗口与新项目默认值由 `shotloom.yml` 管理；已有用户设置优先，修改配置后重启。

## 开发

| 命令 | 用途 |
| :-- | :-- |
| `npm run check` | 配置、类型、文案、存储、分层、样式、UI 与回归测试 |
| `npm run harness:test` | Harness 宿主测试 |
| `npm --prefix vendor/shotloom-director-desk test` | 导演台浏览器、时间轴与深度测试 |
| `corepack pnpm -C vendor/openreel test:run` | OpenReel 工作区测试 |
| `npm run prepare:director-desk` | 构建 iframe 导演台 |
| `npm run prepare:openreel` | 构建内嵌剪辑运行时 |
| `npm run build:desktop` | 构建桌面应用 |

前端使用 React、TypeScript 与 Vite，桌面使用 Tauri / Rust；画布基于 React Flow，3D 基于 Three.js / React Three Fiber。导演台位于 `vendor/shotloom-director-desk/`，通过 iframe / postMessage 交互；OpenReel 位于 `vendor/openreel/`，通过 ShadowRoot 内嵌。Harness 客户端不接管产品领域状态。

开发前请阅读 [AGENTS.md](./AGENTS.md) 与 [工程约定](./docs/engineering.md)。模型负责意图与制作判断，代码守住权限和数据完整性；领域状态与界面状态保持分离。从 `develop` 创建分支，完成检查后提 PR 回 `develop`。

## 许可证

仓库根目录尚未声明 LICENSE，默认保留所有权利。第三方代码遵循各自目录中的许可证；使用与分发前请核对对应条款。
