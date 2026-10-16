import { useSyncExternalStore } from "react";
import { TEXT_AGENT_ID } from "../../agent/agents/definitions";
import {
  copilotController,
  copilotData,
  getCopilotRevision,
  newTextConversation,
  subscribeCopilot,
} from "../adapters/copilotAdapter";
import { AgentChatPanel } from "./AgentChatPanel";

/**
 * 文本编辑器右侧的 Agent 面板：复用共享聊天界面，但会话、工具与 Skill 都只属于
 * `text-primary` 和当前文本节点，画布与剪辑面板看不到这些会话。
 */
export function TextAgentPanel({ nodeId, onClose }: { nodeId: string; onClose: () => void }) {
  useSyncExternalStore(subscribeCopilot, getCopilotRevision, getCopilotRevision);
  // 首次读取即建立该节点的会话，面板的读取与发送因此落在同一个 conversationId 上。
  const data = copilotData("text", nodeId);
  return (
    <aside className="text-agent-panel">
      <AgentChatPanel
        agentId={TEXT_AGENT_ID}
        messages={data.messages}
        nodes={[]}
        artifactNodes={[]}
        busy={data.busy}
        conversations={data.conversations}
        activeConversationId={data.activeConversationId}
        textModel={data.textModel}
        textModels={data.textModels}
        controller={{
          ...copilotController,
          close: onClose,
          // 文本面板的会话管理只服务当前文本节点，不能跟随项目级 active 指针。
          newConversation: () => newTextConversation(nodeId),
          clear: () => copilotController.clear?.(data.activeConversationId),
        }}
      />
    </aside>
  );
}
