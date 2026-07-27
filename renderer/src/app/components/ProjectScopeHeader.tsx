import type { ReactNode } from "react";
import { useAppStore } from "../store/appStore";

interface ProjectScopeHeaderProps {
  title: string;
  subtitle?: string;
  description?: string;
  showBreadcrumbs?: boolean;
  showDescription?: boolean;
  flat?: boolean;
  children?: ReactNode;
}

export function ProjectScopeHeader(
  {
    title,
    subtitle,
    description,
    showBreadcrumbs,
    showDescription,
    flat,
    children,
  }: ProjectScopeHeaderProps,
) {
  const project = useAppStore((state) => state.currentProject);
  const setRoute = useAppStore((state) => state.setRoute);
  return (
    <div className={`project-scope-head${flat ? " flat" : ""}`}>
      <div className="project-scope-title">
        {showBreadcrumbs && (
          <div className="breadcrumb-line">
            <button
              className="breadcrumb-link"
              onClick={() => setRoute("projects")}
            >
              项目库
            </button>
            <span>/</span>
            <button
              className="breadcrumb-link"
              onClick={() => setRoute("creation")}
            >
              {project?.name || "未命名项目"}
            </button>
            <span>/</span>
            <span>{title}</span>
          </div>
        )}
        <h1 className="page-title">
          {title}
          {subtitle && <span className="page-subtitle">{subtitle}</span>}
        </h1>
        {showDescription && description && (
          <p className="scope-description">{description}</p>
        )}
      </div>
      <div className="right-tools">{children}</div>
    </div>
  );
}
