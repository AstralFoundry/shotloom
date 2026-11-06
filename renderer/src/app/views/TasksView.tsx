import { t } from '@/i18n';
import { isActiveTaskStatus } from '../../domain/tasks/TaskStatus';
import { type MouseEvent, type ReactNode, useMemo, useState } from "react";
import { App, Segmented, type MenuProps } from "antd";
import { formatTime } from "../../utils/format.ts";
import { ContextMenu } from "../components/ContextMenu";
import { EmptyState } from "../components/EmptyState";
import { type IconName, IconSymbol } from "../components/IconSymbol";
import { ProjectScopeHeader } from "../components/ProjectScopeHeader";
import { StatusPill } from "../components/StatusPill";
import {
  splitTaskError,
  taskSearchText,
  taskStatusFilters,
  taskTypeLabel,
} from "../adapters/taskAdapter";
import { SearchInput } from "../components/SearchInput";

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
  canAdoptRemote?: boolean;
}

interface TasksViewProps {
  tasks: GenerationTask[];
  evaluationDetails?: ReactNode;
  onCancel: (id: string) => void | Promise<void>;
  onRetry: (id: string) => void | Promise<void>;
  onAdoptRemote: (id: string, remoteTaskId: string) => Promise<{ success: boolean; error?: string; warning?: string } | void> | void;
  onClear: () => void | Promise<void>;
  onLocate: (nodeId: string) => void | Promise<void>;
}

const typeIcons: Record<string, IconName> = {
  imageGeneration: "image",
  videoGeneration: "play",
  audioGeneration: "waveform",
  textGeneration: "chat",
};

