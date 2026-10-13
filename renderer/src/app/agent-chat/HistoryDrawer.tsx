import { IconSymbol } from "../components/IconSymbol";
import type { AgentController, ConversationItem } from "./contracts";
import styles from "./HistoryDrawer.module.css";

export function HistoryDrawer({
  conversations,
  activeConversationId,
  busy,
  hasMessages,
  controller,
  onClose,
  onClear,
}: {
  conversations: ConversationItem[];
  activeConversationId: string;
  busy: boolean;
  hasMessages: boolean;
  controller: AgentController;
  onClose: () => void;
  onClear: () => void;
}) {
  return (
    <aside className={styles.root} aria-label="历史会话">
      <header className={styles.head}>
        <strong>历史会话</strong>
        <button type="button" aria-label="关闭历史会话" onClick={onClose}>
          <IconSymbol name="x" />
        </button>
      </header>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.new}
          disabled={busy}
          onClick={() => controller.newConversation()}
        >
          <IconSymbol name="plus" />
          新建会话
        </button>
        <button
          type="button"
          className={styles.clear}
          disabled={busy || !hasMessages}
          onClick={onClear}
        >
          <IconSymbol name="trash" />
          清空当前会话
        </button>
      </div>
      <div className={styles.list}>
        {conversations.map((conversation) => (
          <div
            key={conversation.id}
            className={styles.item}
            data-active={conversation.id === activeConversationId || undefined}
          >
            <button
              type="button"
              className={styles.itemMain}
              disabled={busy}
              onClick={() => {
                controller.selectConversation(conversation.id);
                onClose();
              }}
            >
              <span>{conversation.title || "新对话"}</span>
              {Number(conversation.pendingInteractionCount) > 0 && (
                <small data-waiting>
                  {conversation.waitingKind === "question" ? "等待回答" : "等待确认"}
                </small>
              )}
            </button>
            <button
              type="button"
              className={styles.itemDelete}
              disabled={busy}
              aria-label={`删除会话：${conversation.title || "新对话"}`}
              title="删除会话"
              onClick={() => {
                if (
                  window.confirm(
                    `删除会话“${conversation.title || "新对话"}”？\n该会话的消息和 Agent 上下文将无法恢复。`,
                  )
                ) {
                  controller.deleteConversation(conversation.id);
                }
              }}
            >
              <IconSymbol name="trash" />
            </button>
          </div>
        ))}
        {!conversations.length && <p className={styles.empty}>还没有历史会话</p>}
      </div>
    </aside>
  );
}
