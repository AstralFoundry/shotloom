import { type MouseEvent, type ReactNode, useMemo, useState } from "react";
import { formatTime } from "../../utils/format.js";
import { EmptyState } from "../components/EmptyState";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { StatusPill } from "../components/StatusPill";

export interface GenerationTask {
  id: string;
  title?: string;
  type?: string;
  status: string;
  progress?: number;
  model?: string;
  nodeId?: string;
  error?: string;
  retryCount?: number;
  maxRetries?: number;
  createdAt?: string;
  historical?: boolean;
  canRetry?: boolean;
}

interface TasksViewProps {
  tasks: GenerationTask[];
  evaluationDetails?: ReactNode;
  onCancel: (id: string) => void | Promise<void>;
  onRetry: (id: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

const typeLabels: Record<string, string> = {
  imageGeneration: "图片生成",
  videoGeneration: "视频生成",
  audioGeneration: "音频生成",
  textGeneration: "文本生成",
};
const typeIcons: Record<string, IconName> = {
  imageGeneration: "image",
  videoGeneration: "play",
  audioGeneration: "waveform",
  textGeneration: "chat",
};

export function TasksView(
  { tasks, evaluationDetails, onCancel, onRetry, onClear }: TasksViewProps,
) {
  const [keyword, setKeyword] = useState("");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
      ),
    [tasks],
  );
  const filtered = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return query
      ? sorted.filter((task) =>
        [task.title, task.type, task.status, task.error, task.nodeId].join(" ")
          .toLowerCase().includes(query)
      )
      : sorted;
  }, [keyword, sorted]);
  const activeCount =
    sorted.filter((task) => ["running", "queued"].includes(task.status)).length;

  function openMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (
      (event.target as Element).closest(
        ".task-record, .task-context-menu, .agent-evaluation-list",
      )
    ) return;
    setMenu({
      x: Math.min(event.clientX, window.innerWidth - 202),
      y: Math.min(event.clientY, window.innerHeight - 54),
    });
  }

  async function clear() {
    setMenu(null);
    if (sorted.length && window.confirm("确定清空当前项目的全部任务记录吗？")) {
      await onClear();
    }
  }

  return (
    <>
      <ProjectScopeHeader
        title="项目任务"
        subtitle={`${filtered.length} 个任务${activeCount ? ` · ${activeCount} 个进行中` : ""}`}
        flat
      />
      <div
        className="scroll-area task-browser"
        onClick={() => setMenu(null)}
        onContextMenu={openMenu}
      >
        <label className="task-search">
          <IconSymbol name="search" />
          <input
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="搜索任务、类型、状态或错误"
          />
        </label>
        <div className="task-list-summary">
          <span>生成任务</span>
          <span>{filtered.length} 个任务 · {activeCount} 个进行中</span>
        </div>
        {!filtered.length
          ? (
            <EmptyState
              icon="task"
              text={keyword ? "没有匹配的任务记录。" : "暂无生成任务"}
            />
          )
          : (
            <section className="task-record-list">
              {filtered.map((task) => {
                const progress = task.status === "completed" ? 100 : Math.min(
                  100,
                  Math.max(0, Math.round(Number(task.progress) || 0)),
                );
                const status = task.historical ? "historical" : task.status;
                const active = ["running", "queued"].includes(task.status);
                return (
                  <article key={task.id} className={`task-record is-${status}`}>
                    <div className="task-record-icon">
                      <IconSymbol name={typeIcons[task.type || ""] || "task"} />
                    </div>
                    <div className="task-record-main">
                      <div className="task-record-title">
                        <strong>
                          {task.title || typeLabels[task.type || ""] ||
                            task.type || "生成任务"}
                        </strong>
                        <span>
                          {typeLabels[task.type || ""] || task.type ||
                            "生成任务"}
                        </span>
                        <StatusPill status={status} />
                      </div>
                      <p className={`task-record-description${task.error ? " is-error" : ""}`}>
                        {task.error
                          ? `${task.historical ? `旧模型 ${task.model} 的历史错误：` : ""}${task.error}`
                          : task.model
                            ? `使用 ${task.model} 执行${typeLabels[task.type || ""] || "生成"}任务`
                            : `${typeLabels[task.type || ""] || "生成"}任务`}
                      </p>
                      <div className="task-record-meta">
                        <span>
                          {task.id
                            ? `#${String(task.id).slice(-8)}`
                            : "未分配编号"}
                        </span>
                        {Boolean(task.retryCount) && (
                          <em>
                            已重试 {task.retryCount}/{task.maxRetries ?? 2}
                          </em>
                        )}
                        <time>{formatTime(task.createdAt)}</time>
                      </div>
                      {active && (
                        <div className="task-record-progress">
                          <div className="task-progress-track">
                            <i><b style={{ width: `${progress}%` }} /></i>
                          </div>
                          <strong>{progress}%</strong>
                        </div>
                      )}
                    </div>
                    <div className="task-record-actions">
                      {task.status === "running" && (
                        <button
                          className="icon-button"
                          title="取消任务"
                          onClick={() => void onCancel(task.id)}
                        >
                          <IconSymbol name="x" />
                        </button>
                      )}
                      {task.canRetry && (
                        <button
                          className="icon-button"
                          title="重试任务"
                          onClick={() => void onRetry(task.id)}
                        >
                          <IconSymbol name="refresh" />
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </section>
          )}
        <div className="task-agent-details">{evaluationDetails}</div>
        {menu && (
          <div
            className="task-context-menu"
            style={{ left: menu.x, top: menu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              disabled={!sorted.length}
              onClick={() => void clear()}
            >
              <IconSymbol name="trash" />清空任务记录
            </button>
          </div>
        )}
      </div>
    </>
  );
}
