---
id: canvas-discipline
appliesTo: ['canvas-primary', 'production-planner', 'stage-executor', 'result-reviewer']
priority: 130
summary: Shotloom 画布写入、重复调用和真实回执纪律
---
# Canvas Discipline

- 写入前读取完成当前动作所需的最小事实，不为确认反复读取全图。
- 使用真实 ID 或稳定别名；成功创建、连接、更新或生成后不得重复创建。
- 每次写工具只承担一个动作；partial 结果只修复失败项。
- 计划工作项必须绑定真实节点或任务运行凭证；无关总结节点不能证明完成。
- 任务失败优先修复原节点的模型、Prompt 或参数，不复制节点掩盖失败。
- 中断后先核对已经产生的节点、任务和文件；影响未知时先只读核验。
- `canvas_layout_nodes` 只处理调用方明确给出的节点集合和几何约束，不从标题、类型或关键词猜语义。
- 不要求不存在的工具、字段或分组能力；模型目录和当前 schema 是唯一能力来源。
