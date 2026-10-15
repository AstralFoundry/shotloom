import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AgentChatPanel, type TextEditPresentation } from "../agent-chat/AgentChatPanel";
import type { AgentController } from "../agent-chat/contracts";
import { copilotController, copilotData, getCopilotRevision, subscribeCopilot } from "../adapters/copilotAdapter";
import { createCopilotConversation, textCopilotConversation } from "../../services/copilotConversations.mjs";
import { store, touchProject } from "../../store/projectStore";
import { IconSymbol } from "./IconSymbol";

export interface TextEditSnapshot { source: string; selection: string; range: Range | null; }

export function TextAgentPanel({ nodeId, capture, apply }: {
  nodeId: string;
  capture: () => TextEditSnapshot;
  apply: (replacement: string, snapshot: TextEditSnapshot) => boolean;
}) {
  const revision = useSyncExternalStore(subscribeCopilot, getCopilotRevision, getCopilotRevision);
  const snapshotRef = useRef<TextEditSnapshot | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [selection, setSelection] = useState("");

  useEffect(() => {
    const conversation = textCopilotConversation(store.project, nodeId);
    if (!conversation) return;
    setConversationId(conversation.id);
    touchProject();
  }, [nodeId]);

  const data = copilotData("text", nodeId, conversationId);
  const activeConversationId = conversationId || data.activeConversationId;
  const scopedController = useMemo<AgentController>(() => ({
    ...copilotController,
    send: (payload) => {
      const snapshot = snapshotRef.current || capture();
      snapshotRef.current = snapshot;
      const context = [
        `文档节点 ID：${nodeId}`,
        snapshot.selection ? `修改范围：仅改写下面的选区。\n选区原文：\n${snapshot.selection}` : "修改范围：全文。",
        `当前文档（Markdown）：\n${snapshot.source}`,
        `用户要求：${payload.text}`,
      ].join("\n\n");
      return copilotController.send({ ...payload, text: context, conversationId: activeConversationId });
    },
    newConversation: () => {
      const conversation = createCopilotConversation(store.project, { title: "文本 Agent", agentId: "text-primary" });
      (conversation as Record<string, unknown>).textNodeId = nodeId;
      setConversationId(conversation.id);
      touchProject();
    },
  }), [activeConversationId, capture, nodeId]);

  const textEdit = useMemo<TextEditPresentation>(() => ({
    onApply: (replacement) => {
      const snapshot = snapshotRef.current;
      if (snapshot && apply(replacement, snapshot)) {
        snapshotRef.current = null;
        setSelection("");
      }
    },
    hasSelection: () => Boolean(snapshotRef.current?.selection),
  }), [apply]);

  function quoteSelection() {
    const snapshot = capture();
    if (!snapshot.selection.trim()) return;
    snapshotRef.current = snapshot;
    setSelection(snapshot.selection);
  }

  return (
    <div className="text-agent-existing-ui">
      <div className="text-agent-context-bar">
        <span><IconSymbol name="spark" />文本节点 Agent</span>
        <button type="button" onClick={quoteSelection}>{selection ? "已引用选区" : "引用当前选区"}</button>
        {selection && <em title={selection}>{selection}</em>}
      </div>
      <AgentChatPanel
        messages={data.messages}
        nodes={[]}
        artifactNodes={[]}
        busy={data.busy}
        conversations={data.conversations}
        activeConversationId={activeConversationId}
        textModel={data.textModel}
        textModels={data.textModels}
        controller={scopedController}
        textEdit={textEdit}
      />
      <span className="text-agent-revision" aria-hidden="true">{revision}</span>
    </div>
  );
}
