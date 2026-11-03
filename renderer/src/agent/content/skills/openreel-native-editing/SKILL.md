---
name: openreel-native-editing
description: 在 Shotloom 绑定的剪辑节点内使用 OpenReel 原生工具完成时间线、声音、Motion、Creation 场景、预览和导出，依据真实状态与回执核验。
metadata: {"category":"video","version":1}
---

# OpenReel 原生剪辑

本 Skill 将 OpenReel 原生系统提示词中的制作协议用于 Shotloom。完整原生工具参数随工具目录提供，原生提示词随剪辑 Agent 加载；本 Skill 负责工作流，不运行第二个 Agent loop。

## 读取当前节点

用 `openreel_get_editor_state`、`openreel_list_tracks`、`openreel_list_clips`、`openreel_list_media` 和 `openreel_get_capabilities` 获取真实状态、ID 与枚举。画布来源素材先用 `video_project_media` 发现，再用 `video_project_import_media` 导入；不要将节点标题当作媒体 ID 或网络地址。

所有编辑仅发生在当前 Session 绑定的剪辑节点。`openreel_create_project`、`openreel_save_project`、`openreel_open_project` 的存档属于该节点，不是其他 Shotloom 工程。切换前保存当前工程。

## 时间线、动效和场景

已有片段的剪点、速度、变换、关键帧、音量、特效和转场使用对应原生专用工具。时间单位默认为秒，具体工具 schema 另有说明时服从 schema。先读取目标 ID，修改后读回；批处理部分失败时修正失败项，不重复已成功的操作。

只有独立图形合成需求才使用 Motion：创建 composition，添加 layer，编辑关键帧、效果、mask、parent、camera 和 light。图层属性与效果枚举从读取工具获得。用户要把合成放入视频时再调用 `openreel_insert_motion_into_editor`。

可编辑三维场景优先用 `openreel_create_creation_3d_scene`，保存 semantic objects、materials 和 render binding，随后按真实 object ID 编辑。需要同步渲染绑定时使用 `openreel_sync_creation_scene_to_motion`，用 `openreel_render_creation_preview` 回看。不要只构造一段说明文字便声称建好了场景。

声音与字幕必须依赖真实媒体、转录或分析回执。没有音频证据不声称节拍、对白和混音已验证。Shotloom 当前不提供外部角色自动骨骼绑定，不要尝试调用未暴露的后端工具，也不能把静态模型称为已绑定角色。读取 GLB/glTF 结构仍可使用 `openreel_inspect_3d_model`。

只使用当前工具清单中的能力；历史会话或上游说明不代表当前环境支持。浏览器或未保存工程不提供桌面文件归档及相关导出入口。Creation 的 CPU 几何烘焙适用于真实支持的程序化几何；`model`、`text3d` 的占位盒不能当成真实模型或文字文件交付。

## 核验和交付

`video_project_diagnostics` 检查主时间线空隙、重叠与缺失媒体。预览应覆盖改变位置、字幕、合成效果和结尾；源帧不能证明合成效果正确。

工具返回 `ok: false` 时读取具体 error，修复参数、依赖或资源后继续。破坏性及昂贵操作交由 Harness 审批；不自行创建审批状态机，不绕过用户权限。

用户要求文件交付时才导出，核对真实输出路径、文件字节数和工具回执。静态预览、渲染队列项或计划完成都不等同于视频导出成功。回复区分已执行、已核验和仍缺少后端的部分。

桌面 Host 提供原生编码：Motion 透明交付使用 `openreel_export_motion_video` 的 `webm-alpha` 或 `mov-prores4444`，普通成片使用 `mp4`；不要因为嵌入式界面使用 Web 技术就假定只能回退为 H.264。核对 `requestedFormat`、`encodedFormat`、`normalizedToH264` 与真实输出回执，缺少 FFmpeg 编码器时修正依赖或如实说明。透明合成应使用透明背景；不应把有实色背景的合成称为透明素材。普通“生成视频节点”的产品导出继续承担画布交付，原生文件导出不自动等同于已经创建画布节点。
