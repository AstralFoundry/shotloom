import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(
  new URL('../renderer/src/app/copilot/CopilotPanel.tsx', import.meta.url),
  'utf8',
);
const presenter = readFileSync(
  new URL('../renderer/src/app/copilot/CopilotRuntimePresenter.ts', import.meta.url),
  'utf8',
);
const adapter = readFileSync(
  new URL('../renderer/src/app/adapters/copilotAdapter.ts', import.meta.url),
  'utf8',
);
const styles = readFileSync(
  new URL('../renderer/styles/canvas-copilot.css', import.meta.url),
  'utf8',
);
test('画布助手默认用一行摘要呈现 Agent 运行过程并允许展开详情', () => {
  assert.match(panel, /copilot-run-activity/);
  assert.match(panel, /ThoughtChain/);
  assert.match(panel, /className="copilot-thought-chain"/);
  assert.match(panel, /className=\{`copilot-tool-trace\$\{typing \? " is-running" : ""\}`\}/);
  assert.match(panel, /hasPendingConfirmation/);
  assert.match(styles, /max-height:\s*220px/);
  assert.match(panel, /const \[expanded, setExpanded\] = useState\(false\)/);
  assert.match(panel, /status: tool\.pending/);
  assert.doesNotMatch(panel, /toolActivityTitle/);
  assert.doesNotMatch(panel, /tool\.effect === "media_generation"/);
  assert.match(panel, /className="copilot-run-stop"/);
  assert.match(panel, /aria-label="停止 Agent"/);
  assert.match(styles, /\.copilot-run-stop > span/);
  assert.match(styles, /copilot-thought-chain/);
  assert.doesNotMatch(panel, /copilot-run-status|copilot-stop-button/);
});

test('消息发送后立即显示思考状态并把发送按钮切换为停止操作', () => {
  assert.match(panel, /busy &&[\s\S]*?!messages\.some/);
  assert.match(panel, /Boolean\(item\.toolCalls\?\.length\)/);
  assert.match(panel, /if \(!tools\.length\) return null/);
  assert.match(panel, /className="copilot-busy-tip"/);
  assert.match(panel, /busyBrailleFrames/);
  assert.match(panel, /}, 140\)/);
  assert.match(panel, /提示：使用 @ 引用画布节点/);
  assert.match(panel, /loading=\{busy\}/);
  assert.match(panel, /onCancel=\{controller\.cancel\}/);
  assert.match(styles, /copilot-busy-braille/);
  assert.match(styles, /copilot-busy-pulse/);
});

test('聊天正文不再铺开普通工具、技能和执行记录', () => {
  assert.match(panel, /ThoughtChain/);
  assert.doesNotMatch(panel, /copilot-tool-stream/);
  assert.doesNotMatch(panel, /copilot-skill-strip/);
  assert.doesNotMatch(panel, /copilot-work-log/);
  assert.doesNotMatch(presenter, /skillsUsed|workLog|subagents:/);
});

test('Presenter 保留真实 Skill、Recipe 和工具权限类型供运行轨迹分组', () => {
  assert.match(presenter, /kind: 'skill'/);
  assert.match(presenter, /kind: 'recipe'/);
  assert.match(presenter, /kind: 'tool'/);
  assert.match(presenter, /effect: String\(event\.effect/);
  assert.match(presenter, /event\.type === 'skill_used'[\s\S]*?this\.tools\.push/);
});

test('完成态沿用流式正文而不是用最终响应整段覆盖', () => {
  assert.match(adapter, /flush\(\);\s*finalizeMessage/);
  assert.match(adapter, /content:\s*presentation\.streamed \|\| result\?\.reply/);
  assert.doesNotMatch(adapter, /content:\s*result\?\.reply \|\| presentation\.streamed/);
});

test('Agent 运行失败后可使用原请求重试且不重复插入用户消息', () => {
  assert.match(panel, /item\.retryable/);
  assert.match(panel, /controller\.retry\(item\.id\)/);
  assert.match(panel, />\s*重试\s*<\/button>/);
  assert.match(adapter, /retryPayload/);
  assert.match(adapter, /skipUserMessage/);
  assert.match(adapter, /retryable: true/);
  assert.match(adapter, /message\.retryable = false/);
  assert.match(styles, /copilot-failure-retry/);
});

test('相同 Runtime 失败合并成紧凑诊断卡', () => {
  assert.match(panel, /compactRepeatedFailures/);
  assert.match(panel, /repeatedFailureCount/);
  assert.match(panel, /repeatsFollowingFailure/);
  assert.match(panel, /className="copilot-failure-log"/);
  assert.match(panel, /<strong>系统<\/strong>/);
  assert.match(panel, /className="copilot-failure-retry"/);
  assert.match(panel, /<summary>详情<\/summary>/);
  assert.match(panel, /item\.diagnosis\?\.primaryAction \|\| "检查配置后重试"/);
  assert.match(styles, /\.copilot-failure-log/);
  assert.doesNotMatch(styles, /\.copilot-failure-card/);
});

test('制作计划跟随助手消息显示阶段和进度', () => {
  assert.match(panel, /ProductionPlanCard/);
  assert.match(panel, /画布规划/);
  assert.match(panel, /stages\.filter/);
  assert.doesNotMatch(panel, /plan_review|result_review|reviewProductionStage/);
  assert.match(panel, /runtimeRefs/);
  assert.match(presenter, /production_plan_updated/);
  assert.match(styles, /copilot-production-plan/);
  assert.match(panel, /<Collapse/);
  assert.match(panel, /<Progress/);
  assert.match(panel, /copilot-plan-chain/);
  assert.match(panel, /function ProductionPlanCard[\s\S]*?const \[expanded, setExpanded\] = useState\(false\)/);
  assert.doesNotMatch(panel, /if \(active\) setExpanded\(true\)/);
});

test('@ 节点菜单在长别名下保持两行布局且不覆盖类型', () => {
  assert.match(panel, /title=\{`@\$\{node\.alias\}`\}/);
  assert.match(styles, /grid-template-areas:\s*"alias type" "title type"/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(styles, /grid-template-columns:\s*48px 1fr auto/);
});

test('画布图片节点加入对话时自动携带当前图片产物', () => {
  assert.match(panel, /resolveNodeChatImageAttachment\(node\)/);
  assert.match(panel, /attachNodeImage\(found\)/);
  assert.match(panel, /attachNodeImage\(node\)/);
  assert.match(panel, /imageAttachment: _imageAttachment/);
});

test('已引用节点以名称、短别名和类型组成紧凑信息卡', () => {
  assert.match(panel, /copilot-sender-context/);
  assert.match(panel, /<strong>\{item\.title\}<\/strong>/);
  assert.match(panel, /<small>@\{item\.alias\}<\/small>/);
  assert.match(styles, /grid-template-columns:\s*15px minmax\(0, 1fr\) auto 18px/);
});

test('通用对话界面由 Ant Design X 组件承载', () => {
  assert.match(panel, /from "@ant-design\/x\/es\/bubble"/);
  assert.match(panel, /<Bubble/);
  assert.match(panel, /<Sender/);
  assert.match(panel, /<Attachments/);
  assert.match(panel, /<Conversations/);
  assert.doesNotMatch(panel, /<textarea/);
});
