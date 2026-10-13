import { useEffect, useMemo, useState } from "react";
import { agentToolIcon, agentToolTitle } from "../../agent/core/toolRegistry";
import { useMediaPreviewCache } from "../canvas/useMediaPreviewCache";
import { IconSymbol } from "../components/IconSymbol";
import type { AgentController, AgentToolCall } from "./contracts";
import styles from "./ToolTrace.module.css";

// 只有运行时合成的行（技能/模板/系统）由界面决定图标；
// 真实工具的图标跟着工具声明走，新增工具不会退回统一的扳手。
const kindIcon: Record<string, string> = {
  skill: "puzzle",
  recipe: "file",
  system: "layers",
};

const statusLabel: Record<string, string> = {
  pending: "等待确认",
  running: "正在运行",
  success: "已运行",
  error: "运行失败",
};

// 工具名是给模型和运行时用的，界面必须换成注册表里的中文标题，
// 否则新增工具就得在展示层再维护一份名字表。
const toolTitle = (tool: AgentToolCall) =>
  tool.title || agentToolTitle(String(tool.name || "")) || tool.name || "处理步骤";

const toolIcon = (tool: AgentToolCall) =>
  kindIcon[String(tool.kind || "")] || agentToolIcon(String(tool.name || ""));

export function ToolTrace({
  tools,
  typing,
  waitingForAnswer,
  controller,
}: {
  tools: AgentToolCall[];
  typing?: boolean;
  waitingForAnswer?: boolean;
  controller: AgentController;
}) {
  const hasPending = tools.some((tool) => tool.pending);
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(hasPending), [hasPending]);
  if (!tools.length || waitingForAnswer) return null;

  const active =
    [...tools].reverse().find((tool) => tool.pending || tool.status === "running") ||
    tools[tools.length - 1];
  const settled = tools.filter((tool) => tool.status === "success" || tool.status === "error").length;
  const failed = tools.some((tool) => tool.status === "error");
  const headline = hasPending
    ? "等待确认"
    : failed && !typing
      ? "执行过程有错误"
      : toolTitle(active);
  const headlineDetail = hasPending || (failed && !typing) ? "" : active.output || active.summary || "";

  return (
    <section
      className={styles.trace}
      data-running={typing || undefined}
      data-open={open}
      data-pending={hasPending || undefined}
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconSymbol name={toolIcon(active)} className={styles.headIcon} />
        <span className={styles.headLabel}>
          <span className={styles.headTitle}>{headline}</span>
          {headlineDetail && <span className={styles.headDetail}>{headlineDetail}</span>}
        </span>
        <span className={styles.headCount}>
          {settled}/{tools.length}
        </span>
        {typing && (
          <span
            className={styles.stop}
            role="button"
            tabIndex={0}
            title="停止 Agent"
            aria-label="停止 Agent"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              controller.cancel();
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              controller.cancel();
            }}
          />
        )}
        <IconSymbol name="chevron-down" className={styles.headChevron} />
      </button>
      {open && (
        <ol className={styles.steps}>
          {tools.map((tool, index) => {
            const status = tool.pending ? "pending" : tool.status || "success";
            const previews = (tool.previews || []).filter((item) => item.path);
            return (
              <li
                key={tool.id || `tool-${index}`}
                className={styles.step}
                data-status={status}
              >
                <span
                  className={styles.stepLine}
                  title={`${statusLabel[status] || status} ${toolTitle(tool)} ${tool.summary || ""}`}
                >
                  <IconSymbol name={toolIcon(tool)} className={styles.stepIcon} />
                  <span className={styles.stepState}>{statusLabel[status] || status}</span>
                  <span className={styles.stepDetail}>
                    <span className={styles.stepTitle}>{toolTitle(tool)}</span>
                    {tool.summary && <span className={styles.stepSummary}>{tool.summary}</span>}
                  </span>
                </span>
                {(tool.output || previews.length) && (
                  <span className={styles.stepOutput}>
                    {!!tool.output && <span className={styles.outputText}>{tool.output}</span>}
                    {!!previews.length && (
                      <span className={styles.previewRow}>
                        {previews.map((preview) => (
                          <PreviewImage
                            key={preview.path}
                            path={preview.path}
                            alt={`${toolTitle(tool)} ${preview.label}`}
                          />
                        ))}
                      </span>
                    )}
                  </span>
                )}
                {tool.pending && tool.interactionId && (
                  <PendingDecision tool={tool} controller={controller} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * 工具产出的本地位图缩略图。必须走项目的图片预览缓存（readImagePreview → blob），
 * 不能直接引用 asset 协议：画布上的图片节点也是这条路径，行为才一致。
 */
function PreviewImage({ path, alt }: { path: string; alt: string }) {
  const { url } = useMediaPreviewCache({ path, kind: "image", maxSize: 320 });
  if (!url) return null;
  return <img className={styles.preview} src={url} alt={alt} title={alt} loading="lazy" />;
}

/** 确认不是只有"放行/拒绝"两个选项：允许在批准前直接改参数。 */
function PendingDecision({
  tool,
  controller,
}: {
  tool: AgentToolCall;
  controller: AgentController;
}) {
  const interactionId = String(tool.interactionId || "");
  const original = useMemo(() => JSON.stringify(tool.pendingArgs || {}, null, 2), [tool.pendingArgs]);
  const [draft, setDraft] = useState(original);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(original), [original]);
  if (!interactionId) return null;

  let modifiedArgs: Record<string, unknown> | undefined;
  let parseError = "";
  const text = draft.trim();
  if (text !== original.trim()) {
    if (!text) {
      modifiedArgs = {};
    } else {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          modifiedArgs = parsed as Record<string, unknown>;
        } else {
          parseError = "参数必须是一个 JSON 对象";
        }
      } catch {
        parseError = "JSON 解析失败，请检查格式";
      }
    }
  }
  const changed = modifiedArgs !== undefined;

  return (
    <div className={styles.decision}>
      {tool.pendingArgs && (
        <div className={styles.args}>
          <button
            type="button"
            className={styles.argsToggle}
            aria-expanded={editing}
            onClick={() => setEditing((value) => !value)}
          >
            <IconSymbol name={editing ? "chevron-up" : "chevron-right"} />
            <span>参数{changed ? "（已修改）" : ""}</span>
          </button>
          {editing && (
            <>
              <textarea
                className={styles.argsEditor}
                value={draft}
                rows={6}
                spellCheck={false}
                aria-label={`修改 ${tool.name || "工具"} 参数`}
                onChange={(event) => setDraft(event.target.value)}
              />
              {parseError ? (
                <small className={styles.argsError}>{parseError}</small>
              ) : (
                changed && (
                  <button type="button" className={styles.argsReset} onClick={() => setDraft(original)}>
                    恢复原参数
                  </button>
                )
              )}
            </>
          )}
        </div>
      )}
      <div className={styles.decisionActions}>
        <button type="button" onClick={() => controller.rejectToolCall({ interactionId })}>
          拒绝
        </button>
        <button
          type="button"
          className={styles.primary}
          disabled={Boolean(parseError)}
          onClick={() =>
            controller.approveToolCall({
              interactionId,
              ...(changed ? { modifiedArgs } : {}),
            })
          }
        >
          {changed ? "按修改执行" : "确认执行"}
        </button>
      </div>
    </div>
  );
}
