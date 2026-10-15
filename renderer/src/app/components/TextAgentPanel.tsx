import { useEffect, useState, useSyncExternalStore } from "react";
import { copilotController, getCopilotRevision, subscribeCopilot } from "../adapters/copilotAdapter";
import { getAvailableAgentModelCatalog, settingsStore } from "../../store/settingsStore";
import { store, touchProject } from "../../store/projectStore";
import { textCopilotConversation } from "../../services/copilotConversations.mjs";
import { IconSymbol } from "./IconSymbol";

export interface TextEditSnapshot {
  source: string;
  selection: string;
  range: Range | null;
}

interface Proposal {
  replacement: string;
  snapshot: TextEditSnapshot;
}

function readAnswer(content: string): { summary: string; replacement: string | null } {
  try {
    const value = JSON.parse(content.trim());
    if (value && typeof value.summary === "string" &&
      (typeof value.replacement === "string" || value.replacement === null)) {
      return { summary: value.summary, replacement: value.replacement };
    }
  } catch { /* 保留模型原文，供用户判断，不猜测替换范围。 */ }
  return { summary: content, replacement: null };
}

export function TextAgentPanel({
  nodeId, capture, apply,
}: {
  nodeId: string;
  capture: () => TextEditSnapshot;
  apply: (replacement: string, snapshot: TextEditSnapshot) => boolean;
}) {
  const revision = useSyncExternalStore(subscribeCopilot, getCopilotRevision);
  const [conversationId, setConversationId] = useState("");
  const [instruction, setInstruction] = useState("");
  const [selected, setSelected] = useState<TextEditSnapshot | null>(null);
  const [pending, setPending] = useState<{ after: number; snapshot: TextEditSnapshot } | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [model, setModel] = useState(settingsStore.agentPreferredTextModel);
  const [error, setError] = useState("");
  const models = (getAvailableAgentModelCatalog().find((group: { type: string }) => group.type === "textGeneration")?.models || []) as Array<{ id: string; name: string }>;
  const selectedModel = models.some((item) => item.id === model) ? model : models[0]?.id || "";

  useEffect(() => {
    const conversation = textCopilotConversation(store.project, nodeId);
    if (conversation) {
      setConversationId(conversation.id);
      touchProject();
    }
    setSelected(null);
    setPending(null);
    setProposal(null);
    setInstruction("");
    setError("");
  }, [nodeId]);

  const conversation = (store.project.copilotConversations || []).find(
    (item: { id: string }) => item.id === conversationId,
  ) as { messages: Array<{ id: string; role: string; content?: string; typing?: boolean; error?: string }> } | undefined;
  const messages = conversation?.messages || [];

  useEffect(() => {
    if (!pending) return;
    const reply = messages.slice(pending.after).find((message) => message.role === "assistant" && !message.typing);
    if (!reply) return;
    if (reply.error) setError(reply.error);
    else {
      const answer = readAnswer(reply.content || "");
      if (answer.replacement) setProposal({ replacement: answer.replacement, snapshot: pending.snapshot });
    }
    setPending(null);
  }, [messages, pending, revision]);

  function captureSelection() {
    const snapshot = capture();
    if (!snapshot.selection.trim()) return;
    setSelected(snapshot);
    setProposal(null);
  }

  function send(value = instruction) {
    const request = value.trim();
    if (!request || !conversationId || !selectedModel || pending) return;
    const snapshot = selected || capture();
    const text = [
      `文档节点 ID：${nodeId}`,
      snapshot.selection
        ? `修改范围：仅改写下面的选区。\n选区原文：\n${snapshot.selection}`
        : "修改范围：全文。",
      `当前文档（Markdown）：\n${snapshot.source}`,
      `用户要求：${request}`,
    ].join("\n\n");
    const accepted = copilotController.send({
      text, model: selectedModel, attachments: [], nodeMentions: [], conversationId,
    });
    if (accepted === false) {
      setError("当前 Agent 正在处理其他请求，请稍后重试。");
      return;
    }
    setPending({ after: messages.length, snapshot });
    setInstruction("");
    setSelected(null);
    setProposal(null);
    setError("");
  }

  function applyProposal() {
    if (!proposal) return;
    if (apply(proposal.replacement, proposal.snapshot)) {
      setProposal(null);
      setError("");
    } else setError("原文已变化。请重新选区并生成修改稿。");
  }

  return (
    <aside className="text-agent-panel" aria-label="文本 Agent">
      <div className="text-agent-heading">
        <span className="text-agent-mark"><IconSymbol name="spark" /></span>
        <div><strong>文本 Agent</strong><small>为这篇内容创作与精修</small></div>
      </div>
      <div className="text-agent-scroll">
        {!messages.length && <div className="text-agent-welcome">
          <span className="text-agent-welcome-mark"><IconSymbol name="spark" /></span>
          <h2>让文字更有画面感</h2>
          <p>告诉我整篇内容想怎么调整，或先在左侧选中一段文字，交给我精准改写。</p>
          <div className="text-agent-capabilities">
            <span>创作与改写</span><span>润色与整理</span><span>翻译与统一</span><span>精修选区</span>
          </div>
          <div className="text-agent-suggestions">
            {["改成更有画面感的分镜说明", "压缩为 30 秒口播", "优化人物对白与节奏", "统一全文的提示词风格"].map((item) =>
              <button key={item} type="button" onClick={() => send(item)}>{item}<IconSymbol name="chevron-right" /></button>)
            }
          </div>
        </div>}
        {messages.map((message) => {
          const answer = message.role === "assistant" && !message.typing && !message.error
            ? readAnswer(message.content || "") : null;
          return <div key={message.id} className={`text-agent-message is-${message.role}`}>
            <span>{message.role === "user" ? "你" : "文本 Agent"}</span>
            <p>{message.error || (message.typing ? "正在整理修改稿…" : answer?.summary || (message.role === "user" ? (message.content || "").match(/用户要求：([\s\S]*)$/)?.[1] || "已提交修改要求" : message.content))}</p>
            {answer?.replacement && <button className="text-agent-copy-result" type="button" onClick={() => void navigator.clipboard?.writeText(answer.replacement || "")}>复制修改稿</button>}
          </div>;
        })}
        {proposal && <div className="text-agent-proposal">
          <div><strong>{proposal.snapshot.selection ? "选区修改稿" : "全文修改稿"}</strong><span>{proposal.replacement.length} 字</span></div>
          <pre>{proposal.replacement}</pre>
          <div className="text-agent-proposal-actions"><button type="button" onClick={() => setProposal(null)}>舍弃</button><button type="button" onClick={applyProposal}>应用到文本</button></div>
        </div>}
      </div>
      <div className="text-agent-compose">
        {selected ? <div className="text-agent-selection"><span>正在修改选区</span><p>{selected.selection}</p><button type="button" title="清除选区" onClick={() => setSelected(null)}><IconSymbol name="x" /></button></div>
          : <button type="button" className="text-agent-select" onClick={captureSelection}><IconSymbol name="cursor" />引用左侧选中文字</button>}
        {error && <p className="text-agent-error" role="alert">{error}</p>}
        <textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); send(); } }} placeholder={selected ? "选中的这段想怎么改？" : "想让整篇更出彩？告诉我目标、语气或篇幅"} aria-label="文本 Agent 修改要求" />
        <div className="text-agent-compose-bottom"><select aria-label="文本 Agent 模型" value={selectedModel} onChange={(event) => setModel(event.target.value)} disabled={!models.length}>{models.length ? models.map((item) => <option key={item.id} value={item.id}>{item.name || item.id}</option>) : <option value="">请先配置文本模型</option>}</select><button type="button" className="text-agent-send" onClick={() => send()} disabled={!instruction.trim() || !selectedModel || Boolean(pending)} title="发送修改要求"><IconSymbol name="arrow-up" /></button></div>
      </div>
    </aside>
  );
}
