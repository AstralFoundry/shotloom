import { forwardRef, type KeyboardEvent, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { desktopApi } from "../../services/desktopApi.js";
import { agentNodeAliasMaps } from "../../services/agentCanvasSnapshot.js";
import { renderMarkdown } from "../../utils/copilotMarkdown.js";
import { IconSymbol } from "../components/IconSymbol";
import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";
import { isImeKeyEvent } from "../canvas/imeComposition";

const markdownByMessage = new WeakMap<CopilotMessage, { content: string; html: string }>();

function messageMarkdown(message: CopilotMessage) {
  const content = message.content || "";
  const cached = markdownByMessage.get(message);
  if (cached?.content === content) return cached.html;
  const html = renderMarkdown(content);
  markdownByMessage.set(message, { content, html });
  return html;
}

export interface CopilotMessage {
  id: string;
  role: string;
  title?: string;
  content?: string;
  typing?: boolean;
  error?: string;
  retryable?: boolean;
  meta?: string[];
  toolCalls?: CopilotToolCall[];
  productionPlan?: ProductionPlanView;
  clarifications?: Array<{
    interactionId?: string;
    runId?: string;
    questions?: Array<{
      id?: string;
      header?: string;
      question?: string;
      options?: string[];
      multiple?: boolean;
      required?: boolean;
    }>;
    answered?: boolean;
    expired?: boolean;
  }>;
}
interface ProductionPlanView {
  schemaVersion?: number;
  id?: string;
  title?: string;
  goal?: string;
  executionMode?: string;
  revision?: number;
  stages?: Array<{
    id?: string;
    order?: number;
    title?: string;
    description?: string;
    status?: string;
    authored?: boolean;
    workItems?: Array<{ id?: string; title?: string; outputType?: string; prompt?: string }>;
    runtimeRefs?: Array<{ workItemId?: string; nodeId?: string; taskId?: string }>;
    summary?: string;
    blockedReason?: string;
  }>;
}
export interface CopilotToolCall {
  id?: string;
  name?: string;
  kind?: "skill" | "recipe" | "tool";
  effect?: string;
  status?: string;
  summary?: string;
  pending?: boolean;
  runId?: string;
  stepId?: string;
  interactionId?: string;
}
export interface ConversationItem {
  id: string;
  title?: string;
  updatedAt?: string;
  pendingInteractionCount?: number;
  waitingKind?: string;
}
export interface CopilotController {
  send: (payload: {
    text: string;
    model: string;
    attachments: unknown[];
    nodeMentions: unknown[];
  }) => void;
  clear: () => void;
  close: () => void;
  cancel: () => void;
  retry: (messageId: string) => void;
  newConversation: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  changeModel: (model: string) => void;
  submitClarification: (payload: unknown) => void;
  approveToolCall: (payload: unknown) => void;
  rejectToolCall: (payload: unknown) => void;
  focusNodes: (nodeIds: string[]) => void;
}

const busyBrailleFrames = [
  "⠋⠉⠙⠚",
  "⠉⠙⠚⠒",
  "⠙⠚⠒⠂",
  "⠚⠒⠂⠂",
  "⠒⠂⠂⠒",
  "⠂⠂⠒⠲",
  "⠂⠒⠲⠴",
  "⠒⠲⠴⠤",
  "⠲⠴⠤⠄",
  "⠴⠤⠄⠋",
  "⠤⠄⠋⠉",
  "⠄⠋⠉⠙",
] as const;

function BusyBrailleSpinner() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFrame((value) => (value + 1) % busyBrailleFrames.length);
    }, 140);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <span className="copilot-busy-braille" aria-hidden="true">
      {busyBrailleFrames[frame]}
    </span>
  );
}

