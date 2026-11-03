# Shotloom 绑定合同

这份文件只回答「视频 Prompt 方法如何落到 Shotloom 的真实工具、字段和输入边」。模型能力、模式、时长、槽位一律以本轮 `inspect_model_catalog` 返回为准；本文件不发明任何模型参数。

## 1. 执行顺序

```text
inspect_model_catalog
  → canvas_list_nodes / canvas_get_node（找可复用资产）
  → canvas_create_node（视频节点：model + outputSpec + inputMode + title）
  → canvas_connect_nodes / inputLinks（真实媒体边与槽位）
  → canvas_update_node（写入最终 prompt）
  → canvas_start_generation（设置允许且用户要求生成时）
  → inspect_tasks（读取真实任务状态）
  → canvas_media_frame（需要看画面/抽帧时）
```

不要在没读目录前猜模型能力；不要在没连边前写 `@图片N`；不要把「已创建/已提交」说成「已生成/已核验」。

## 2. 节点字段

| 字段 | 作用 | 规则 |
| --- | --- | --- |
| `type` | 技术类型 | 视频节点是 `videoGeneration`。 |
| `title` | 画布显示名 | 写这一镜的具体内容，例如「雨夜门口质问」；不要写「视频生成」或模型名。 |
| `artifactType` | 内容用途 | 视频一般为 `other`；人物身份图 `character`、场景参考 `scene`、分镜图 `storyboard`。 |
| `prompt` | 唯一提示词真值 | 写最终成品 Prompt；不要放在 `config` 或 `data` 里。 |
| `model` | 唯一模型真值 | 必须是 `inspect_model_catalog` 返回的可用视频模型 ID。 |
| `inputMode` | 业务输入模式 | 只能是目录公开的 `reference` / `firstFrame` / `firstLastFrame` / `videoExtension`；没有的模式不要写。 |
| `outputSpec` | 跨模型输出意图 | `aspectRatio`、`duration`、`resolution`、`generateAudio`、`generationCount`、`quality`；运行时编译成真实参数。 |
| `config` | 模型专属参数 | 只写当前 model/mode 的 `params` 中公开的 key；不放 `prompt`、`model` 或未知字段。 |
| `inputLinks` / 边 | 真实输入 | 每条边必须有真实上游节点；`role` 表示媒体类型，`slot` 表示业务位置。 |

`multiShot`、`audio`、`watermark` 等是模型参数：只有当前目录的 `params` 明确列出时才写进 `config`；不要自造 `outputSpec.multiShot`。

## 3. 媒体输入顺序与编号

系统会把本次请求实际编译出的媒体列成清单，并在有多个媒体输入（或存在 Prompt 别名）时自动前置：

```text
实际传入的参考素材顺序（编号按本次请求的媒体输入排列，身份以对应上游节点为准）：
@图片1：节点标题（firstFrame）
@图片2：节点标题
@视频1：节点标题
@音频1：节点标题
```

规则：

- 编号按本次编译出的媒体顺序排：**图片 → 视频 → 音频**；不要用节点 ID、创建顺序或画布位置猜。
- 图片内部还会区分 `referenceImage` 的显式参考和自动候选，槽位也会影响清单；**以注入清单为准**。
- 正文只写每个编号的职责与「不继承」项，不要重复抄整份清单。
- `@角色名` 这类别名只有在节点登记了别名且该节点确有输入边时才会被替换成 `@图片N`；不确定时直接用 `@图片N`。
- 外部平台占位符（`{{Mixed 1}}`、`{{Image 1}}`、`@人物`）不会自动绑定 Shotloom 输入；写入前必须改成真实编号或删掉。
- 如果先写了 Prompt 后连线，生成前必须重新核对编号；宁可改写 Prompt，也不要让编号指向错误的图。

## 4. 输入模式与槽位

| 模式 | 槽位 | 什么时候用 | 注意 |
| --- | --- | --- | --- |
| `reference` | `reference` | 多张角色/场景/道具/板图参考；2 张以上时优先 | 数量上限看目录 `maxInputImages`；不要塞满整集资产。 |
| `firstFrame` | `firstFrame` | 只有一张干净起始帧 | 不能同时宣称模型看到了角色图/场景图/板图。 |
| `firstLastFrame` | `firstFrame`、`lastFrame` | 两张干净帧，且目录公开该模式 | 首尾帧必须分别指定槽位；不能靠数组顺序。 |
| `videoExtension` | `inputVideo` | 目录明确支持视频续写/输入视频 | 不是所有模型都支持；没有就重建起始帧。 |
| 音色参考 | `referenceAudio` | 目录公开 `referenceAudio` 且需要音色 | 只传当前说话人需要的音色；不继承参考音频台词。 |

多格角色板、时间板、镜头板只能作为 `reference`，不能接 `firstFrame`/`lastFrame`；首尾帧必须是干净单帧，不能带格线、箭头、编号或文字。

