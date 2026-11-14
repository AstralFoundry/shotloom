# 导演台 Agent 制作与交付能力 / Director agent production and delivery

导演台通过已有产品工具执行入口调用，运行在独立 iframe 中。Agent 负责镜头意图、制作范围与画面判断；运行时核验真实引用、版本、参数和工程归属。以下能力不依赖新增关键词路由或固定镜头数量。

The director runs in an isolated iframe behind the existing product tool dispatcher. The model owns intent, production scope and visual judgement. Runtime checks enforce real references, revisions, parameter validity and project ownership.

| 能力 / Capability | 工具与行为 / Tools and behavior |
| :-- | :-- |
| 素材规格 / Asset metadata | `director_desk_catalog` 返回真实默认几何包围尺寸、完整参数定义、范围、默认值、选项及 `actionTiming`。尺寸对应默认实例，修改参数后的实际尺寸仍需查询实体。 / Returns geometry-derived default bounds, complete parameter definitions and action timing. Customized instances need actual entity measurement. |
| 批内引用 / Batch references | 创建项声明 `ref`，后续使用 `$hero`；原有 `$1` 数字引用保留。仅可引用本批此前成功创建的真实实体或片段。 / Named references complement existing numeric references and resolve to preceding real receipts. |
| 镜头编排 / Shot composition | 批量 `add_shot` 在同一撤销事务内设置机位、路径、切镜、名称和 `subjectIds`；`shot_list` 返回镜头表。 / One transaction configures a camera, path, cut, name and declared subjects. |
| 动作时段 / Action timing | `add_action` 接受 `startSec`、`endSec`、`speed`、`blendIn`、`loop`；显式时段冲突返回具体错误，不偷偷挪动。旧文档未声明 loop 时保持原采样行为。 / Explicit timing, speed, blending and loop control, with recoverable overlap errors and legacy sampling compatibility. |
| 检查主体 / Check subjects | `spatial_check.subjectIds` 优先于切镜声明；空数组明确表示不指定入画主体。限制入画和视线遮挡检查，不隐藏其他角色的几何碰撞。 / Explicit subject scope controls framing and occlusion checks, while collision measurements remain intact. |
| 导出恢复 / Export recovery | `export_video_start` / `export_video_job` 返回实际宽高、帧率、帧数、编码、阶段与产物 ID。先保存编码字节，再尝试宿主入库。 / Encoded bytes are retained before host ingestion, with actual output specs and phase-specific status. |
| 产物管理 / Artifacts | `export_artifact_list`、`export_artifact_read`、`export_artifact_deliver`、`export_artifact_remove` 支持重读、下载、入库重试和清理。持久产物跨刷新保留，按宿主工程与导演台文档隔离。 / Persisted artifacts survive reloads and are scoped by host project and director document. Delivery retries do not re-encode. |
| 交付包 / Delivery package | `export_delivery_package` 打包真实视频、完整场景、JSON/CSV 镜头表、预览拼图及 manifest。部分区间导出保留源时码和视频相对时码；固定机位导出不伪报节目切镜。 / ZIP includes the real video, scene, shot tables, rendered contact sheets and manifest, matching the actual exported range/camera. |
| 剪辑交接 / Editing handoff | `director_editing_media` 查询真实媒体；`director_editing_handoff` 入库预演、打开剪辑台、按明确时码放音频和字幕，可请求最终导出。稳定 `handoffId` 允许失败重试，不重复轨道。 / Discover real media and assemble video, audio and subtitles in the native editor. Stable handoff IDs prevent duplicate assembly on export retries. |

## 状态与恢复 / Status and recovery

- `completed`：编码流程完成；用 `artifact.ingestion` 判断宿主是否已入库。独立导演台的下载不会伪报入库。 / Inspect ingestion separately from encoding completion; standalone downloads do not claim host ingestion.
- `delivery_failed`：已有视频产物，使用原 ID 重试交付。 / Reuse the existing artifact rather than encoding again.
- `persistence: stored`：已写入浏览器 IndexedDB。`memory`：持久存储失败，`storageWarning` 明确提示关闭页面前下载。浏览器清理站点数据仍会删除产物。 / Stored artifacts use IndexedDB. Memory-only fallback warns to download before closing. Clearing site data removes persisted artifacts.
- 场景在视频导出后发生变化时，交付包返回可操作错误；切回原版本或重新导出，避免把不一致的场景与视频打包。旧视频仍可单独下载。 / Packaging refuses mismatched scene/video versions; the original video remains downloadable.
- 入库失败不启动空白剪辑；剪辑完成但最终导出失败时返回 `timelineApplied: true`，沿用 `handoffId` 重试。修改交接内容需新 ID 或编辑已有时间线。 / Failed ingestion does not start an empty edit. Failed final export retains the applied timeline for retry.

## 验证范围 / Verification scope

真实 Chrome 测试覆盖：工具桥创建场景、1 秒 H.264 编码与解码、入库失败、重试去重、刷新恢复、宿主工程隔离、交付包内容与删除。原生 OpenReel action executor 测试覆盖音频入出点、音量、字幕时码与重试不重复装配。

Real Chrome tests cover scene production through the tool bridge, one-second H.264 encode/decode, failed ingestion, idempotent retry, reload recovery, host-project isolation, ZIP contents and removal. The actual OpenReel action executor verifies audio source ranges, volume, subtitle timing and retry behavior.

桌面文件保存和最终音视频混流需要桌面运行时；本轮没有把测试替身返回的文件路径当作真实桌面成片。音乐、配音需先有真实素材，工具不会自动生成它们；机械检查仍不能替代逐镜画面和声音审阅。

Desktop file saving and final audio/video muxing require the desktop runtime. A mocked export path is not evidence of a real desktop final render. Music and voiceover require real source assets; these tools do not generate them. Mechanical checks cannot replace visual and audio review.
