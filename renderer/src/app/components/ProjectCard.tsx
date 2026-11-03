import { t } from '@/i18n';
import type { MouseEvent } from "react";
import { formatTime } from "../../utils/format.ts";
import { ProjectCover } from "./ProjectCover";
import { IconSymbol } from "./IconSymbol";

export interface ProjectLibraryEntry {
  kind: "project";
  name?: string;
  filePath: string;
  projectDir: string;
  lastOpenedAt?: string;
  updatedAt?: string;
  createdAt?: string;
  coverSource?: string;
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
  // 调用方按项目目录查复制进度表，没有进度时取到的是 undefined，而不是缺省属性。
  cloneProgress?: CloneProgress | null | undefined;
  isCurrent?: boolean;
  opening?: boolean;
  disabled?: boolean;
  onOpen: (project: ProjectLibraryEntry) => void;
  onMenu: (event: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
}

export function ProjectCard(
  { project, cloneProgress, isCurrent, opening, disabled, onOpen, onMenu, onContextMenu }:
    ProjectCardProps,
) {
  const percent = Math.min(
    100,
    Math.max(0, Math.round(cloneProgress?.percent || 0)),
  );
  const progressText = cloneProgress?.phase === "failed"
    ? cloneProgress.error || t("ui.ProjectCard.text.f2c6b516")
    : cloneProgress?.phase === "completed"
    ? t("ui.ProjectCard.text.f5f6a2db")
    : cloneProgress?.phase === "starting"
    ? t("ui.ProjectCard.text.fcd288b8")
    : t("ui.ProjectCard.text.b4c1de8b");
  return (
    <article
      className={`project-tile project-canvas-tile${
        isCurrent ? " current" : ""
      }`}
      tabIndex={disabled ? -1 : 0}
      aria-label={t("ui.ProjectCard.text.bf10e335", { value0: project.name || t("ui.ProjectCard.text.060f1435") })}
      aria-busy={opening || undefined}
      aria-disabled={disabled || undefined}
      onClick={() => { if (!disabled) onOpen(project); }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || disabled) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(project);
        }
      }}
      onContextMenu={onContextMenu}
    >
      <div className="project-tile-preview">
        <ProjectCover source={project.coverSource || ""} revision={project.updatedAt || ""} />
        {isCurrent && <span className="project-current-label">{t("ui.ProjectCard.text.25e74dce")}</span>}

      </div>
      <div className="project-tile-body">
        <h3>{project.name || t("ui.ProjectCard.text.060f1435")}</h3>
        <p>
          {t("ui.ProjectCard.text.de92581d")}{formatTime(project.updatedAt || project.lastOpenedAt)}
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
        title={t("ui.ProjectCard.title.77836d3a")}
        disabled={disabled}
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