## 5. 上游文本节点

文本生成节点的内容会由系统追加到 Prompt 末尾：

```text
必须继承的上游文本约束：
[文本节点标题] 内容……
```

因此：

- 不要把整段剧本/设定再次抄进视频 Prompt；只写本镜需要编译的动作、空间、台词和声音。
- 文本边必须是真实存在的；没有边就不要写「遵循上游剧本」。
- 如果上游文本太长或包含与画面冲突的指令，先在文本节点修正，不要在视频 Prompt 里和它打架。

## 6. 模型目录怎么选

调用 `inspect_model_catalog` 后，按以下顺序判断：

1. **输入数量**：本镜需要几张参考？`maxInputImages` 够不够？角色 + 场景 + 道具是否超过上限？
2. **输入模式**：有 2 张以上角色/场景/道具参考时，优先选公开 `reference` 且上限足够的模式；只有一张干净起始帧时才用 `firstFrame`；需要首尾帧强约束时才用 `firstLastFrame`。
3. **时长**：目录 `durations` 是否包含本段预算？没有就选最接近档位，调整镜头数量/动作密度，或拆分节点。
4. **声音**：有对白/关键音效时，确认模型支持原生声音；不支持就写「只生成口型与表演，声音后期」，并把声音交给音频节点。
5. **多镜头**：段落驱动且目录 `params` 有 `multiShot` 时开启；帧驱动保持单镜；单段完整不默认开启，除非这一段内部确实有切点且模型把多机位作为同一次生成处理。
6. **画幅/分辨率**：`outputSpec.aspectRatio` / `resolution` 使用目录选项；不要用 Prompt 里的「4K」「宽银幕」代替真实参数。

如果用户指定了模型，保持该选择；只有真实能力冲突（参考数量、模式、时长、声音）时才换模型或明确说明降级原因，不得静默删除用户要求的关键参考。

### 6.1 模型格式路由

- **H3**：读取 `h3-routing.md`，使用它规定的字段、顺序和 `<Subject N>` / `<Picture N>` / `<Video N>` / `<Audio N>` 标签；不要把本合同的 `@图片N` 结构直接粘进 H3 正文。
- **Seedance、Kling、Wan 等自然语言模型**：写镜头、人物、空间、动作和声音的自然语言描述；引用素材使用真实 `@图片N` 或该模型已确认的格式，不要引入 H3 的专用字段。
- **其他模型**：以 `inspect_model_catalog` 返回的 mode/params 为准；没有确认的专有标签不要自造。
- 任何模型都不得残留未解析的外部平台占位符；最终 Prompt 必须能被当前适配器直接送出。

## 7. 生成与核验

- `canvas_start_generation` 只在运行设置允许、用户要求实际生成、且节点配置完整时调用。只做 Prompt 配置时不要启动。
- 启动后拿到真实 `taskId`，用 `inspect_tasks` 读状态；`inspect_tasks` 不会等待，也不会推测。任务未完成时，不要构造依赖其输出的下游阶段。
- 需要看视频画面时用 `canvas_media_frame`，一次最多 8 个时间点；用它检查人物、台词口型、空间、道具和字幕，不要靠文件名猜内容。
- 生成后核验：身份/服装、站位/轴线、道具持有人、光线方向、台词与口型、画内文字、段尾状态。任一失败，先改 Prompt 或换参考，再重试原节点。
- 不能用「创建成功」「连线成功」「任务已提交」冒充「已生成」「已核验」；报告时写清真实范围。

## 8. 重试与修改

- 优先修改原节点的 Prompt、参考边、模式或时长；不要复制一个新节点来掩盖失败。
- 只改一项时，用「保留其余不变」的局部修改 Prompt；不要重写整套场景。
- 参考图版本错误时，换掉对应真实输入边；不要只改文字里的 `@图片N`。
- 需要延长/续写且目录支持视频输入时，接 `inputVideo` 并写接续状态；不支持时，从上一镜抽干净帧重建起始帧。
- 修改固定块（影调/角色/材质/声音）时，同步更新同项目相关节点，避免相邻镜头漂移。

## 9. 常见错误

- 在 Prompt 里写 `{{Mixed 1}}`、`@人物`、`{{Image 1}}`，但没有真实输入边。
- 先写死 `@图片1`，再随便连线，导致编号指向错误素材。
- 把多格角色板/时间板接进 `firstFrame`。
- 模型不支持 `firstLastFrame`，却在 Prompt 里承诺首尾帧一致。
- `outputSpec.duration` 用默认 5 秒，Prompt 里却写了 18 秒的动作。
- 把 `prompt` 或 `model` 塞进 `config`。
- 用「延续上一场」代替真实的起始帧或视频边。
- 生成任务还在运行，就报告「已生成」或开始依赖它的下游。
