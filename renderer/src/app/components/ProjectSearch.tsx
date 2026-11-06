import { t } from '@/i18n';
import { Empty, Input, List, Modal, type InputRef } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { focusCanvasNodes } from "../adapters/canvasAdapter";
import { IconSymbol } from "./IconSymbol";
import { hasOpenProject, navigateToRoute, openRecentProject, store, touchProject } from "../../store/projectStore.ts";
import { desktopApi } from "../../services/desktopApi.ts";
import { useAppStore, type AppRoute } from "../store/appStore";

type SearchResult = {
  id: string;
  kind: string;
  title: string;
  detail: string;
  route: AppRoute;
  nodeId?: string;
  conversationId?: string;
  projectPath?: string;
  projectName?: string;
};

function searchItems(project: any, projectPath: string): SearchResult[] {
  if (!project?.id) return [];
  const items: SearchResult[] = [];
  const context = String(project.name || t("ui.ProjectCard.text.060f1435"));
  for (const node of project.nodes || []) {
    if (node.archived) continue;
    items.push({
      id: `node:${node.id}`, kind: t("ui.ProjectSearch.kind.95b2102f"), title: String(node.title || node.name || t("ui.WorkflowCanvas.text.c599f9df")),
      detail: `${context} · ${String(node.textContent || node.prompt || node.type || "")}`, route: "creation", nodeId: String(node.id), projectPath, projectName: context,
    });
  }
  for (const task of project.tasks || []) {
    items.push({
      id: `task:${task.id}`, kind: t("ui.ProjectSearch.kind.3172b317"), title: String(task.title || task.name || task.prompt || t("ui.taskAdapter.text.cafe3d5c")),
      detail: `${context} · ${String(task.status || "")}`, route: "tasks", ...(task.nodeId ? { nodeId: String(task.nodeId) } : {}), projectPath, projectName: context,
    });
  }
  for (const asset of project.assets || []) {
    items.push({
      id: `asset:${asset.id}`, kind: t("ui.ProjectSearch.kind.713fd96f"), title: String(asset.name || t("ui.ProjectSearch.text.b8bce642")),
      detail: [context, asset.category, asset.note, ...(asset.tags || [])].filter(Boolean).join(" · "), route: "assets", projectPath, projectName: context,
    });
  }
  for (const material of project.materials || []) {
    items.push({
      id: `material:${material.id}`, kind: t("ui.MaterialGrid.file.49deaf7d"), title: String(material.name || material.fileName || t("ui.canvasUploadActions.text.460d54d3")),
      detail: `${context} · ${String(material.resourceType || material.sourceType || "")}`, route: "materials", projectPath, projectName: context,
    });
  }
  for (const conversation of project.harnessSessions || []) {
    items.push({
      id: `conversation:${conversation.id}`, kind: t("ui.ProjectSearch.kind.00d4cbaf"), title: String(conversation.title || t("ui.HarnessSessionToolbar.text.1b7abf96")),
      detail: `${context} · ${(conversation.messages || []).map((message: any) => String(message.content || "")).join(" ")}`,
      route: "creation", conversationId: String(conversation.id), projectPath, projectName: context,
    });
  }
  return items;
}

export function ProjectSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [otherItems, setOtherItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const input = useRef<InputRef>(null);
  const projectName = hasOpenProject() ? String(store.project?.name || t("ui.ProjectSearch.text.96cb64ae")) : "";
  const results = useMemo(() => {
    const currentPath = hasOpenProject() ? String(store.filePath || "") : "";
    const all: SearchResult[] = [
      ...(currentPath ? searchItems(store.project, currentPath) : []),
      ...otherItems,
      ...(store.recentProjects || []).filter((item: any) => item.filePath).map((item: any) => ({
        id: `project:${item.filePath}`, kind: t("ui.resourceLibraryAdapter.text.22336e6b"), title: String(item.name || t("ui.ProjectCard.text.060f1435")),
        detail: String(item.filePath), route: "creation" as const, projectPath: String(item.filePath),
      })),
    ];
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return all.slice(0, 12);
    return all.filter((item) => `${item.title} ${item.detail} ${item.kind}`.toLocaleLowerCase().includes(needle)).slice(0, 50);
  }, [query, otherItems]);

  useEffect(() => { input.current?.focus(); }, []);

  useEffect(() => {
    const needle = query.trim();
    if (!needle) { setOtherItems([]); setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    const timer = window.setTimeout(() => {
      const paths = [...new Set<string>((store.recentProjects || []).map((item: any) => String(item.filePath || "")))].filter((path) => path && path !== store.filePath);
      void Promise.allSettled(paths.map(async (path) => {
        const project = await desktopApi.project.readFile(path);
        return searchItems(project, path);
      })).then((settled) => {
        if (cancelled) return;
        setOtherItems(settled.flatMap((item) => item.status === "fulfilled" ? item.value : []));
        setLoading(false);
      });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  async function open(item: SearchResult) {
    if (item.projectPath && item.projectPath !== store.filePath) {
      try {
        const opened = await openRecentProject(item.projectPath);
        if (!opened) return;
      } catch { return; }
    }
    onClose();
    navigateToRoute(item.route);
    useAppStore.setState({ route: item.route });
    if (item.conversationId) {
      (store.project as any).activeHarnessSessionId = item.conversationId;
      touchProject();
    }
    if (item.nodeId && item.route === "creation") {
      focusCanvasNodes([item.nodeId]);
    }
  }

  return (
    <Modal
      open
      centered
      width={640}
      footer={null}
      closable={false}
      onCancel={onClose}
      afterOpenChange={(visible) => {
        if (visible) input.current?.focus();
      }}
      className="project-search-modal"
      styles={{
        body: {
          padding: 0,
          display: "flex",
          flexDirection: "column",
          maxHeight: "min(70vh, 620px)",
        },
      }}
    >
      <div className="project-search-input-row">
        <IconSymbol name="search" />
        <Input
          ref={input}
          variant="borderless"
          value={query}
          placeholder={projectName ? t("ui.ProjectSearch.text.58f3440e") : t("ui.ProjectSearch.text.b617f05c")}
          aria-label={t("ui.ProjectSearch.arialabel.f005a767")}
          onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, results.length - 1)); }
            if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
            if (event.key === "Enter" && results[selected]) void open(results[selected]);
          }}
        />
        <button type="button" onClick={onClose} aria-label={t("ui.ProjectSearch.arialabel.e40a06c8")}><IconSymbol name="x" /></button>
      </div>
      <div className="project-search-results">
        {results.length ? (
          <List
            split={false}
            dataSource={results}
            renderItem={(item, index) => (
              <button key={`${item.projectPath}:${item.id}`} type="button" className={index === selected ? "is-selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => void open(item)}>
                <span className="project-search-kind">{item.kind}</span>
                <span className="project-search-result-copy"><strong>{item.title}</strong><small>{item.detail.slice(0, 110) || t("ui.ProjectSearch.text.65fc81e1")}</small></span>
                <span className="project-search-enter">↵</span>
              </button>
            )}
          />
        ) : loading ? (
          <p className="project-search-empty">{t("ui.ProjectSearch.text.75aa5226")}</p>
        ) : (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("ui.ProjectSearch.text.d5eddc71")} />
        )}
      </div>
      <footer className="project-search-footer">{t("ui.ProjectSearch.text.528869a0")}<span>{t("ui.ProjectSearch.text.a29b060f")}</span> <span>{t("ui.ProjectSearch.text.bca2fcab")}</span></footer>
    </Modal>
  );
}
