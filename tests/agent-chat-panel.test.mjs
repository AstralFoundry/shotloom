import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dir = '../renderer/src/app/agent-chat/';

const panel = read(`${dir}AgentChatPanel.tsx`);
const transcript = read(`${dir}Transcript.tsx`);
const trace = read(`${dir}ToolTrace.tsx`);
const plan = read(`${dir}PlanCard.tsx`);
const composer = read(`${dir}Composer.tsx`);
const history = read(`${dir}HistoryDrawer.tsx`);
const artifacts = read(`${dir}ArtifactList.tsx`);
const referenceCard = read(`${dir}ReferenceCard.tsx`);
const mediaThumb = read(`${dir}MediaThumb.tsx`);
const presentation = read(`${dir}messagePresentation.ts`);
const theme = read(`${dir}useAgentTheme.ts`);
const adapter = read('../renderer/src/app/adapters/copilotAdapter.ts');
const presenter = read('../renderer/src/app/copilot/CopilotRuntimePresenter.ts');
const canvasTools = read('../renderer/src/agent/tools/canvasTools.ts');
const toolRegistry = read('../renderer/src/agent/core/toolRegistry.ts');
const traceStyles = read(`${dir}ToolTrace.module.css`);
const transcriptStyles = read(`${dir}Transcript.module.css`);
const artifactStyles = read(`${dir}ArtifactList.module.css`);
const tokens = read('../renderer/styles/agent-theme.css');
const modules = ['AgentChatPanel', 'Transcript', 'ToolTrace', 'PlanCard', 'Composer', 'HistoryDrawer', 'ArtifactList', 'ClarificationCard', 'ReferenceCard', 'MediaThumb']
  .map((name) => read(`${dir}${name}.module.css`))
  .join('\n');

