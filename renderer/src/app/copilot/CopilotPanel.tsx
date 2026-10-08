import { forwardRef, type KeyboardEvent, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Attachments from "@ant-design/x/es/attachments";
import Bubble from "@ant-design/x/es/bubble";
import Conversations from "@ant-design/x/es/conversations";
import Sender from "@ant-design/x/es/sender";
import ThoughtChain from "@ant-design/x/es/thought-chain";
import type { SenderRef } from "@ant-design/x/es/sender";
import { Collapse, ConfigProvider, Dropdown, Progress } from "antd";
import { desktopApi } from "../../services/desktopApi.js";
import { agentNodeAliasMaps } from "../../services/agentCanvasSnapshot.js";
import {
  nodeChatAttachmentKey,
  resolveNodeChatImageAttachment,
} from "../../services/nodeChatAttachment.mjs";
import { IconSymbol } from "../components/IconSymbol";
import { InteractiveLogo } from "../components/InteractiveLogo";
import { ProviderBrandIcon } from "../components/ProviderBrandIcon";
import { openMediaViewer, showToast } from "../store/overlayStore";
import { useMediaPreviewCache } from "../canvas/useMediaPreviewCache";
import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";
import { isImeKeyEvent } from "../canvas/imeComposition";
import {
  compactRepeatedFailures,
  messageMarkdown,
  type PresentedCopilotMessage,
  repeatsFollowingFailure,
} from "./copilotMessagePresentation";
import { skillsStore } from "../../store/skillsStore.js";
import { getDomainRevision, subscribeDomain } from "../../store/domainReactivity.js";
import { artifactsForMessage, type CopilotArtifact, type CopilotArtifactRefs } from "./copilotArtifacts";

export interface CopilotMessage {
  id: string;
  role: string;
  title?: string;
  content?: string;
  typing?: boolean;
  error?: string;
  retryable?: boolean;
  deliveryStage?: "queued" | "sent" | "started" | "completed" | "failed" | "cancelled";
  deliveryError?: string;
  diagnosis?: {
    code?: string;
    title?: string;
    message?: string;
    primaryAction?: string;
    suggestions?: string[];
  };
  meta?: string[];
  toolCalls?: CopilotToolCall[];
  productionPlan?: ProductionPlanView;
  artifactRefs?: CopilotArtifactRefs;
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
  kind?: "skill" | "recipe" | "tool" | "system";
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
  }) => boolean;
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

