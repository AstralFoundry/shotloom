import { useEffect, useState } from "react";
import { IconSymbol } from "../components/IconSymbol";
import type { AgentController, AgentPlanView } from "./contracts";
import styles from "./PlanCard.module.css";

const stageStatusLabel: Record<string, string> = {
  pending: "待编排",
  doing: "进行中",
  blocked: "受阻",
  done: "已完成",
};

export function PlanCard({
  plan,
  controller,
}: {
  plan?: AgentPlanView;
  controller: AgentController;
}) {
  const stages = plan?.stages || [];
  const [open, setOpen] = useState(false);
  const [expandedStage, setExpandedStage] = useState<string | null>(null);
  useEffect(() => {
    setOpen(false);
    setExpandedStage(null);
  }, [plan?.id]);
  if (!plan || plan.schemaVersion !== 2 || !stages.length) return null;

  const done = stages.filter((stage) => stage.status === "done").length;

  return (
    <section className={styles.card} data-open={open || undefined}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <IconSymbol name="workflow" className={styles.headIcon} />
        <span className={styles.headCopy}>
          <small>{plan.executionMode === "execute" ? "制作与执行" : "画布规划"}</small>
          <strong>{plan.title || plan.goal || "画布制作"}</strong>
        </span>
        <span className={styles.headCount}>
          {done}/{stages.length}
        </span>
        <span className={styles.bar} aria-hidden="true">
          <span className={styles.barFill} style={{ width: `${(done / stages.length) * 100}%` }} />
        </span>
        <IconSymbol name="chevron-down" className={styles.headChevron} />
      </button>
      {open && (
        <ol className={styles.stages}>
          {stages.map((stage, index) => {
            const key = stage.id || `stage-${index}`;
            const expanded = expandedStage === key;
            const detail = stage.description || stage.workItems?.length || stage.runtimeRefs?.length;
            const stageNodeIds = (stage.runtimeRefs || []).flatMap((ref) =>
              ref.nodeId ? [ref.nodeId] : [],
            );
            return (
              <li key={key} className={styles.stage} data-status={stage.status}>
                <button
                  type="button"
                  className={styles.stageHead}
                  disabled={!detail}
                  aria-expanded={expanded}
                  onClick={() => setExpandedStage(expanded ? null : key)}
                >
                  <span className={styles.stageDot} aria-hidden="true" />
                  <span className={styles.stageTitle}>{stage.title || `阶段 ${index + 1}`}</span>
                  <span className={styles.stageStatus}>
                    {stageStatusLabel[String(stage.status || "")] || stage.status}
                  </span>
                  {!!detail && <IconSymbol name="chevron-down" className={styles.stageChevron} />}
                </button>
                {expanded && (
                  <div className={styles.stageBody}>
                    {stage.description && <p>{stage.description}</p>}
                    {stage.status === "pending" && !stage.authored && (
                      <small>阶段大纲 · 尚未编排工作项</small>
                    )}
                    {!!stage.workItems?.length && (
                      <ul className={styles.workItems}>
                        {stage.workItems.map((workItem) => {
                          const runtimeRef = stage.runtimeRefs?.find(
                            (ref) => ref.workItemId === workItem.id,
                          );
                          return (
                            <li key={workItem.id}>
                              <span className={styles.workItemHead}>
                                <strong>{workItem.title}</strong>
                                <em>{workItem.outputType || "output"}</em>
                              </span>
                              {workItem.prompt && <p>{workItem.prompt}</p>}
                              {(runtimeRef?.nodeId || runtimeRef?.taskId) && (
                                <small>产物已绑定</small>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {stage.blockedReason && (
                      <small className={styles.blocked}>{stage.blockedReason}</small>
                    )}
                    {!!stage.runtimeRefs?.some((ref) => ref.nodeId) && (
                      <button type="button" onClick={() => controller.focusNodes(stageNodeIds)}>
                        定位画布产物
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