test('助手面板不再依赖 antd，样式只来自 CSS Modules 与 --slk-* 令牌', () => {
  for (const source of [panel, transcript, trace, plan, composer, history, artifacts, referenceCard, mediaThumb]) {
    assert.doesNotMatch(source, /@ant-design|from "antd"/);
    assert.match(source, /from "\.\/\w+\.module\.css"/);
  }
  assert.doesNotMatch(`${panel}${composer}`, /ConfigProvider/);
  assert.ok(!existsSync(new URL('../renderer/src/app/copilot/CopilotPanel.tsx', import.meta.url)));
  assert.doesNotMatch(modules, /#[0-9a-f]{3}\b/i);
  assert.match(modules, /var\(--slk-/);
});

test('明暗主题的双值都写在令牌层，面板根元素决定作用域', () => {
  assert.match(tokens, /\[data-slk-theme="dark"\]/);
  assert.match(tokens, /--slk-bg-base: var\(--slk-static-n-950\)/);
  assert.match(panel, /data-slk-theme=\{theme\}/);
  assert.match(theme, /shotloom:agent-theme/);
  assert.match(theme, /useSyncExternalStore/);
});

test('运行轨迹默认一行摘要，等待确认时才自动展开', () => {
  assert.match(trace, /const \[open, setOpen\] = useState\(false\)/);
  assert.match(trace, /setOpen\(hasPending\)/);
  assert.match(trace, /if \(!tools\.length \|\| waitingForAnswer\) return null/);
  assert.match(trace, /aria-expanded=\{open\}/);
  assert.match(trace, /\{open && \(\s*<ol className=\{styles\.steps\}/);
  assert.match(trace, /等待确认/);
  assert.match(trace, /执行过程/);
  assert.doesNotMatch(trace, /运行记录/);
  // 只有真实交互号才渲染确认区，不能凭空出现可点的批准按钮。
  assert.match(trace, /tool\.pending && tool\.interactionId/);
});

// 工具名来自注册表、结果来自回执，界面不再各自维护中文名字表，也不会只剩"已运行"。
test('工具步骤显示注册表标题与真实产出', () => {
  assert.match(trace, /tool\.title \|\| agentToolTitle\(String\(tool\.name \|\| ""\)\)/);
  assert.doesNotMatch(presenter, /const labels/);
  assert.match(presenter, /output: event\.isError \|\| event\.pending \? '' :/);
  assert.match(presenter, /display\?\.summary \|\| receiptOutcome\(receipt\)/);
  assert.match(canvasTools, /summarizeResult: snapshotDisplay/);
  assert.match(canvasTools, /nodeSummaryLabel\(input\.nodeId\)\} @ /);
  assert.doesNotMatch(canvasTools, /node\(s\)/);
  assert.match(trace, /\{\(tool\.output \|\| previews\.length\) && \(/);
  // 缩略图必须复用项目的图片预览缓存，直接引用 asset 协议在画布里从来不是图片路径。
  assert.match(trace, /useMediaPreviewCache\(\{ path, kind: "image", maxSize: 320 \}\)/);
  assert.doesNotMatch(trace, /convertFileSrc/);
  assert.match(traceStyles, /\.preview \{[^}]*object-fit:\s*cover/);
});

// 图标由工具自己声明，展示层只保留运行时合成行的类别图标，不再把所有步骤画成同一个扳手。
test('工具步骤图标取自注册表声明而不写死在界面', () => {
  assert.match(trace, /kindIcon\[String\(tool\.kind \|\| ""\)\] \|\| agentToolIcon\(String\(tool\.name \|\| ""\)\)/);
  assert.match(trace, /name=\{toolIcon\(active\)\} className=\{styles\.headIcon\}/);
  assert.doesNotMatch(trace, /statusIcon|"wrench"/);
  assert.match(toolRegistry, /return definition\.icon \|\| effectIcon\[definition\.effect\] \|\| 'wrench'/);
});

test('待确认调用允许在批准前修改参数，非法 JSON 不得提交', () => {
  assert.match(trace, /JSON\.parse\(text\)/);
  assert.match(trace, /!Array\.isArray\(parsed\)/);
  assert.match(trace, /disabled=\{Boolean\(parseError\)\}/);
  assert.match(trace, /changed \? \{ modifiedArgs \} : \{\}/);
  assert.match(trace, /恢复原参数/);
});

test('发送中把发送按钮切换为停止，输入只读且不存在排队入口', () => {
  assert.match(composer, /data-stop=\{busy \|\| undefined\}/);
  assert.match(composer, /busy \? controller\.cancel\(\) : submit\(\)/);
  assert.match(composer, /readOnly=\{busy\}/);
  assert.match(composer, /name=\{busy \? "stop" : "arrow-up"\}/);
  assert.match(trace, /aria-label="停止 Agent"/);
  assert.match(transcript, /busy &&[\s\S]*?!messages\.some/);
  assert.doesNotMatch(composer, /加入队列|queue|排队/);
});

test('相同 Runtime 失败合并成紧凑诊断卡，重试只在非运行态出现', () => {
  assert.match(panel, /compactRepeatedFailures\(messages\)/);
  assert.match(presentation, /repeatedFailureCount/);
  assert.match(presentation, /markdownByMessage = new WeakMap/);
  assert.match(transcript, /repeatsFollowingFailure\(message, next\)/);
  assert.match(transcript, /message\.retryable && !busy/);
  assert.match(transcript, /controller\.retry\(message\.id\)/);
  assert.match(transcript, /<summary>详情<\/summary>/);
});

test('完成态沿用流式正文而不是用最终响应整段覆盖', () => {
  assert.match(adapter, /flush\(\);\s*finalizeMessage/);
  assert.match(adapter, /content:\s*presentation\.streamed \|\| result\?\.reply/);
  assert.doesNotMatch(adapter, /content:\s*result\?\.reply \|\| presentation\.streamed/);
});

test('制作计划只在 plan 变化时重置展开，并按阶段定位真实节点', () => {
  assert.match(plan, /plan\.schemaVersion !== 2 \|\| !stages\.length\) return null/);
  assert.match(plan, /setExpandedStage\(null\);\s*\}, \[plan\?\.id\]\)/);
  assert.match(plan, /const stageNodeIds = \(stage\.runtimeRefs \|\| \[\]\)\.flatMap/);
  assert.match(plan, /controller\.focusNodes\(stageNodeIds\)/);
  assert.doesNotMatch(plan, /controller\.focusNodes\(\s*stages/);
  assert.doesNotMatch(plan, /plan_review|result_review|reviewProductionStage/);
});

test('@ 引用的节点卡片只发送契约字段，媒体预览与附件不进请求', () => {
  assert.match(panel, /resolveNodeChatImageAttachment\(node\)/);
  assert.match(composer, /addNodeMentionById/);
  assert.match(composer, /useImperativeHandle\(props\.forwardedRef/);
  assert.match(composer, /addMention\(found\)/);
  assert.match(composer, /attachNodeImage\(node\)/);
  assert.match(composer, /nodeMentions: mentions\.map\(\(\{ imageAttachment: _drop, node: _node, \.\.\.item \}\) => \(\{ \.\.\.item \}\)\)/);
  // 引用卡描述只随消息持久化供界面回看，不得进模型请求。
  assert.match(composer, /references: references\.map\(\(item\) => item\.reference\)/);
  assert.doesNotMatch(adapter, /references: payload\.references/);
});

test('引用与发送落在面板当前显示的会话上，不二次解析项目级 active 指针', () => {
  assert.match(composer, /conversationId: activeConversationId/);
  assert.match(history, /controller\.selectConversation\(conversation\.id\)/);
  assert.match(panel, /controller\.clear\(activeConversationId\)/);
  assert.match(history, /window\.confirm\(/);
});

test('未配置文本模型时输入区给出可执行说明而不是静默失效', () => {
  assert.match(composer, /const disabled = !textModels\.length/);
  assert.match(composer, /还未配置文本模型/);
  assert.match(composer, /disabled=\{disabled\}/);
});

test('流式跟随底部但不使用平滑动画，离开底部后改为未读计数', () => {
  assert.match(panel, /followsLatest\.current\) \{\s*requestAnimationFrame\(\(\) => scrollToLatest\("smooth"\)\)/);
  assert.match(panel, /scrollToLatest\("auto"\)/);
  assert.match(panel, /< 48/);
  assert.match(panel, /setUnread\(\(value\) => value \+ added\)/);
});

// 进行中的反馈只能有一个：排队时底部提示补位，占位消息出现后由思考中/正文/工具轨迹承担。
test('发送后不叠加投递文案，也不与底部处理提示同时出现', () => {
  assert.match(transcript, /const running = busy && !messages\.some\(\(message\) => message\.role === "assistant" && message\.typing\)/);
  assert.doesNotMatch(transcript, /已发送，等待 Agent 接收/);
  assert.doesNotMatch(modules, /\.delivery \{/);
  // 投递失败仍然是必须可见的事实。
  assert.match(transcript, /message\.deliveryStage === "failed" && message\.deliveryError/);
});

// 进行中的反馈必须真的在动：依次点亮的点 + 文字扫光，只在静止偏好下退回静态。
test('思考中与排队提示带可见动画', () => {
  assert.match(transcript, /className=\{styles\.dots\} aria-hidden="true"/);
  assert.match(transcriptStyles, /\.dots > i \{[^}]*animation:\s*dot-pulse 1\.1s var\(--slk-ease\) infinite/);
  assert.match(transcriptStyles, /\.dots > i:nth-child\(3\) \{[^}]*animation-delay:\s*0\.3s/);
  assert.match(transcriptStyles, /\.shimmer \{[^}]*animation:\s*sweep 1\.5s linear infinite/);
  assert.match(transcriptStyles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.dots > i \{[^}]*animation: none/);
});

// 产物卡与引用卡共用同一张缩略图：无边框、无文字，名称留在提示与无障碍标签里。
test('产物卡复用共享媒体缩略图，定位入口悬停才出现', () => {
  assert.doesNotMatch(artifacts, /styles\.info|statusLabel|kindLabel|useMediaPreviewCache|openMediaViewer/);
  assert.match(artifacts, /<MediaThumb\n\s+kind=\{artifact\.kind\}\n\s+path=\{artifact\.path\}/);
  assert.match(artifacts, /aria-label=\{`在画布中定位：\$\{artifact\.title\}`\}/);
  assert.doesNotMatch(modules, /\.info \{/);
  // 无边框、无底色：卡片不再给素材套一层壳。
  assert.doesNotMatch(artifactStyles, /\.card \{[^}]*(box-shadow|background:|--slk-stroke-color)/);
  assert.match(artifactStyles, /\.locate \{[^}]*opacity:\s*0/);
  assert.match(artifactStyles, /\.card:hover \.locate,[\s\S]*?\.locate:focus-visible \{\s*opacity:\s*1/);
});

// 复制回复不是这一屏的职责，正文选中即可复制，不再常驻一个操作按钮。
test('助手消息不带复制按钮', () => {
  assert.doesNotMatch(transcript, /MessageActions|navigator\.clipboard|styles\.action|IconSymbol name="copy"/);
  assert.doesNotMatch(transcriptStyles, /\.actions \{|\.action \{/);
});