function ToolActivity({
  tools,
  controller,
}: {
  tools: CopilotToolCall[];
  controller: CopilotController;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const latest = tools.at(-1);
  const methods = tools.filter((tool) => tool.kind === "skill" || tool.kind === "recipe");
  const actions = tools.filter((tool) => tool.kind !== "skill" && tool.kind !== "recipe");
  useEffect(() => {
    const element = viewport.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [tools.length, latest?.status, latest?.summary, latest?.pending]);
  if (!tools.length) return null;
  return (
    <div className="copilot-tool-stream" ref={viewport} aria-label="Agent 工具调用">
      {methods.length > 0 && (
        <details className="copilot-activity-group">
          <summary>
            <span className="copilot-activity-icon"><IconSymbol name="spark" /></span>
            <strong>Skills</strong>
            <em>{methods.length}</em>
            <IconSymbol className="copilot-activity-chevron" name="chevron-down" />
          </summary>
          <div className="copilot-activity-methods">
            {methods.map((tool, index) => (
              <span key={tool.id || index}>{tool.summary || tool.name}</span>
            ))}
          </div>
        </details>
      )}
      {actions.map((tool, index) => {
        const generation = tool.effect === "media_generation";
        const planning = tool.name?.startsWith("plan_");
        const canvas = /canvas|node|edge|layout/.test(tool.name || "");
        const label = generation ? "Generation" : planning ? "Planning" : canvas ? "Canvas" : "Action";
        const icon = generation ? "film" : planning ? "list" : canvas ? "workflow" : "task";
        const state = tool.pending
          ? "等待批准"
          : tool.status === "running"
            ? "进行中"
            : tool.status === "error"
              ? "失败"
              : "已完成";
        return (
          <details
            key={tool.id || index}
            className={`copilot-tool-call is-${tool.status || "idle"}`}
            open={tool.pending || (index === actions.length - 1 && tool.status === "running")}
          >
            <summary>
              <span className="copilot-activity-icon"><IconSymbol name={icon} /></span>
              <strong>{label}</strong>
              <em>{state}</em>
              <IconSymbol className="copilot-activity-chevron" name="chevron-down" />
            </summary>
            <div className="copilot-tool-detail">
              <p>{tool.summary || tool.name || "正在处理"}</p>
              {tool.pending && tool.interactionId && (
                <span className="copilot-tool-confirm-actions">
                  <button
                    onClick={() => controller.rejectToolCall({ interactionId: tool.interactionId })}
                  >
                    拒绝
                  </button>
                  <button
                    className="primary"
                    onClick={() => controller.approveToolCall({ interactionId: tool.interactionId })}
                  >
                    确认执行
                  </button>
                </span>
              )}
            </div>
          </details>
        );
      })}
    </div>
  );
}

function AgentRunActivity({
  tools,
  typing,
  title,
  waitingForAnswer,
  controller,
}: {
  tools: CopilotToolCall[];
  typing?: boolean;
  title?: string;
  waitingForAnswer?: boolean;
  controller: CopilotController;
}) {
  if (!tools.length) return null;
  return (
    <section
      className={`copilot-run-activity${typing ? " is-running" : ""}${waitingForAnswer ? " is-waiting" : ""}`}
    >
      <header>
        <span className="copilot-activity-icon is-thinking">
          <IconSymbol name="spark" />
        </span>
        <strong>深思熟虑</strong>
        <span>{typing ? title || "正在处理任务" : "已完成"}</span>
        {typing && (
          <button
            className="copilot-run-stop"
            type="button"
            title="停止 Agent"
            aria-label="停止 Agent"
            onClick={controller.cancel}
          >
            <span aria-hidden="true" />
          </button>
        )}
      </header>
      {!waitingForAnswer && <ToolActivity tools={tools} controller={controller} />}
    </section>
  );
}

const planStatusLabel: Record<string, string> = {
  pending: "待编排",
  doing: "进行中",
  blocked: "受阻",
  done: "已完成",
};

function ProductionPlanCard({
  plan,
  controller,
}: {
  plan?: ProductionPlanView;
  controller: CopilotController;
}) {
  const stages = plan?.stages || [];
  const active = stages.find((stage) => ["doing", "blocked"].includes(String(stage.status || "")));
  const [expanded, setExpanded] = useState(Boolean(active));
  useEffect(() => {
    if (active) setExpanded(true);
    else if (stages.length && stages.every((stage) => stage.status === "done")) setExpanded(false);
  }, [
    active?.id,
    active?.status,
    stages.length,
    stages.filter((stage) => stage.status === "done").length,
  ]);
  if (!plan || plan.schemaVersion !== 2 || !stages.length) return null;
  const done = stages.filter((stage) => stage.status === "done").length;
  return (
    <details
      className="copilot-production-plan"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>{plan.executionMode === "execute" ? "制作与执行" : "画布规划"}</span>
        <strong>{plan.title || plan.goal || "画布制作"}</strong>
        <em>
          {done}/{stages.length}
        </em>
      </summary>
      <div className="copilot-production-plan-progress">
        <i style={{ width: `${Math.round((done / stages.length) * 100)}%` }} />
      </div>
      <div className="copilot-production-plan-stages">
        {stages.map((stage, index) => (
          <section key={stage.id || index} className={`is-${stage.status || "pending"}`}>
            <i>{stage.status === "done" ? "✓" : index + 1}</i>
            <div>
              <header>
                <strong>{stage.title || `阶段 ${index + 1}`}</strong>
                <span>{planStatusLabel[String(stage.status || "")] || stage.status}</span>
              </header>
              {stage.description && <p>{stage.description}</p>}
              {stage.status === "pending" && !stage.authored && (
                <small>阶段大纲 · 尚未编排工作项</small>
              )}
              {!!stage.workItems?.length && (
                <details className="copilot-stage-work-items">
                  <summary>{stage.workItems.length} 项工作</summary>
                  {stage.workItems.map((workItem) => {
                    const runtimeRef = stage.runtimeRefs?.find(
                      (ref) => ref.workItemId === workItem.id,
                    );
                    return (
                      <div key={workItem.id}>
                        <strong>{workItem.title}</strong>
                        <span>{workItem.outputType || "output"}</span>
                        {workItem.prompt && <p>{workItem.prompt}</p>}
                        {runtimeRef?.nodeId && <small>节点已绑定</small>}
                        {runtimeRef?.taskId && <small>任务已绑定</small>}
                      </div>
                    );
                  })}
                </details>
              )}
              {!!stage.runtimeRefs?.length && (
                <small>
                  {stage.runtimeRefs.filter((ref) => ref.nodeId).length} 个节点 ·{" "}
                  {stage.runtimeRefs.filter((ref) => ref.taskId).length} 个任务
                </small>
              )}
              {stage.blockedReason && <small className="error">{stage.blockedReason}</small>}
              {!!stage.runtimeRefs?.some((ref) => ref.nodeId) && (
                <button
                  onClick={() =>
                    controller.focusNodes(
                      stage.runtimeRefs?.flatMap((ref) => (ref.nodeId ? [ref.nodeId] : [])) || [],
                    )
                  }
                >
                  定位画布产物
                </button>
              )}
            </div>
          </section>
        ))}
      </div>
    </details>
  );
}

const typeLabels: Record<string, string> = {
  imageGeneration: "图片节点",
  videoGeneration: "视频节点",
  audioGeneration: "音频节点",
  textGeneration: "文本节点",
  board: "画板",
  note: "便签",
  threeDDirector: "3D导演台",
};
export interface CopilotPanelHandle {
  /** 通过节点 id 添加引用，CopilotPanel 内部会查找 alias / title */
  addNodeMentionById: (nodeId: string) => void;
}
interface CopilotPanelProps {
  messages: CopilotMessage[];
  nodes: WorkflowNodeData[];
  busy: boolean;
  conversations: ConversationItem[];
  activeConversationId: string;
  textModel: string;
  textModels: Array<{ id: string; label: string }>;
  controller: CopilotController;
}
export const CopilotPanel = forwardRef<CopilotPanelHandle, CopilotPanelProps>(function CopilotPanel({
  messages,
  nodes,
  busy,
  conversations,
  activeConversationId,
  textModel,
  textModels,
  controller,
}, ref) {
  const [drawer, setDrawer] = useState(false);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Record<string, unknown>[]>([]);
  const [mentions, setMentions] = useState<
    Array<{ id: string; alias: string; title: string; typeLabel: string }>
  >([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [clarificationAnswers, setClarificationAnswers] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const textarea = useRef<HTMLTextAreaElement>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const previousMessageCount = useRef(messages.length);
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
        })),
    [nodes, aliasMaps],
  );
  const mentionableRef = useRef(mentionable);
  mentionableRef.current = mentionable;
  const addNodeMentionById = useCallback(
    (nodeId: string) => {
      const found = mentionableRef.current.find((node) => node.id === nodeId);
      if (!found) return;
      setMentions((items) => (items.some((item) => item.id === found.id) ? items : [...items, found]));
      setMessage((value) => {
        const token = `@${found.alias}`;
        if (value.includes(token)) return value;
        const trimmed = value.trimEnd();
        return trimmed ? `${trimmed} ${token} ` : `${token} `;
      });
      requestAnimationFrame(() => textarea.current?.focus());
    },
    [],
  );
  useImperativeHandle(ref, () => ({ addNodeMentionById }), [addNodeMentionById]);
  const options = mentionable
    .filter(
      (node) =>
        !mentions.some((item) => item.id === node.id) &&
        (!mentionQuery ||
          [node.alias, node.title, node.typeLabel]
            .join(" ")
            .toLowerCase()
            .includes(mentionQuery.toLowerCase())),
    )
    .slice(0, 8);
  useEffect(() => {
    const added = Math.max(0, messages.length - previousMessageCount.current);
    previousMessageCount.current = messages.length;
    if (!added) return;
    if (followsLatest.current) {
      requestAnimationFrame(() => {
        messageList.current?.scrollTo({
          top: messageList.current.scrollHeight,
          behavior: "smooth",
        });
      });
      setUnreadMessages(0);
      return;
    }
    setUnreadMessages((value) => value + added);
  }, [messages]);
  useEffect(() => {
    if (!busy || !followsLatest.current) return;
    const frame = requestAnimationFrame(() => {
      messageList.current?.scrollTo({ top: messageList.current.scrollHeight });
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, messages.at(-1)?.content, messages.at(-1)?.toolCalls?.length]);
  function updateScrollFollow() {
    const element = messageList.current;
    if (!element) return;
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    followsLatest.current = atBottom;
    if (atBottom) setUnreadMessages(0);
  }
  function goToLatest() {
    followsLatest.current = true;
    setUnreadMessages(0);
    messageList.current?.scrollTo({
      top: messageList.current.scrollHeight,
      behavior: "smooth",
    });
  }
  function updateMention(value = message) {
    const caret = textarea.current?.selectionStart ?? value.length;
    const before = value.slice(0, caret);
    const match = before.match(/(^|\s)@([^\s@]*)$/);
    if (!match) {
      setMentionOpen(false);
      return;
    }
    setMentionStart(before.length - match[2].length - 1);
    setMentionQuery(match[2]);
    setMentionIndex(0);
    setMentionOpen(true);
  }
  function insertMention(node: (typeof mentionable)[number]) {
    const caret = textarea.current?.selectionStart ?? message.length;
    const before = message.slice(0, mentionStart >= 0 ? mentionStart : caret);
    const token = `@${node.alias}`;
    setMessage(`${before}${token} ${message.slice(caret).replace(/^[^\s@]*/, "")}`);
    setMentions((items) => (items.some((item) => item.id === node.id) ? items : [...items, node]));
    setMentionOpen(false);
    requestAnimationFrame(() => textarea.current?.focus());
  }
  async function attach() {
    const file = await desktopApi.file.pickResource?.();
    if (!file) return;
    const key = file.path || file.filePath || file.name || file.fileName;
    setAttachments((items) =>
      items.some((item) => (item.path || item.filePath || item.name || item.fileName) === key)
        ? items
        : [...items, file],
    );
  }
  function send() {
    if (busy || !textModels.length) return;
    const aliases = new Set(
      (message.match(/@N-[A-Z0-9]+(?:-\d+)?\b/gi) || []).map((item) => item.slice(1).toUpperCase()),
    );
    const activeMentions = mentions.filter((item) => aliases.has(item.alias.toUpperCase()));
    if (!message.trim() && !attachments.length && !activeMentions.length) {
      return;
    }
    controller.send({
      text: message.trim(),
      model: textModel,
      attachments: attachments.map((item) => ({ ...item })),
      nodeMentions: activeMentions.map((item) => ({ ...item })),
    });
    setMessage("");
    setAttachments([]);
    setMentions([]);
    setMentionOpen(false);
  }
  function keydown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isImeKeyEvent(event.nativeEvent)) return;
    if (mentionOpen && event.key === "ArrowDown") {
      event.preventDefault();
      setMentionIndex((value) => (options.length ? (value + 1) % options.length : 0));
      return;
    }
    if (mentionOpen && event.key === "ArrowUp") {
      event.preventDefault();
      setMentionIndex((value) =>
        options.length ? (value - 1 + options.length) % options.length : 0,
      );
      return;
    }
    if (mentionOpen && event.key === "Enter" && options[mentionIndex]) {
      event.preventDefault();
      insertMention(options[mentionIndex]);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      send();
    }
    if (event.key === "Escape") setMentionOpen(false);
  }
  function clear() {
    if (
      !busy &&
      messages.length &&
      window.confirm("清空当前对话和助手上下文？\n画布节点、任务和待确认计划不会被删除。")
    )
      controller.clear();
  }
  const activeConversation = conversations.find(
    (conversation) => conversation.id === activeConversationId,
  );
  return (
    <aside
      className={`forge-copilot${drawer ? " drawer-open" : ""}`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="copilot-main">
        <header className="copilot-header">
          <div className="copilot-header-top">
            <span className="copilot-wordmark">
              <strong>{activeConversation?.title || "新对话"}</strong>
            </span>
            <div className="copilot-header-actions">
              <button title="新建会话" disabled={busy} onClick={controller.newConversation}>
                <IconSymbol name="plus" />
              </button>
              <button
                className={drawer ? "active" : ""}
                title="历史会话"
                onClick={() => setDrawer((value) => !value)}
              >
                <IconSymbol name="list" />
              </button>
              <button title="收起 Copilot" onClick={controller.close}>
                <IconSymbol name="x" />
              </button>
            </div>
          </div>
        </header>
        <div ref={messageList} className="copilot-message-list" onScroll={updateScrollFollow}>
          {messages.length ? (
            messages.map((item, messageIndex) => (
              <article
                key={`${item.id || "message"}-${messageIndex}`}
                className={`copilot-message is-${item.role}${item.typing ? " typing" : ""}`}
              >
                {!(item.role === "assistant" && item.typing) && (
                  <header>
                    <strong>{item.title || (item.role === "user" ? "你" : "画布助手")}</strong>
                  </header>
                )}
                {item.content && (
                  <div
                    className="copilot-message-markdown"
                    dangerouslySetInnerHTML={{
                      __html: messageMarkdown(item),
                    }}
                  />
                )}
                {item.meta?.length ? (
                  <div className="copilot-message-meta">
                    {item.meta.map((value, index) => (
                      <span key={index}>{value}</span>
                    ))}
                  </div>
                ) : null}
                {item.error && (
                  <div className="copilot-message-error-row">
                    <p className="copilot-message-error">{item.error}</p>
                    {item.retryable && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => controller.retry(item.id)}
                      >
                        <IconSymbol name="refresh" />
                        {busy ? "重试中…" : "重试"}
                      </button>
                    )}
                  </div>
                )}
                <ProductionPlanCard plan={item.productionPlan} controller={controller} />
                {item.clarifications
                  ?.filter((question) => !question.answered)
                  .map((question, index) => (
                    <section
                      key={question.interactionId || index}
                      className="copilot-clarification"
                    >
                      {question.questions?.map((entry, questionIndex) => {
                        const interactionId = String(question.interactionId || "");
                        const questionId = String(entry.id || `question-${questionIndex + 1}`);
                        const selected = clarificationAnswers[interactionId]?.[questionId] || [];
                        return (
                          <div className="copilot-clarification-question" key={questionId}>
                            {entry.header && (
                              <small className="copilot-clarification-label">{entry.header}</small>
                            )}
                            <strong className="copilot-clarification-title">
                              {entry.question || "需要补充信息"}
                            </strong>
                            <div className="copilot-clarification-options">
                              {entry.options?.map((option) => (
                                <button
                                  key={option}
                                  aria-pressed={selected.includes(option)}
                                  className={selected.includes(option) ? "active" : ""}
                                  onClick={() =>
                                    setClarificationAnswers((current) => {
                                      const previous = current[interactionId]?.[questionId] || [];
                                      const values = entry.multiple
                                        ? previous.includes(option)
                                          ? previous.filter((value) => value !== option)
                                          : [...previous, option]
                                        : [option];
                                      return {
                                        ...current,
                                        [interactionId]: {
                                          ...(current[interactionId] || {}),
                                          [questionId]: values,
                                        },
                                      };
                                    })
                                  }
                                >
                                  {option}
                                </button>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                      <div className="copilot-clarification-actions">
                        {!question.questions?.some((entry) => entry.required) && (
                          <button
                            onClick={() =>
                              controller.submitClarification({
                                interactionId: question.interactionId,
                                skipped: true,
                                answers: [],
                              })
                            }
                          >
                            跳过
                          </button>
                        )}
                        <button
                          className="primary"
                          onClick={() => {
                            const interactionId = String(question.interactionId || "");
                            controller.submitClarification({
                              interactionId,
                              answers: Object.entries(
                                clarificationAnswers[interactionId] || {},
                              ).map(([questionId, values]) => ({ questionId, values })),
                            });
                          }}
                        >
                          提交回答
                        </button>
                      </div>
                    </section>
                  ))}
                {item.role === "assistant" && (
                  <AgentRunActivity
                    tools={item.toolCalls || []}
                    typing={item.typing}
                    title={item.title}
                    waitingForAnswer={Boolean(
                      item.clarifications?.some((question) => !question.answered),
                    )}
                    controller={controller}
                  />
                )}
              </article>
            ))
          ) : (
            <div className="copilot-welcome">
              <h3>Hi，准备开始创作了吗？</h3>
              <p>试一试这些指令开始</p>
              <div className="copilot-welcome-examples">
                <button onClick={() => setMessage("分析当前画布，告诉我下一步最值得做什么")}>
                  分析当前画布
                </button>
                <button onClick={() => setMessage("把这段剧本拆成场次并整理到画布")}>
                  拆分剧本场次
                </button>
                <button onClick={() => setMessage("检查失败节点并给出修复方案")}>
                  检查失败节点
                </button>
              </div>
              <small>也可以直接输入消息，或添加本地文件</small>
            </div>
          )}
          {busy &&
            !messages.some(
              (item) => item.role === "assistant" && item.typing && Boolean(item.toolCalls?.length),
            ) && (
              <div className="copilot-busy-tip" role="status" aria-live="polite">
                <BusyBrailleSpinner />
                <span className="copilot-busy-copy">
                  提示：使用 @ 引用画布节点，助手会结合当前内容继续处理。
                </span>
              </div>
            )}
        </div>
        {unreadMessages > 0 && (
          <button className="copilot-bottom-anchor" onClick={goToLatest}>
            <span aria-hidden="true">↓</span>
            {unreadMessages} 条新消息
          </button>
        )}
        <div className="copilot-input">
          {!textModels.length && (
            <div className="copilot-api-warning">
              <IconSymbol name="warning" />
              <span>
                <strong>Agent 暂不可用</strong>请先在“设置 → API 厂商”配置文本模型。
              </span>
            </div>
          )}
          {mentions.length > 0 && (
            <div className="copilot-node-mentions">
              {mentions.map((item) => (
                <span key={item.id}>
                  @{item.alias}
                  <em>{item.title}</em>
                  <button
                    onClick={() => {
                      setMentions((items) => items.filter((value) => value.id !== item.id));
                      setMessage((value) =>
                        value.replace(new RegExp(`@${item.alias}\\s*`, "ig"), ""),
                      );
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="copilot-attachments">
              {attachments.map((file, index) => (
                <span key={String(file.path || file.name || index)}>
                  <IconSymbol name="paperclip" />
                  {String(file.name || file.fileName || "附件")}
                  <button
                    onClick={() =>
                      setAttachments((items) => items.filter((_, itemIndex) => itemIndex !== index))
                    }
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          {mentionOpen && (
            <div className="copilot-mention-menu">
              {options.map((node, index) => (
                <button
                  key={node.id}
                  className={index === mentionIndex ? "active" : ""}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(node);
                  }}
                >
                  <strong title={`@${node.alias}`}>@{node.alias}</strong>
                  <span title={node.title}>{node.title}</span>
                  <em>{node.typeLabel}</em>
                </button>
              ))}
              {!options.length && <p>没有匹配的节点</p>}
            </div>
          )}
          <textarea
            ref={textarea}
            value={message}
            placeholder="输入消息，@ 引用画布节点…"
            spellCheck={false}
            lang="zh-CN"
            onChange={(e) => {
              setMessage(e.target.value);
              updateMention(e.target.value);
            }}
            onClick={() => updateMention()}
            onKeyDown={keydown}
          />
          <div className="copilot-input-row">
            <button className="copilot-action-btn" title="添加文件" onClick={() => void attach()}>
              <IconSymbol name="plus" />
            </button>
            <span className="copilot-input-spacer" />
            <select
              className="copilot-model-select"
              value={textModel}
              disabled={!textModels.length}
              onChange={(e) => controller.changeModel(e.target.value)}
            >
              {textModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
            <button
              className={`copilot-send-button${busy ? " is-stop" : ""}`}
              disabled={!busy && !textModels.length}
              title={busy ? "停止生成" : "发送消息"}
              aria-label={busy ? "停止生成" : "发送消息"}
              onClick={busy ? controller.cancel : send}
            >
              {busy ? <span className="copilot-stop-mark" /> : <IconSymbol name="send" />}
            </button>
          </div>
        </div>
      </div>
      {drawer && (
        <aside className="copilot-conversation-drawer" aria-label="历史会话">
          <header>
            <strong>历史会话</strong>
            <button onClick={() => setDrawer(false)}>×</button>
          </header>
          <button
            className="copilot-drawer-new"
            disabled={busy}
            onClick={controller.newConversation}
          >
            ＋ 新建会话
          </button>
          <button
            className="copilot-drawer-clear"
            disabled={busy || !messages.length}
            onClick={clear}
          >
            清空当前会话
          </button>
          <div className="copilot-drawer-list">
            {conversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`copilot-drawer-row${
                  conversation.id === activeConversationId ? " active" : ""
                }`}
              >
                <button
                  className="copilot-drawer-select"
                  disabled={busy}
                  onClick={() => {
                    controller.selectConversation(conversation.id);
                    setDrawer(false);
                  }}
                >
                  <i />
                  <span>
                    {conversation.title || "新对话"}
                    {Number(conversation.pendingInteractionCount) > 0 && (
                      <em>{conversation.waitingKind === "question" ? "等待回答" : "等待确认"}</em>
                    )}
                  </span>
                </button>
                <button
                  className="copilot-drawer-delete"
                  disabled={busy}
                  title={`删除会话：${conversation.title || "新对话"}`}
                  onClick={() => {
                    if (
                      window.confirm(
                        `删除会话“${
                          conversation.title || "新对话"
                        }”？\n该会话的消息和 Agent 上下文将无法恢复。`,
                      )
                    )
                      controller.deleteConversation(conversation.id);
                  }}
                >
                  <IconSymbol name="trash" />
                </button>
              </div>
            ))}
          </div>
        </aside>
      )}
    </aside>
  );
});
