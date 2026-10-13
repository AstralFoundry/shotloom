import { useState, type DragEvent } from "react";
import { IconSymbol } from "../components/IconSymbol";
import type { WorkflowNodeData } from "../canvas/WorkflowCanvas";
import {
  artifactsForMessage,
  ARTIFACT_DRAG_TYPE,
  type AgentArtifact,
  type AgentArtifactRefs,
} from "./artifactHelpers";
import type { AgentController } from "./contracts";
import { MediaThumb } from "./MediaThumb";
import styles from "./ArtifactList.module.css";

export function ArtifactList({
  refs,
  nodes,
  controller,
}: {
  refs?: AgentArtifactRefs;
  nodes: WorkflowNodeData[];
  controller: AgentController;
}) {
  const [open, setOpen] = useState(true);
  const artifacts = artifactsForMessage(refs, nodes);
  if (!artifacts.length) return null;
  return (
    <section className={styles.section} aria-label="本轮产物">
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.headLabel}>
          <IconSymbol name="layers" />
          本轮产物
          <em>{artifacts.length}</em>
        </span>
        <IconSymbol name="chevron-down" className={styles.headChevron} data-collapsed={!open || undefined} />
      </button>
      {open && (
        <div className={styles.grid}>
          {artifacts.map((artifact) => (
            <ArtifactCard key={artifact.nodeId} artifact={artifact} onFocus={controller.focusNodes} />
          ))}
        </div>
      )}
    </section>
  );
}

function ArtifactCard({
  artifact,
  onFocus,
}: {
  artifact: AgentArtifact;
  onFocus: (nodeIds: string[]) => void;
}) {
  const media = artifact.kind === "image" || artifact.kind === "video";
  const canDrag =
    artifact.kind !== "node" && Boolean(artifact.path || artifact.fallbackUrl || artifact.excerpt);

  return (
    <div
      className={styles.card}
      draggable={canDrag}
      onDragStart={(event: DragEvent<HTMLDivElement>) => {
        if (!canDrag) return;
        event.dataTransfer.setData(ARTIFACT_DRAG_TYPE, artifact.nodeId);
        event.dataTransfer.effectAllowed = "copy";
      }}
      title={canDrag ? "拖到画布，添加此产物" : artifact.title}
    >
      <MediaThumb
        kind={artifact.kind}
        path={artifact.path}
        fallbackUrl={artifact.fallbackUrl}
        label={artifact.title}
        fallback={
          artifact.kind === "text" && artifact.excerpt ? (
            <span className={styles.excerpt}>{artifact.excerpt}</span>
          ) : undefined
        }
        onActivate={media ? undefined : () => onFocus([artifact.focusNodeId])}
      />
      <button
        type="button"
        className={styles.locate}
        onClick={() => onFocus([artifact.focusNodeId])}
        aria-label={`在画布中定位：${artifact.title}`}
        title="在画布中定位"
      >
        <IconSymbol name="maximize" />
      </button>
    </div>
  );
}