export function TasksView(
  { tasks, evaluationDetails, onCancel, onRetry, onAdoptRemote, onClear, onLocate }: TasksViewProps,
) {
  const { modal } = App.useApp();
  const [keyword, setKeyword] = useState("");
  const [filterKey, setFilterKey] = useState("all");
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [openErrors, setOpenErrors] = useState<Record<string, boolean>>({});
  const [adoptTaskId, setAdoptTaskId] = useState<string | null>(null);
  const [adoptValue, setAdoptValue] = useState("");
  const [adoptBusy, setAdoptBusy] = useState(false);
  const [adoptError, setAdoptError] = useState("");
  const sorted = useMemo(
    () =>
      [...tasks].sort((a, b) =>
        new Date(b.createdAt || 0).getTime() -
        new Date(a.createdAt || 0).getTime()
      ),
    [tasks],
  );
  const searched = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return query
      ? sorted.filter((task) => taskSearchText(task).includes(query))
      : sorted;
  }, [keyword, sorted]);
  const filters = useMemo(() => taskStatusFilters.map((filter) => ({
    ...filter,
    count: filter.key === "all"
      ? searched.length
      : searched.filter(filter.match).length,
  })), [searched]);
  const filtered = useMemo(() => {
    const active = taskStatusFilters.find((filter) => filter.key === filterKey);
    return active && active.key !== "all"
      ? searched.filter(active.match)
      : searched;
  }, [filterKey, searched]);
  const activeCount =
    sorted.filter((task) => isActiveTaskStatus(task.status)).length;

  function openMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (
      (event.target as Element).closest(
        ".task-record, .ant-dropdown, .agent-evaluation-list",
      )
    ) return;
    setMenu({ x: event.clientX, y: event.clientY });
  }

  function clear() {
    setMenu(null);
    if (!sorted.length) return;
    modal.confirm({
      title: t("ui.TasksView.text.b24f6c47"),
      okButtonProps: { danger: true },
      onOk: () => onClear(),
    });
  }

  async function submitAdopt(taskId: string) {
    const remoteTaskId = adoptValue.trim();
    if (!remoteTaskId) return;
    setAdoptBusy(true);
    setAdoptError("");
    try {
      const result = await onAdoptRemote(taskId, remoteTaskId);
      if (result && result.success === false) {
        setAdoptError(result.error || t("ui.TasksView.text.a06da7ec"));
        return;
      }
      setAdoptTaskId(null);
      setAdoptValue("");
    } catch (error) {
      setAdoptError(error instanceof Error ? error.message : String(error));
    } finally {
      setAdoptBusy(false);
    }
  }

  const taskMenuItems: MenuProps["items"] = [
    {
      key: "clear",
      danger: true,
      disabled: !sorted.length,
      icon: <IconSymbol name="trash" />,
      label: t("ui.TasksView.text.2f798109"),
    },
  ];

  return (
    <>
      <ProjectScopeHeader
        title={t("ui.navigation.label.f7c5769b")}
        subtitle={t("ui.TasksView.text.c8973961", { value0: sorted.length, value1: activeCount ? t("ui.TasksView.text.046ef490", { value0: activeCount }) : "" })}
        flat
      />
      <div
        className="scroll-area task-browser"
        onClick={() => setMenu(null)}
        onContextMenu={openMenu}
      >
        <label className="task-search">
          <SearchInput
            value={keyword}
            onChange={setKeyword}
            placeholder={t("ui.TasksView.placeholder.365b1b3e")}
          />
        </label>
        <div className="task-list-summary">
          <span>{t("ui.taskAdapter.text.cafe3d5c")}</span>
          <Segmented
            className="task-filter"
            aria-label={t("ui.taskAdapter.text.cafe3d5c")}
            value={filterKey}
            onChange={(value) => setFilterKey(String(value))}
            options={filters.map((filter) => ({
              value: filter.key,
              disabled: !filter.count && filterKey !== filter.key,
              label: (
                <span className="task-filter-option">
                  {filter.label}
                  <b>{filter.count}</b>
                </span>
              ),
            }))}
          />
        </div>
        {!filtered.length
          ? (
            <EmptyState
              icon="task"
              text={
                !searched.length
                  ? (keyword ? t("ui.TasksView.text.c9691e05") : t("ui.TasksView.text.b766b208"))
                  : t("ui.TasksView.text.ba89fcef")
              }
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
                const active = isActiveTaskStatus(task.status);
                const typeLabel = taskTypeLabel(task);
                const failure = task.error ? splitTaskError(task.error) : null;
                const detailOpen = Boolean(openErrors[task.id]);
                return (
                  <article key={task.id} className={`task-record is-${status}`}>
                    <div className="task-record-icon" title={typeLabel}>
                      <IconSymbol name={typeIcons[task.type || ""] || "task"} />
                    </div>
                    <div className="task-record-main">
                      <div className="task-record-title">
                        <strong>{task.title || typeLabel}</strong>
                        <StatusPill status={status} />
                      </div>
                      <div className="task-record-meta">
                        <span className={`task-record-note${
                          failure ? (task.historical ? " is-stale" : " is-error") : ""
                        }`}>
                          {failure ? failure.summary : task.model || typeLabel}
                        </span>
                        {Boolean(failure?.detail) && (
                          <button
                            type="button"
                            className="task-record-source"
                            aria-expanded={detailOpen}
                            title={detailOpen ? t("ui.TasksView.text.8102c093") : t("ui.TasksView.text.2da5a54a")}
                            onClick={() => setOpenErrors((current) => ({
                              ...current,
                              [task.id]: !current[task.id],
                            }))}
                          >
                            {detailOpen ? t("ui.TasksView.text.9437f5a7") : t("ui.TasksView.text.9800d15c")}
                          </button>
                        )}
                        {Boolean(task.retryCount) && (
                          <em>
                            {t("ui.TasksView.text.a3477f84")}{task.retryCount}/{task.maxRetries ?? 2}
                          </em>
                        )}
                        <time>{formatTime(task.createdAt)}</time>
                        <span className="task-record-ref">
                          {task.id
                            ? `#${String(task.id).slice(-8)}`
                            : t("ui.TasksView.text.0e5b861a")}
                        </span>
                      </div>
                      {adoptTaskId === task.id && (
                        <div className="task-adopt" onClick={(event) => event.stopPropagation()}>
                          <input
                            autoFocus
                            value={adoptValue}
                            onChange={(event) => setAdoptValue(event.target.value)}
                            placeholder={t("ui.TasksView.placeholder.57939c5f")}
                            disabled={adoptBusy}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                void submitAdopt(task.id);
                              }
                              if (event.key === "Escape") {
                                setAdoptTaskId(null);
                                setAdoptValue("");
                                setAdoptError("");
                              }
                            }}
                          />
                          <button
                            type="button"
                            disabled={adoptBusy || !adoptValue.trim()}
                            onClick={() => void submitAdopt(task.id)}
                          >
                            {adoptBusy ? t("ui.TasksView.text.76f9eb5e") : t("ui.TasksView.text.dace87c2")}
                          </button>
                          <button
                            type="button"
                            disabled={adoptBusy}
                            onClick={() => {
                              setAdoptTaskId(null);
                              setAdoptValue("");
                              setAdoptError("");
                            }}
                          >
                            {t("ui.ImageWatermarkEditor.text.4d0b4688")}</button>
                          {adoptError && <span className="task-adopt-error">{adoptError}</span>}
                        </div>
                      )}
                      {detailOpen && failure?.detail && (
                        <p className="task-record-error-detail" title={task.error}>
                          {failure.detail}
                        </p>
                      )}
                      {active && (task.status === "running" || progress > 0) && (
                        <div className="task-record-progress">
                          <div className="task-progress-track">
                            <i><b style={{ width: `${progress}%` }} /></i>
                          </div>
                          <strong>{progress}%</strong>
                        </div>
                      )}
                    </div>
                    <div className="task-record-actions">
                      {task.nodeId && (
                        <button
                          className="icon-button"
                          title={t("ui.TasksView.title.2dde6bb8")}
                          aria-label={t("ui.TasksView.text.477b3c92", { value0: task.title || typeLabel })}
                          onClick={() => void onLocate(task.nodeId!)}
                        >
                          <IconSymbol name="maximize" />
                        </button>
                      )}
                      {task.status === "running" && (
                        <button
                          className="icon-button"
                          title={t("ui.TasksView.title.d258a63c")}
                          onClick={() => void onCancel(task.id)}
                        >
                          <IconSymbol name="x" />
                        </button>
                      )}
                      {task.canAdoptRemote && (
                        <button
                          className="icon-button"
                          title={t("ui.TasksView.title.a2d63435")}
                          aria-label={t("ui.TasksView.text.745ea42e", { value0: task.title || typeLabel })}
                          onClick={() => {
                            setAdoptTaskId(task.id);
                            setAdoptValue("");
                            setAdoptError("");
                          }}
                        >
                          <IconSymbol name="link" />
                        </button>
                      )}
                      {task.canRetry && (
                        <button
                          className="icon-button"
                          title={t("ui.TasksView.title.c5155eb2")}
                          onClick={() => {
                            // 提交阶段超时时，厂商可能已经受理并生成；盲目重试会重复计费。
                            if (task.canAdoptRemote && /网络请求失败|error sending request|超时|timeout/i.test(task.error || "")) {
                              modal.confirm({
                                title: t("ui.TasksView.text.60dd9008"),
                                onOk: () => onRetry(task.id),
                              });
                              return;
                            }
                            void onRetry(task.id);
                          }}
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
        <ContextMenu
          point={menu}
          items={taskMenuItems}
          onSelect={(key) => {
            if (key === "clear") void clear();
          }}
          onClose={() => setMenu(null)}
        />
      </div>
    </>
  );
}
