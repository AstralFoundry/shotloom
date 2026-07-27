import type { MouseEvent } from "react";
import { formatTime } from "../../utils/format.js";
import { IconSymbol } from "./IconSymbol";

export interface ProjectLibraryEntry {
  kind: "project";
  name?: string;
  filePath: string;
  projectDir: string;
  lastOpenedAt?: string;
  folderName?: string;
  seriesName?: string;
}

interface CloneProgress {
  phase: "starting" | "copying" | "completed" | "failed";
  percent?: number;
  error?: string;
}

interface ProjectCardProps {
  project: ProjectLibraryEntry;
  cloneProgress?: CloneProgress | null;
  isCurrent?: boolean;
  onOpen: (project: ProjectLibraryEntry) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

export function ProjectCard(
  { project, cloneProgress, isCurrent, onOpen, onMenu, onContextMenu }:
    ProjectCardProps,
) {
  const percent = Math.min(
    100,
    Math.max(0, Math.round(cloneProgress?.percent || 0)),
  );
  const progressText = cloneProgress?.phase === "failed"
    ? cloneProgress.error || "复制失败"
    : cloneProgress?.phase === "completed"
    ? "复制完成"
    : cloneProgress?.phase === "starting"
    ? "准备复制"
    : "正在复制项目";
  return (
    <article
      className={`project-tile project-canvas-tile${
        isCurrent ? " current" : ""
      }`}
      onDoubleClick={() => onOpen(project)}
      onContextMenu={onContextMenu}
    >
      <div className="project-tile-preview">
        <span className="project-canvas-glyph">
          <IconSymbol name="grid" />
        </span>
        {isCurrent && <span className="project-current-label">当前</span>}
      </div>
      <div className="project-tile-body">
        <h3>{project.name || "未命名项目"}</h3>
        <p>
          画布 · {formatTime(project.lastOpenedAt)}
          {(project.folderName || project.seriesName) && (
            <>· {project.folderName || project.seriesName}</>
          )}
        </p>
      </div>
      {cloneProgress && (
        <span
          className={`project-copy-chip${
            cloneProgress.phase === "completed" ? " done" : ""
          }${cloneProgress.phase === "failed" ? " failed" : ""}`}
        >
          {progressText}
          {!["completed", "failed"].includes(cloneProgress.phase) && (
            <em>{percent}%</em>
          )}
        </span>
      )}
      <button
        className="project-tile-menu"
        type="button"
        title="更多操作"
        onClick={(event) => {
          event.stopPropagation();
          onMenu(event);
        }}
      >
        <IconSymbol name="more" />
      </button>
    </article>
  );
}
