# 画布落地与引用核验

只用 Shotloom 公开的画布工具和模型目录。先用 canvas_list_nodes 找相关资产，已知 ID 时用 canvas_get_node；素材库资产先用 inspect_assets 核实，再放回画布。维护“角色/场景/镜号 → 真实节点 ID → 参考职责”的对照，复用已有角色，不靠标题猜身份。

创建前用 inspect_model_catalog 核对图片、视频的模式、输入槽位、参考容量、时长和参数。人物/场景先落真实节点；只有镜头卡或用户要求表明需要时，才按 motion-board.md 或 shot-board.md 创建对应的多格 imageGeneration 节点，artifactType 为 storyboard，标题和 Production Plan 工作项标明“时间板”或“镜头板”。普通单人或简单对白镜头优先使用单张关键画面，不自动创建 3×3。每个可辨认的出镜人物和必要场景/道具通过真实 referenceImage 边连接，不把 prompt 中的姓名当媒体引用。可用 canvas_create_node.inputLinks 或 canvas_connect_nodes，边的 role、slot 按当前模型目录填写。逐条看 inputLinkResults；节点成功不代表每条边成功，失败边修复后用 canvas_get_node 读回。超出容量时换兼容模式或由真实资产生成复合参考，不静默漏掉关键身份。

每镜两板节点建立后，不等它们出图就继续创建对应的 videoGeneration 节点。优先选择能接收本镜角色、场景、时间板和镜头板的多图 reference 模式，分别说明两板职责；多格图仅接普通参考，不接 firstFrame/lastFrame。模型容量不足时依据目录选择可行的参考组合，并把未直接传入的板转译为本镜动作/构图提示词，不能声称两板都已送入模型；只有首尾帧/首帧模式时另用干净起止帧。配置路径允许上游 idle，启动视频前必须核验实际图片输出。

视频 prompt 用原文和真实参考写完整动作、说话者/听者、机位及末态。逐镜估时后把同一档位写入 outputSpec.duration 与可用的 config.duration，不能沿用整批默认 5 秒；超过模型上限则调整镜头边界或声音安排。创建后读回 prompt、参数、边和镜尾接点，修正原节点，不复制平行节点。

实际生成路径按依赖核验人物 → 场景 → 本镜时间板与镜头板 → 视频；两板均须分别检查格数、身份、空间和用途，不能以同一节点 ID 冒充两板。用 inspect_tasks 与可查看媒体确认真实结果。只配置路径也完成全部本轮节点和边，不把 idle 当作配置失败，也不声称已出图。用 Production Plan 的稳定工作项及 runtimeRefs 保存真实 ID；失败或中断后按镜号只补缺项。最后根据真实工具回执报告交付，区分已配置与已生成。
