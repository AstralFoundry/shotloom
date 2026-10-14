import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";
import { agentNodeAliasMaps } from "../../services/agentCanvasSnapshot.js";
import { resolveNodeChatImageAttachment } from "../../services/nodeChatAttachment.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { getDomainRevision, subscribeDomain } from "../../store/domainReactivity.js";
import { compactRepeatedFailures } from "./messagePresentation";
import { Transcript } from "./Transcript";
import { Composer } from "./Composer";
import { HistoryDrawer } from "./HistoryDrawer";
import type {
  AgentController,
  AgentMessage,
  AgentPanelHandle,
  ConversationItem,
  TextModelOption,
} from "./contracts";
import styles from "./AgentChatPanel.module.css";

export interface AgentChatPanelProps {
  editorMode?: boolean;
  messages: AgentMessage[];
  nodes: WorkflowNodeData[];
  artifactNodes: WorkflowNodeData[];
  busy: boolean;
  conversations: ConversationItem[];
  activeConversationId: string;
  textModel: string;
  textModels: TextModelOption[];
  controller: AgentController;
}

export const AgentChatPanel = forwardRef<AgentPanelHandle, AgentChatPanelProps>(
  function AgentChatPanel(props, ref) {
    const { editorMode = false, messages, nodes, busy, activeConversationId, controller } = props;
    const [historyOpen, setHistoryOpen] = useState(false);
    const [unread, setUnread] = useState(0);
    const [clarificationAnswers, setClarificationAnswers] = useState<
      Record<string, Record<string, string[]>>
    >({});
    const transcript = useRef<HTMLDivElement | null>(null);
    const followsLatest = useRef(true);
    const previousCount = useRef(messages.length);
    const domainRevision = useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);

    const presented = useMemo(() => compactRepeatedFailures(messages), [messages]);
    const aliasMaps = useMemo(() => agentNodeAliasMaps(nodes as never[]), [nodes]);
    const mentionable = useMemo(
      () =>
        nodes
          .filter((node) => !node.archived && !(node.type === "resource" && node.generatedFrom))
          .map((node) => ({
            id: node.id,
            alias: aliasMaps.aliasById[node.id] || "",
            title: String(node.title || node.prompt || node.type || "未命名节点"),
            typeLabel: typeLabels[node.type] || node.type,
            imageAttachment: resolveNodeChatImageAttachment(node),
            node,
          })),
      [nodes, aliasMaps],
    );

    useEffect(() => {
      const added = Math.max(0, messages.length - previousCount.current);
      previousCount.current = messages.length;
      if (!added) return;
      if (followsLatest.current) {
        requestAnimationFrame(() => scrollToLatest("smooth"));
        setUnread(0);
        return;
      }
      setUnread((value) => value + added);
    }, [messages]);

    // 流式输出时贴着底部跟随，但不使用平滑动画，否则每一帧都在追一段未完成的滚动。
    useEffect(() => {
      if (!busy || !followsLatest.current) return;
      const frame = requestAnimationFrame(() => scrollToLatest("auto"));
      return () => cancelAnimationFrame(frame);
    }, [busy, messages.at(-1)?.content, messages.at(-1)?.toolCalls?.length]);

    function scrollToLatest(behavior: ScrollBehavior) {
      const element = transcript.current;
      if (!element) return;
      element.scrollTo({ top: element.scrollHeight, behavior });
    }

    function trackFollow() {
      const element = transcript.current;
      if (!element) return;
      const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
      followsLatest.current = atBottom;
      if (atBottom) setUnread(0);
    }

    const clearConversation = useCallback(() => {
      if (busy || !messages.length) return;
      if (window.confirm("清空当前对话和助手上下文？\n画布节点、任务和待确认计划不会被删除。")) {
        controller.clear(activeConversationId);
      }
    }, [busy, messages.length, controller, activeConversationId]);

    const activeConversation = props.conversations.find(
      (conversation) => conversation.id === activeConversationId,
    );

    return (
      <aside className={styles.root} data-editor={editorMode || undefined}>
        <header className={styles.header}>
          <h2 className={styles.title} title={activeConversation?.title}>
            {editorMode ? "剪辑 Agent" : activeConversation?.title || "新对话"}
          </h2>
          <div className={styles.headerActions}>
            <IconButton label="新建会话" disabled={busy} onClick={() => controller.newConversation()}>
              <Glyph name="plus" />
            </IconButton>
            <IconButton
              label="历史会话"
              active={historyOpen}
              onClick={() => setHistoryOpen((value) => !value)}
            >
              <Glyph name="clock" />
            </IconButton>
            <IconButton label="收起助手" onClick={controller.close}>
              <Glyph name="x" />
            </IconButton>
          </div>
        </header>

        <div className={styles.transcriptSeat}>
          <Transcript
            listRef={transcript}
            onScroll={trackFollow}
            messages={presented}
            busy={busy}
            editorMode={editorMode}
            artifactNodes={props.artifactNodes}
            clarificationAnswers={clarificationAnswers}
            setClarificationAnswers={setClarificationAnswers}
            controller={controller}
          />
          {unread > 0 && (
            <button
              type="button"
              className={styles.jump}
              onClick={() => {
                followsLatest.current = true;
                setUnread(0);
                scrollToLatest("smooth");
              }}
            >
              <Glyph name="chevron-down" />
              {unread} 条新消息
            </button>
          )}
        </div>

        <Composer
          {...props}
          mentionable={mentionable}
          domainRevision={domainRevision}
          forwardedRef={ref}
        />

        {historyOpen && (
          <HistoryDrawer
            conversations={props.conversations}
            activeConversationId={activeConversationId}
            busy={busy}
            controller={controller}
            onClose={() => setHistoryOpen(false)}
            onClear={clearConversation}
            hasMessages={messages.length > 0}
          />
        )}
      </aside>
    );
  },
);

export const typeLabels: Record<string, string> = {
  imageGeneration: "图片节点",
  videoGeneration: "视频节点",
  audioGeneration: "音频节点",
  textGeneration: "文本节点",
  threeDDirector: "3D导演台",
};

function Glyph({ name }: { name: string }) {
  return <IconSymbol name={name} className={styles.glyph} />;
}

function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className={styles.iconButton}
      data-active={active || undefined}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
