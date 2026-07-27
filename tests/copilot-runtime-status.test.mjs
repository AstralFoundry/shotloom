import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('../renderer/src/app/copilot/CopilotPanel.tsx', import.meta.url), 'utf8');
const presenter = readFileSync(new URL('../renderer/src/app/copilot/CopilotRuntimePresenter.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../renderer/src/app/adapters/copilotAdapter.ts', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../renderer/styles/react-migration.css', import.meta.url), 'utf8');
const baseStyles = readFileSync(new URL('../renderer/styles.css', import.meta.url), 'utf8');

test('画布助手用统一点阵状态呈现 Agent 运行过程', () => {
  assert.match(panel, /copilot-run-activity/);
  assert.match(panel, /typing && <BusyBrailleSpinner/);
  assert.doesNotMatch(styles, /copilot-run-spin/);
  assert.match(panel, /className="copilot-run-stop"/);
  assert.match(panel, /aria-label="停止 Agent"/);
  assert.match(styles, /\.copilot-run-stop > span/);
  assert.match(styles, /\.copilot-run-activity > \.copilot-tool-stream \{[^}]*background:\s*transparent/);
  assert.doesNotMatch(styles, /\.copilot-run-activity \{[^}]*border:/);
  assert.doesNotMatch(panel, /copilot-run-status|copilot-stop-button/);
});

test('消息发送后立即显示思考状态并把发送按钮切换为停止操作', () => {
  assert.match(panel, /busy && !messages\.some/);
  assert.match(panel, /Boolean\(item\.toolCalls\?\.length\)/);
  assert.match(panel, /if \(!tools\.length\) return null/);
  assert.match(panel, /className="copilot-busy-tip"/);
  assert.match(panel, /busyBrailleFrames/);
  assert.match(panel, /}, 80\)/);
  assert.match(panel, /提示：使用 @ 引用画布节点/);
  assert.match(panel, /onClick=\{busy \? controller\.cancel : send\}/);
  assert.match(panel, /copilot-stop-mark/);
  assert.match(styles, /copilot-busy-braille/);
  assert.match(styles, /copilot-busy-shimmer/);
});

test('聊天正文不再铺开普通工具、技能和执行记录', () => {
  assert.match(panel, /copilot-tool-stream/);
  assert.match(panel, /element\.scrollTop = element\.scrollHeight/);
  assert.match(baseStyles, /max-height:\s*82px/);
  assert.doesNotMatch(panel, /copilot-skill-strip/);
  assert.doesNotMatch(panel, /copilot-work-log/);
  assert.doesNotMatch(presenter, /skillsUsed|workLog|subagents:/);
});

test('完成态沿用流式正文而不是用最终响应整段覆盖', () => {
  assert.match(adapter, /flush\(\);\s*finalizeMessage/);
  assert.match(adapter, /content:\s*presentation\.streamed \|\| result\?\.reply/);
  assert.doesNotMatch(adapter, /content:\s*result\?\.reply \|\| presentation\.streamed/);
});

test('Agent 运行失败后可使用原请求重试且不重复插入用户消息', () => {
  assert.match(panel, /item\.retryable/);
  assert.match(panel, /controller\.retry\(item\.id\)/);
  assert.match(panel, /重试中…/);
  assert.match(adapter, /retryPayload/);
  assert.match(adapter, /skipUserMessage/);
  assert.match(adapter, /retryable: true/);
  assert.match(adapter, /message\.retryable = false/);
  assert.match(styles, /copilot-message-error-row button/);
});

test('制作计划跟随助手消息显示阶段和进度', () => {
  assert.match(panel, /ProductionPlanCard/);
  assert.match(panel, /画布规划/);
  assert.match(panel, /stages\.filter/);
  assert.doesNotMatch(panel, /plan_review|result_review|reviewProductionStage/);
  assert.match(panel, /runtimeRefs/);
  assert.match(presenter, /production_plan_updated/);
  assert.match(styles, /copilot-production-plan/);
  assert.match(styles, /\.copilot-production-plan \{[^}]*border-top:/);
  assert.doesNotMatch(styles, /\.copilot-production-plan \{[^}]*border-radius:/);
  assert.match(panel, /stages\.every\(\(stage\) => stage\.status === 'done'\)\) setExpanded\(false\)/);
});

test('@ 节点菜单在长别名下保持两行布局且不覆盖类型', () => {
  assert.match(panel, /title=\{`@\$\{node\.alias\}`\}/);
  assert.match(styles, /grid-template-areas:\s*"alias type" "title type"/);
  assert.match(styles, /text-overflow:\s*ellipsis/);
  assert.doesNotMatch(styles, /grid-template-columns:\s*48px 1fr auto/);
});
