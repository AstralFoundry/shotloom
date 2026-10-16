/**
 * 文本 Agent 面板的接线契约：界面必须复用共享聊天组件，会话与 Skill 只属于 text-primary，
 * 且只有"自己编写内容"这一条入口会带上面板。这里检查装配关系，不检查模型该写什么。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const chatDir = '../renderer/src/app/agent-chat/';

const panel = read(`${chatDir}AgentChatPanel.tsx`);
const composer = read(`${chatDir}Composer.tsx`);
const transcript = read(`${chatDir}Transcript.tsx`);
const presentation = read(`${chatDir}agentPresentation.ts`);
const textPanel = read(`${chatDir}TextAgentPanel.tsx`);
const adapter = read('../renderer/src/app/adapters/copilotAdapter.ts');
const mediaViewer = read('../renderer/src/app/components/MediaViewer.tsx');
const generationNode = read('../renderer/src/app/canvas/GenerationNode.tsx');
const creationView = read('../renderer/src/app/views/CreationView.tsx');
const editorWorkspace = read('../renderer/src/app/editor/VideoEditorWorkspace.tsx');
const overlayStore = read('../renderer/src/app/store/overlayStore.ts');
const definitions = read('../renderer/src/agent/agents/definitions.ts');
const instructions = read('../renderer/src/agent/content/instructions.ts');

test('面板按 Agent 决定文案，不再用布尔开关猜作用域', () => {
  assert.match(panel, /agentId: string;/);
  assert.match(panel, /const presentation = agentPresentation\(agentId\)/);
  assert.match(presentation, /\[TEXT_AGENT_ID\]: \{/);
  assert.match(presentation, /title: "文本 Agent"/);
  assert.match(presentation, /throw new Error\(`未知的 Agent 界面呈现/);
  // editorMode 布尔开关是旧实现：它让每个面板各自解释"我是谁"。
  assert.doesNotMatch(`${panel}${composer}${transcript}${presentation}`, /editorMode/);
  assert.doesNotMatch(definitions, /editorMode/);
});

test('Skill 选择器只消费面板所属 Agent 的定义', () => {
  assert.match(composer, /selectAgentSkills\(\s*agentDefinition\(agentId\)/);
  assert.doesNotMatch(composer, /agentId = editorMode|editorMode \? EDITOR_AGENT_ID : CANVAS_AGENT_ID/);
  assert.match(textPanel, /<AgentChatPanel\s+agentId=\{TEXT_AGENT_ID\}/);
  assert.match(textPanel, /copilotData\("text", nodeId\)/);
  // 文本面板没有画布节点，@ 引用入口不该带着空的画布节点列表出现。
  assert.match(textPanel, /nodes=\{\[\]\}/);
  assert.match(textPanel, /newConversation: \(\) => newTextConversation\(nodeId\)/);
});

test('文本会话在建立时就绑定节点，画布列表排除工作区会话', () => {
  assert.match(adapter, /agentId: TEXT_AGENT_ID, textNodeId: String\(nodeId \|\| ""\)/);
  assert.match(adapter, /scope: 'canvas' \| 'editor' \| 'text'/);
  assert.match(overlayStore, /textAgentNodeId/);
});

test('只有"自己编写内容"打开文本 Agent 面板，其他文本入口保持纯编辑器', () => {
  assert.match(generationNode, /function openDetail\(withTextAgent: boolean\)/);
  assert.match(generationNode, /textAgentNodeId: withTextAgent \? node\.id : ""/);
  assert.match(generationNode, /onDoubleClick=\{imageCropOpen \? undefined : \(\) => openDetail\(false\)\}/);
  assert.match(generationNode, /openDetail\(true\)/);
});

test('编辑器把当前草稿挂成唯一的 Agent 通道，面板关闭即注销', () => {
  assert.match(mediaViewer, /const agentNodeId = media\.kind === "text" \? media\.textAgentNodeId : ""/);
  assert.match(mediaViewer, /return registerTextDraftTarget\(\{\s*nodeId: agentNodeId/);
  assert.match(mediaViewer, /read: \(\) => \(textEditor\.current \? richHtmlToMarkdown\(textEditor\.current\.innerHTML\)/);
  assert.match(mediaViewer, /editor\.innerHTML = markdownToRichHtml\(draft\)/);
  assert.match(mediaViewer, /\[media\.open, agentNodeId\]\)/);
  assert.match(mediaViewer, /agentNodeId && agentOpen && \(\s*<TextAgentPanel nodeId=\{agentNodeId\}/);
});

test('画布与剪辑面板显式声明自己的 Agent，提示词装配只有一处分支', () => {
  assert.match(creationView, /agentId=\{CANVAS_AGENT_ID\}/);
  assert.match(editorWorkspace, /agentId=\{EDITOR_AGENT_ID\}/);
  assert.match(instructions, /context\.agentId === TEXT_AGENT_ID/);
  assert.match(instructions, /textAgentPrompt\.replace\('\{\{runtime_model_contract\}\}', runtimeModelContract\)/);
});
