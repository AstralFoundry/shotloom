import { useEffect, useRef, useState, type RefObject } from "react";
import { IconSymbol } from "../components/IconSymbol";
import { InteractiveLogo } from "../components/InteractiveLogo";
import {
  messageMarkdown,
  repeatsFollowingFailure,
  type PresentedAgentMessage,
} from "./messagePresentation";
import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";
import { ToolTrace } from "./ToolTrace";
import { PlanCard } from "./PlanCard";
import { ArtifactList } from "./ArtifactList";
import { ReferenceCard } from "./ReferenceCard";
import { ClarificationCard } from "./ClarificationCard";
import type { AgentController, AgentMessage } from "./contracts";
import styles from "./Transcript.module.css";

interface TranscriptProps {
  listRef: RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  messages: PresentedAgentMessage[];
  busy: boolean;
  editorMode: boolean;
  artifactNodes: WorkflowNodeData[];
  clarificationAnswers: Record<string, Record<string, string[]>>;
  setClarificationAnswers: (
    next: (current: Record<string, Record<string, string[]>>) => Record<string, Record<string, string[]>>,
  ) => void;
  controller: AgentController;
}

export function Transcript({
  listRef,
  onScroll,
  messages,
  busy,
  editorMode,
  artifactNodes,
  clarificationAnswers,
  setClarificationAnswers,
  controller,
}: TranscriptProps) {
  // 底部提示只补“还没有任何可见反馈”的空档（消息排队、占位消息尚未建立）。
  // 一旦有正在流式的助手消息，思考中、正文或工具轨迹本身就是反馈，不能再叠一行。
  const running = busy && !messages.some((message) => message.role === "assistant" && message.typing);
  return (
    <div ref={listRef} className={styles.list} onScroll={onScroll}>
      {messages.length ? (
        messages.map((message, index) => (
          <MessageRow
            key={`${message.id || "message"}-${index}`}
            message={message}
            next={messages[index + 1]}
            isLast={index === messages.length - 1}
            busy={busy}
            artifactNodes={artifactNodes}
            clarificationAnswers={clarificationAnswers}
            setClarificationAnswers={setClarificationAnswers}
            controller={controller}
          />
        ))
      ) : (
        <EmptyState editorMode={editorMode} />
      )}
      {running && (
        <div className={styles.running} role="status" aria-live="polite">
          <ShimmerText>Agent 正在处理…</ShimmerText>
        </div>
      )}
    </div>
  );
}

function EmptyState({ editorMode }: { editorMode: boolean }) {
  return (
    <div className={styles.empty}>
      {editorMode ? (
        <IconSymbol name="scissors" className={styles.emptyMark} />
      ) : (
        <InteractiveLogo src="./shotloom-logo.png" className={styles.emptyMark} />
      )}
      <strong>{editorMode ? "直接描述想怎么剪" : "描述你想完成的内容"}</strong>
      <p>
        {editorMode
          ? "例如：剪掉开头两秒，把结尾字幕改成“谢谢观看”。Agent 会读取当前时间线再操作。"
          : "也可以用 @ 引用画布节点，Agent 会结合当前内容继续创作"}
      </p>
    </div>
  );
}

function ShimmerText({ children }: { children: React.ReactNode }) {
  return (
    <span className={styles.busy}>
      <span className={styles.dots} aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className={styles.shimmer}>{children}</span>
    </span>
  );
}