function CollapsibleUserMessage({ html }: { html: string }) {
  const content = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [html]);
  useEffect(() => {
    const element = content.current;
    if (!element || expanded) return;
    const measure = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, html]);
  return (
    <div className={`copilot-user-content${expanded ? " is-expanded" : ""}`}>
      <div
        ref={content}
        className="copilot-message-markdown"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {overflowing && (
        <button
          type="button"
          className="copilot-user-content-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
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
  const hasPendingConfirmation = tools.some((tool) => tool.pending);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(hasPendingConfirmation);
  }, [hasPendingConfirmation, typing]);
  if (!tools.length || waitingForAnswer) return null;
  const activeTool = [...tools].reverse().find((tool) => tool.pending || tool.status === "running") || tools.at(-1)!;
  const completedCount = tools.filter((tool) => tool.status === "success" || tool.status === "error").length;
  const hasError = tools.some((tool) => tool.status === "error");
  let activityTitle = activeTool.summary || activeTool.name || title || "执行过程";
  if (hasPendingConfirmation) activityTitle = "等待确认";
  else if (hasError && !typing) activityTitle = "执行过程有错误";
  return (
    <section
      className={`copilot-run-activity${typing ? " is-running" : ""}${hasPendingConfirmation ? " is-pending" : ""}`}
    >
      <details
        className={`copilot-tool-trace${typing ? " is-running" : ""}`}
        open={expanded}
          onToggle={(event) => setExpanded(event.currentTarget.open)}
      >
          <summary>
            <IconSymbol name="wrench" className="copilot-tool-disclosure-icon" />
            <span className="copilot-tool-title">{activityTitle}</span>
            <span className="copilot-tool-count">{completedCount}/{tools.length} 步</span>
            {typing && (
              <button
                className="copilot-run-stop"
                type="button"
                title="停止 Agent"
                aria-label="停止 Agent"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  controller.cancel();
                }}
              >
                <span aria-hidden="true" />
              </button>
            )}
            <IconSymbol name="chevron-down" />
          </summary>
          <ol className="copilot-trace-steps">
            {tools.map((tool, index) => {
              const status = tool.pending ? "等待确认" : tool.status === "error" ? "运行失败" : tool.status === "running" ? "正在运行" : "已运行";
              const description = tool.summary || tool.name || "处理步骤";
              const icon = tool.kind === "skill" ? "puzzle" : tool.kind === "recipe" ? "file" : tool.kind === "system" ? "layers" : "wrench";
              return (
                <li
                  className={`copilot-trace-step${tool.pending ? " is-pending" : tool.status === "error" ? " is-error" : tool.status === "running" ? " is-running" : " is-complete"}`}
                  key={tool.id || `tool-${index}`}
                >
                  <div className="copilot-trace-step-line" title={`${status} ${description}`}>
                    <IconSymbol name={icon} />
                    <span><strong>{status}</strong> {description}</span>
                  </div>
                  {tool.pending && tool.interactionId && (
                    <span className="copilot-tool-confirm-actions">
                      <button type="button" onClick={() => controller.rejectToolCall({ interactionId: tool.interactionId })}>拒绝</button>
                      <button type="button" className="primary" onClick={() => controller.approveToolCall({ interactionId: tool.interactionId })}>
                        确认执行
                      </button>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
      </details>
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
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [plan?.id]);
  if (!plan || plan.schemaVersion !== 2 || !stages.length) return null;
  const done = stages.filter((stage) => stage.status === "done").length;
  const stageItems = stages.map((stage, index) => ({
    key: stage.id || `stage-${index}`,
    title: stage.title || `阶段 ${index + 1}`,
    description: planStatusLabel[String(stage.status || "")] || stage.status,
    status: stage.status === "done"
      ? "success" as const
      : stage.status === "blocked"
        ? "error" as const
        : stage.status === "doing"
          ? "loading" as const
          : undefined,
    blink: stage.status === "doing",
    collapsible: Boolean(stage.description || stage.workItems?.length || stage.runtimeRefs?.length),
    content: (
      <div className="copilot-plan-stage-detail">
        {stage.description && <p>{stage.description}</p>}
        {stage.status === "pending" && !stage.authored && <small>阶段大纲 · 尚未编排工作项</small>}
        {!!stage.workItems?.length && (
          <div className="copilot-plan-work-items">
            {stage.workItems.map((workItem) => {
              const runtimeRef = stage.runtimeRefs?.find((ref) => ref.workItemId === workItem.id);
              return (
                <div key={workItem.id}>
                  <strong>{workItem.title}</strong>
                  <span>{workItem.outputType || "output"}</span>
                  {workItem.prompt && <p>{workItem.prompt}</p>}
                  {(runtimeRef?.nodeId || runtimeRef?.taskId) && <small>产物已绑定</small>}
                </div>
              );
            })}
          </div>
        )}
        {stage.blockedReason && <small className="error">{stage.blockedReason}</small>}
        {!!stage.runtimeRefs?.some((ref) => ref.nodeId) && (
          <button
            onClick={() => controller.focusNodes(
              stage.runtimeRefs?.flatMap((ref) => (ref.nodeId ? [ref.nodeId] : [])) || [],
            )}
          >
            定位画布产物
          </button>
        )}
      </div>
    ),
  }));
  return (
    <Collapse
      ghost
      className="copilot-production-plan"
      activeKey={expanded ? ["plan"] : []}
      onChange={(keys) => setExpanded(Array.isArray(keys) ? keys.includes("plan") : keys === "plan")}
      items={[{
        key: "plan",
        label: (
          <div className="copilot-plan-heading">
            <IconSymbol name="workflow" />
            <span>
              <small>{plan.executionMode === "execute" ? "制作与执行" : "画布规划"}</small>
              <strong>{plan.title || plan.goal || "画布制作"}</strong>
            </span>
            <em>{done}/{stages.length}</em>
            <Progress percent={(done / stages.length) * 100} showInfo={false} size="small" />
          </div>
        ),
        children: <ThoughtChain className="copilot-plan-chain" items={stageItems} />,
      }]}
    />
  );
}

function ArtifactCard({ artifact, onFocus }: {
  artifact: CopilotArtifact;
  onFocus: (nodeIds: string[]) => void;
}) {
  const [previewFailed, setPreviewFailed] = useState(false);
  const preview = useMediaPreviewCache({
    path: artifact.path,
    fallbackUrl: artifact.fallbackUrl,
    kind: artifact.kind,
    enabled: artifact.kind === "image" || artifact.kind === "video",
  });
  useEffect(() => setPreviewFailed(false), [preview.url]);
  const visual = !previewFailed && preview.url &&
    (artifact.kind === "image" || artifact.kind === "video");
  const icon = {
    image: "image", video: "film", audio: "waveform", text: "text", node: "layers",
  }[artifact.kind];
  const kindLabel = artifact.kind === "node" ? "画布节点" : {
    image: "图片", video: "视频", audio: "音频", text: "文本",
  }[artifact.kind];
  const status = {
    idle: "待执行", queued: "排队中", running: "生成中", failed: "失败",
    completed: "", partial_failed: "部分失败",
  }[artifact.status] ?? artifact.status;
  function openArtifact() {
    if ((artifact.kind === "image" || artifact.kind === "video") && preview.url) {
      openMediaViewer({ src: preview.url, kind: artifact.kind,
        title: artifact.title, filePath: artifact.path });
    } else if (artifact.kind === "text" && artifact.excerpt) {
      openMediaViewer({ src: artifact.excerpt, kind: "text", title: artifact.title,
        filePath: artifact.path });
    } else {
      onFocus([artifact.focusNodeId]);
    }
  }
  return (
    <div className="copilot-artifact-card">
      <button type="button" className="copilot-artifact-open" onClick={openArtifact}
        aria-label={`查看${kindLabel}：${artifact.title}`}>
      <span className={`copilot-artifact-preview is-${artifact.kind}`}>
        {visual && artifact.kind === "image" ? (
          <img src={preview.url} alt="" loading="lazy" onError={() => setPreviewFailed(true)} />
        ) : visual && artifact.kind === "video" ? (
          <video src={preview.url} muted preload="metadata" onError={() => setPreviewFailed(true)} />
        ) : artifact.kind === "text" && artifact.excerpt ? (
          <span className="copilot-artifact-excerpt">{artifact.excerpt}</span>
        ) : (
          <IconSymbol name={icon} />
        )}
        {artifact.kind === "video" && <span className="copilot-artifact-play"><IconSymbol name="play" /></span>}
      </span>
      <span className="copilot-artifact-info">
        <strong title={artifact.title}>{artifact.title}</strong>
        <small>{kindLabel}{status ? ` · ${status}` : ""}</small>
      </span>
      </button>
      <button type="button" className="copilot-artifact-locate"
        onClick={() => onFocus([artifact.focusNodeId])}
        aria-label={`在画布中定位：${artifact.title}`} title="在画布中定位">
        <IconSymbol name="maximize" />
      </button>
    </div>
  );
}

function TurnArtifacts({ refs, nodes, controller }: {
  refs?: CopilotArtifactRefs;
  nodes: WorkflowNodeData[];
  controller: CopilotController;
}) {
  const [expanded, setExpanded] = useState(true);
  const artifacts = artifactsForMessage(refs, nodes);
  if (!artifacts.length) return null;
  return (
    <section className="copilot-turn-artifacts" aria-label="本轮产物">
      <button type="button" className="copilot-artifacts-heading" aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}>
        <span><IconSymbol name="layers" />本轮产物 <em>{artifacts.length}</em></span>
        <IconSymbol name="chevron-down" className={expanded ? "" : "is-collapsed"} />
      </button>
      {expanded && (
        <div className="copilot-artifacts-grid">
          {artifacts.map((artifact) => (
            <ArtifactCard key={artifact.nodeId} artifact={artifact} onFocus={controller.focusNodes} />
          ))}
        </div>
      )}
    </section>
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
  artifactNodes: WorkflowNodeData[];
  busy: boolean;
  conversations: ConversationItem[];
  activeConversationId: string;
  textModel: string;
  textModels: Array<{ id: string; label: string; iconId: string }>;
  controller: CopilotController;
}
export const CopilotPanel = forwardRef<CopilotPanelHandle, CopilotPanelProps>(function CopilotPanel({
  messages,
  nodes,
  artifactNodes,
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
    Array<{
      id: string;
      alias: string;
      title: string;
      typeLabel: string;
      imageAttachment?: Record<string, unknown> | null;
    }>
  >([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionStart, setMentionStart] = useState(-1);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [clarificationAnswers, setClarificationAnswers] = useState<
    Record<string, Record<string, string[]>>
  >({});
  const sender = useRef<SenderRef>(null);
  const messageList = useRef<HTMLDivElement>(null);
  const followsLatest = useRef(true);
  const previousMessageCount = useRef(messages.length);
  const domainRevision = useSyncExternalStore(subscribeDomain, getDomainRevision, getDomainRevision);
  const enabledSkills = useMemo(() => (skillsStore.skills as Array<{
    id: string; name?: string; description?: string; enabled?: boolean;
  }>).filter((skill) => skill.enabled !== false), [domainRevision]);
  const selectedSkill = useMemo(
    () => enabledSkills.find((skill) => skill.id === selectedSkillId) || null,
    [enabledSkills, selectedSkillId],
  );
  const presentedMessages = useMemo(() => compactRepeatedFailures(messages), [messages]);
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
        })),
    [nodes, aliasMaps],
  );
  const mentionableRef = useRef(mentionable);
  mentionableRef.current = mentionable;
  const attachNodeImage = useCallback((node: (typeof mentionable)[number]) => {
    const attachment = node.imageAttachment;
    if (!attachment) return;
    const key = nodeChatAttachmentKey(attachment);
    setAttachments((items) => (
      key && items.some((item) => nodeChatAttachmentKey(item) === key)
        ? items
        : [...items, { ...attachment }]
    ));
  }, []);
  const addNodeMentionById = useCallback(
    (nodeId: string) => {
      const found = mentionableRef.current.find((node) => node.id === nodeId);
      if (!found) return;
      setMentions((items) => (items.some((item) => item.id === found.id) ? items : [...items, found]));
      attachNodeImage(found);
      setMessage((value) => {
        const token = `@${found.alias}`;
        if (value.includes(token)) return value;
        const trimmed = value.trimEnd();
        return trimmed ? `${trimmed} ${token} ` : `${token} `;
      });
      requestAnimationFrame(() => sender.current?.focus());
    },
    [attachNodeImage],
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
    const input = sender.current?.inputElement as HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? value.length;
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
    const input = sender.current?.inputElement as HTMLTextAreaElement | null;
    const caret = input?.selectionStart ?? message.length;
    const before = message.slice(0, mentionStart >= 0 ? mentionStart : caret);
    const token = `@${node.alias}`;
    setMessage(`${before}${token} ${message.slice(caret).replace(/^[^\s@]*/, "")}`);
    setMentions((items) => (items.some((item) => item.id === node.id) ? items : [...items, node]));
    attachNodeImage(node);
    setMentionOpen(false);
    requestAnimationFrame(() => sender.current?.focus());
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
    if (!textModels.length) return;
    const aliases = new Set(
      (message.match(/@N-[A-Z0-9]+(?:-\d+)?\b/gi) || []).map((item) => item.slice(1).toUpperCase()),
    );
    const activeMentions = mentions.filter((item) => aliases.has(item.alias.toUpperCase()));
    if (!message.trim() && !attachments.length && !activeMentions.length) {
      return;
    }
    const accepted = controller.send({
      text: message.trim(),
      model: textModel,
      attachments: attachments.map((item) => ({ ...item })),
      nodeMentions: activeMentions.map(({ imageAttachment: _imageAttachment, ...item }) => ({ ...item })),
    });
    if (!accepted) return;
    setMessage("");
    setAttachments([]);
    setMentions([]);
    setMentionOpen(false);
    setSelectedSkillId(null);
  }
  function useAutomaticSkill() {
    if (selectedSkillId) {
      const prefix = `/${selectedSkillId}`;
      setMessage((value) => {
        const current = value.trimStart();
        if (current === prefix) return "";
        if (current.startsWith(`${prefix} `)) return current.slice(prefix.length).trimStart();
        return value;
      });
    }
    setSelectedSkillId(null);
    requestAnimationFrame(() => sender.current?.focus());
  }
  function selectSkill(skill: (typeof enabledSkills)[number]) {
    let current = message.trimStart();
    if (selectedSkillId) {
      const previous = `/${selectedSkillId}`;
      if (current === previous) current = "";
      else if (current.startsWith(`${previous} `)) current = current.slice(previous.length).trimStart();
    }
    setMessage(current ? `/${skill.id} ${current}` : `/${skill.id} `);
    setSelectedSkillId(skill.id);
    setMentionOpen(false);
    requestAnimationFrame(() => sender.current?.focus());
  }
  function keydown(event: KeyboardEvent) {
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
    if (event.key === "Escape") {
      setMentionOpen(false);
    }
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
  const activeTextModel = textModels.find((model) => model.id === textModel);
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: "#28231f",
          colorInfo: "#28231f",
          colorText: "#28231f",
          colorTextSecondary: "#746d66",
          colorBorder: "#ded9d2",
          colorBgContainer: "#fbfaf8",
          borderRadius: 10,
          fontSize: 13,
        },
      }}
    >
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
          {presentedMessages.length ? (
            presentedMessages.map((item, messageIndex) => (
              <Bubble
                key={`${item.id || "message"}-${messageIndex}`}
                placement={item.role === "user" ? "end" : "start"}
                variant={item.role === "user" ? "filled" : "borderless"}
                loading={item.role === "assistant" && item.typing && !item.content && !item.toolCalls?.length}
                rootClassName={`copilot-message is-${item.role}${item.typing ? " typing" : ""}${item.error ? " has-error" : ""}`}
                content={<div className="copilot-message-body">
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
                {item.content && (
                  item.role === "user"
                    ? <CollapsibleUserMessage html={messageMarkdown(item)} />
                    : <div
                        className="copilot-message-markdown"
                        dangerouslySetInnerHTML={{ __html: messageMarkdown(item) }}
                      />
                )}
                {item.meta?.length ? (
                  <div className="copilot-message-meta">
                    {item.meta.map((value, index) => (
                      <span key={index}>{value}</span>
                    ))}
                  </div>
                ) : null}
                {item.role === "user" && ["queued", "sent"].includes(item.deliveryStage || "") && (
                  <small className="copilot-message-delivery" role="status">
                    {item.deliveryStage === "queued" ? "排队中" : "已发送，等待 Agent 接收"}
                  </small>
                )}
                {item.role === "user" && item.deliveryStage === "failed" && item.deliveryError &&
                  !repeatsFollowingFailure(item, presentedMessages[messageIndex + 1]) && (
                  <small className="copilot-message-delivery is-error">投递失败：{item.deliveryError}</small>
                )}
                {item.error && (
                  <div className="copilot-failure-log" role="alert">
                    <IconSymbol name="warning" />
                    <span className="copilot-failure-log-title">
                      <strong>系统</strong>
                      <i>·</i>
                      <span>{item.diagnosis?.title || "Agent 运行失败"}</span>
                      {Number(item.repeatedFailureCount || 0) > 1 && (
                        <small>重复 {item.repeatedFailureCount} 次</small>
                      )}
                    </span>
                    {item.retryable && !busy && (
                      <button
                        className="copilot-failure-retry"
                        type="button"
                        onClick={() => controller.retry(item.id)}
                      >
                        重试
                      </button>
                    )}
                    <details>
                      <summary>详情</summary>
                      <div>
                        <span>{item.diagnosis?.primaryAction || "检查配置后重试"}</span>
                        <p>{item.diagnosis?.message || item.error}</p>
                      </div>
                    </details>
                  </div>
                )}
                {!item.error && item.diagnosis && (
                  <div className="copilot-message-diagnosis">
                    <strong>{item.diagnosis.primaryAction || "请检查 Runtime 后重试"}</strong>
                    {item.diagnosis.suggestions?.length ? (
                      <ul>{item.diagnosis.suggestions.map((suggestion) => <li key={suggestion}>{suggestion}</li>)}</ul>
                    ) : null}
                    {item.diagnosis.code && <small>诊断码：{item.diagnosis.code}</small>}
                  </div>
                )}
                <ProductionPlanCard plan={item.productionPlan} controller={controller} />
                {item.role === "assistant" && (
                  <TurnArtifacts refs={item.artifactRefs} nodes={artifactNodes} controller={controller} />
                )}
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
                {item.role === "assistant" && !item.typing && !item.error && item.content && (
                  <div className="copilot-message-actions">
                    <button type="button" title="复制回复" onClick={() => {
                      void navigator.clipboard.writeText(item.content || "")
                        .then(() => showToast("回复已复制"))
                        .catch(() => showToast("复制失败，请检查剪贴板权限"));
                    }}>
                      <IconSymbol name="copy" />
                      <span>复制回复</span>
                    </button>
                  </div>
                )}
                </div>}
              />
            ))
          ) : (
            <div className="copilot-welcome">
              <InteractiveLogo src="./shotloom-logo.png" className="copilot-welcome-logo" />
              <strong>描述你想完成的内容</strong>
              <p>也可以用 @ 引用画布节点，Agent 会结合当前内容继续创作</p>
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
        <div className={`copilot-input${!textModels.length ? " has-api-warning" : ""}`}>
          {!textModels.length && (
            <div className="copilot-api-warning">
              <IconSymbol name="warning" />
              <span>
                <strong>还未配置文本模型</strong>
                <small>前往“设置 → API 厂商”完成配置后即可开始创作</small>
              </span>
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
                  <strong title={node.title}>{node.title}</strong>
                  <span title={`@${node.alias}`}>@{node.alias}</span>
                  <em>{node.typeLabel}</em>
                </button>
              ))}
              {!options.length && <p>没有匹配的节点</p>}
            </div>
          )}
          <Sender
            ref={sender}
            value={message}
            placeholder="输入消息，@ 引用画布节点…"
            loading={busy}
            disabled={!textModels.length}
            submitType="enter"
            autoSize={{ minRows: 1, maxRows: 6 }}
            onSubmit={send}
            onCancel={controller.cancel}
            onChange={(value) => {
              setMessage(value);
              const selected = enabledSkills.find((skill) => (
                value === `/${skill.id}` || value.startsWith(`/${skill.id} `)
              ));
              setSelectedSkillId(selected?.id || null);
              requestAnimationFrame(() => updateMention(value));
            }}
            onKeyDown={keydown}
            header={(mentions.length || attachments.length) ? (
              <div className="copilot-sender-context">
                {mentions.length > 0 && (
                  <div className="copilot-node-mentions">
                    {mentions.map((item) => (
                      <span key={item.id} title={`@${item.alias} · ${item.title}`}>
                        <IconSymbol name={item.imageAttachment ? "image" : "workflow"} />
                        <strong>{item.title}</strong>
                        <small>@{item.alias}</small>
                        <button
                          type="button"
                          aria-label={`移除节点引用：${item.title}`}
                          onClick={() => {
                            setMentions((items) => items.filter((value) => value.id !== item.id));
                            setMessage((value) => value.replace(new RegExp(`@${item.alias}\\s*`, "ig"), ""));
                          }}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}
                {attachments.length > 0 && (
                  <Attachments
                    items={attachments.map((file, index) => ({
                      uid: String(index),
                      name: String(file.name || file.fileName || "附件"),
                      status: "done" as const,
                    }))}
                    onRemove={(file) => {
                      setAttachments((items) => items.filter((_, index) => String(index) !== file.uid));
                      return true;
                    }}
                  />
                )}
              </div>
            ) : undefined}
            footer={(
              <div className="copilot-sender-footer">
                <div className="copilot-sender-tools">
                  <button className="copilot-attach-trigger" type="button" title="添加文件" onClick={() => void attach()}>
                    <IconSymbol name="paperclip" />
                  </button>
                  <Dropdown
                    trigger={["click"]}
                    placement="topLeft"
                    overlayClassName="copilot-skill-dropdown"
                    menu={{
                      selectedKeys: selectedSkill ? [selectedSkill.id] : [],
                      items: [
                        {
                          key: "automatic",
                          label: <span className="copilot-skill-menu-item"><strong>交给 Agent 选择</strong><small>根据任务按需使用技能</small></span>,
                        },
                        { type: "divider" },
                        ...enabledSkills.map((skill) => ({
                          key: skill.id,
                          label: (
                            <span className="copilot-skill-menu-item">
                              <strong>{skill.name || skill.id}</strong>
                              <small>/{skill.id}</small>
                            </span>
                          ),
                        })),
                      ],
                      onClick: ({ key }) => {
                        if (key === "automatic") return useAutomaticSkill();
                        const skill = enabledSkills.find((item) => item.id === key);
                        if (skill) selectSkill(skill);
                      },
                    }}
                  >
                    <button
                      type="button"
                      className={`copilot-skill-trigger${selectedSkill ? " is-active" : ""}`}
                      title={selectedSkill ? `已选择：${selectedSkill.name || selectedSkill.id}` : "Agent 根据任务自动选择技能，可在这里指定"}
                    >
                      <IconSymbol name="puzzle" />
                      <span>{selectedSkill ? selectedSkill.name || selectedSkill.id : "技能"}</span>
                    </button>
                  </Dropdown>
                  <Dropdown
                    trigger={["click"]}
                    placement="topLeft"
                    overlayClassName="copilot-model-dropdown"
                    menu={{
                      selectedKeys: textModel ? [textModel] : [],
                      items: textModels.map((model) => ({
                        key: model.id,
                        label: (
                          <span className="copilot-model-option">
                            <span className="copilot-model-brand">
                              <ProviderBrandIcon icon={model.iconId} />
                            </span>
                            <span className="copilot-model-copy">
                              <strong>{model.label}</strong>
                              <small>{model.id}</small>
                            </span>
                            {model.id === textModel && <IconSymbol name="check" />}
                          </span>
                        ),
                      })),
                      onClick: ({ key }) => controller.changeModel(key),
                    }}
                  >
                    <button
                      className="copilot-model-trigger"
                      type="button"
                      aria-label="选择模型"
                      disabled={!textModels.length}
                      title={activeTextModel?.label || "选择模型"}
                    >
                      <span className="copilot-model-brand">
                        <ProviderBrandIcon icon={activeTextModel?.iconId || "custom"} />
                      </span>
                      <span>{activeTextModel?.label || "模型"}</span>
                      <IconSymbol name="chevron-down" />
                    </button>
                  </Dropdown>
                </div>
                <div className="copilot-sender-options">
                  {busy && (message.trim() || attachments.length || mentions.length) ? (
                    <button
                      className="copilot-queue-button"
                      disabled={!textModels.length}
                      title="加入消息队列"
                      aria-label="加入消息队列"
                      onClick={send}
                    >
                      <IconSymbol name="send" /> 加入队列
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          />
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
          <Conversations
            className="copilot-drawer-list"
            activeKey={activeConversationId}
            items={conversations.map((conversation) => ({
              key: conversation.id,
              disabled: busy,
              label: (
                <span className="copilot-conversation-label">
                  <strong>{conversation.title || "新对话"}</strong>
                  {Number(conversation.pendingInteractionCount) > 0 && (
                    <small>{conversation.waitingKind === "question" ? "等待回答" : "等待确认"}</small>
                  )}
                </span>
              ),
            }))}
            onActiveChange={(id) => {
              controller.selectConversation(id);
              setDrawer(false);
            }}
            menu={(conversation) => ({
              items: [{ key: "delete", label: "删除会话", danger: true, disabled: busy }],
              onClick: ({ key, domEvent }) => {
                domEvent.stopPropagation();
                if (key !== "delete") return;
                const item = conversations.find((value) => value.id === conversation.key);
                if (window.confirm(`删除会话“${item?.title || "新对话"}”？\n该会话的消息和 Agent 上下文将无法恢复。`)) {
                  controller.deleteConversation(conversation.key);
                }
              },
            })}
          />
        </aside>
      )}
    </aside>
    </ConfigProvider>
  );
});