function MessageRow({
  message,
  next,
  isLast,
  busy,
  artifactNodes,
  clarificationAnswers,
  setClarificationAnswers,
  controller,
}: {
  message: PresentedAgentMessage;
  next?: PresentedAgentMessage;
  isLast: boolean;
  busy: boolean;
  artifactNodes: WorkflowNodeData[];
  clarificationAnswers: Record<string, Record<string, string[]>>;
  setClarificationAnswers: TranscriptProps["setClarificationAnswers"];
  controller: AgentController;
}) {
  const isUser = message.role === "user";
  const pendingQuestions = message.clarifications?.filter((question) => !question.answered) || [];
  const loading = !isUser && message.typing && !message.content && !message.toolCalls?.length;

  if (isUser) {
    return (
      <div className={styles.userRow} data-last={isLast || undefined}>
        <div className={styles.bubble}>
          <UserBody html={messageMarkdown(message)} />
        </div>
        {!!message.references?.length && (
          <div className={styles.references}>
            {message.references.map((reference, index) => (
              <ReferenceCard key={`${reference.label}-${index}`} reference={reference} />
            ))}
          </div>
        )}
        {message.deliveryStage === "failed" && message.deliveryError &&
          !repeatsFollowingFailure(message, next) && (
          <small className={styles.deliveryError}>投递失败：{message.deliveryError}</small>
        )}
      </div>
    );
  }

  return (
    <article className={styles.assistantRow} data-error={message.error ? "true" : undefined}>
      {loading ? (
        <div className={styles.loading}><ShimmerText>思考中</ShimmerText></div>
      ) : (
        <>
          <ToolTrace
            tools={message.toolCalls || []}
            subagents={message.subagents || []}
            typing={message.typing}
            waitingForAnswer={pendingQuestions.length > 0}
            controller={controller}
          />
          {message.content && (
            <div
              className={styles.markdown}
              dangerouslySetInnerHTML={{ __html: messageMarkdown(message) }}
            />
          )}
          {!!message.meta?.length && (
            <div className={styles.meta}>
              {message.meta.map((value, index) => (
                <span key={index}>{value}</span>
              ))}
            </div>
          )}
          {message.error && <FailureBlock message={message} busy={busy} controller={controller} />}
          {!message.error && message.diagnosis && (
            <div className={styles.diagnosis}>
              <strong>{message.diagnosis.primaryAction || "请检查 Runtime 后重试"}</strong>
              {!!message.diagnosis.suggestions?.length && (
                <ul>
                  {message.diagnosis.suggestions.map((suggestion) => (
                    <li key={suggestion}>{suggestion}</li>
                  ))}
                </ul>
              )}
              {message.diagnosis.code && <small>诊断码：{message.diagnosis.code}</small>}
            </div>
          )}
          <PlanCard plan={message.productionPlan} controller={controller} />
          <ArtifactList refs={message.artifactRefs} nodes={artifactNodes} controller={controller} />
          {pendingQuestions.map((question, index) => (
            <ClarificationCard
              key={question.interactionId || index}
              question={question}
              answers={clarificationAnswers[String(question.interactionId || "")] || {}}
              onAnswers={(questionId, values) =>
                setClarificationAnswers((current) => {
                  const interactionId = String(question.interactionId || "");
                  return {
                    ...current,
                    [interactionId]: { ...(current[interactionId] || {}), [questionId]: values },
                  };
                })
              }
              controller={controller}
            />
          ))}
        </>
      )}
    </article>
  );
}

function UserBody({ html }: { html: string }) {
  const content = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  useEffect(() => setExpanded(false), [html]);
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
    <div
      className={styles.userBody}
      data-expanded={expanded || undefined}
      data-clamped={overflowing && !expanded ? "true" : undefined}
    >
      <div ref={content} className={styles.markdown} dangerouslySetInnerHTML={{ __html: html }} />
      {overflowing && (
        <button
          type="button"
          className={styles.expand}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : "展开"}
        </button>
      )}
    </div>
  );
}

function FailureBlock({
  message,
  busy,
  controller,
}: {
  message: AgentMessage & { repeatedFailureCount?: number };
  busy: boolean;
  controller: AgentController;
}) {
  return (
    <div className={styles.failure} role="alert">
      <span className={styles.failureDot} aria-hidden="true" />
      <div className={styles.failureCopy}>
        <strong>{message.diagnosis?.title || "Agent 运行失败"}</strong>
        <details>
          <summary>详情</summary>
          <p>{message.diagnosis?.primaryAction || "检查配置后重试"}</p>
          <code>{message.diagnosis?.message || message.error}</code>
        </details>
      </div>
      {Number(message.repeatedFailureCount || 0) > 1 && (
        <span className={styles.failureRepeat}>重复 {message.repeatedFailureCount} 次</span>
      )}
      {message.retryable && !busy && (
        <button type="button" className={styles.retry} onClick={() => controller.retry(message.id)}>
          重试
        </button>
      )}
    </div>
  );
}
