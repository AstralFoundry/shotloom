import { useEffect, useMemo, useRef, useState } from "react";
import { focusCanvasNodes } from "../adapters/canvasAdapter";
import { IconSymbol } from "./IconSymbol";
import { hasOpenProject, navigateToRoute, openRecentProject, store, touchProject } from "../../store/projectStore.js";
import { desktopApi } from "../../services/desktopApi.js";
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
  const context = String(project.name || "未命名项目");
  for (const node of project.nodes || []) {
    if (node.archived) continue;
    items.push({
      id: `node:${node.id}`, kind: "画布", title: String(node.title || node.name || "未命名节点"),
      detail: `${context} · ${String(node.textContent || node.prompt || node.type || "")}`, route: "creation", nodeId: String(node.id), projectPath, projectName: context,
    });
  }
  for (const task of project.tasks || []) {
    items.push({
      id: `task:${task.id}`, kind: "任务", title: String(task.title || task.name || task.prompt || "生成任务"),
      detail: `${context} · ${String(task.status || "")}`, route: "tasks", nodeId: task.nodeId ? String(task.nodeId) : undefined, projectPath, projectName: context,
    });
  }
  for (const asset of project.assets || []) {
    items.push({
      id: `asset:${asset.id}`, kind: "资产", title: String(asset.name || "未命名资产"),
      detail: [context, asset.category, asset.note, ...(asset.tags || [])].filter(Boolean).join(" · "), route: "assets", projectPath, projectName: context,
    });
  }
  for (const material of project.materials || []) {
    items.push({
      id: `material:${material.id}`, kind: "文件", title: String(material.name || material.fileName || "未命名文件"),
      detail: `${context} · ${String(material.resourceType || material.sourceType || "")}`, route: "materials", projectPath, projectName: context,
    });
  }
  for (const conversation of project.copilotConversations || []) {
    items.push({
      id: `conversation:${conversation.id}`, kind: "对话", title: String(conversation.title || "新对话"),
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
  const input = useRef<HTMLInputElement>(null);
  const projectName = hasOpenProject() ? String(store.project?.name || "当前项目") : "";
  const results = useMemo(() => {
    const currentPath = hasOpenProject() ? String(store.filePath || "") : "";
    const all: SearchResult[] = [
      ...(currentPath ? searchItems(store.project, currentPath) : []),
      ...otherItems,
      ...(store.recentProjects || []).filter((item: any) => item.filePath).map((item: any) => ({
        id: `project:${item.filePath}`, kind: "项目", title: String(item.name || "未命名项目"),
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
      (store.project as any).activeCopilotConversationId = item.conversationId;
      touchProject();
    }
    if (item.nodeId && item.route === "creation") {
      window.setTimeout(() => focusCanvasNodes([item.nodeId!]), 80);
    }
  }

  return (
    <div className="project-search-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="project-search-dialog" role="dialog" aria-modal="true" aria-label="搜索项目内容">
        <div className="project-search-input-row">
          <IconSymbol name="search" />
          <input
            ref={input}
            value={query}
            placeholder={projectName ? `搜索项目、节点、对话和素材` : "搜索项目"}
            aria-label="搜索项目内容"
            onChange={(event) => { setQuery(event.target.value); setSelected(0); }}
            onKeyDown={(event) => {
              if (event.key === "Escape") onClose();
              if (event.key === "ArrowDown") { event.preventDefault(); setSelected((value) => Math.min(value + 1, results.length - 1)); }
              if (event.key === "ArrowUp") { event.preventDefault(); setSelected((value) => Math.max(value - 1, 0)); }
              if (event.key === "Enter" && results[selected]) void open(results[selected]);
            }}
          />
          <button type="button" onClick={onClose} aria-label="关闭搜索"><IconSymbol name="x" /></button>
        </div>
        <div className="project-search-results">
          {results.length ? results.map((item, index) => (
            <button key={`${item.projectPath}:${item.id}`} type="button" className={index === selected ? "is-selected" : ""} onMouseEnter={() => setSelected(index)} onClick={() => void open(item)}>
              <span className="project-search-kind">{item.kind}</span>
              <span className="project-search-result-copy"><strong>{item.title}</strong><small>{item.detail.slice(0, 110) || "打开"}</small></span>
              <span className="project-search-enter">↵</span>
            </button>
          )) : <p className="project-search-empty">{loading ? "正在搜索项目…" : "没有找到匹配内容"}</p>}
        </div>
        <footer className="project-search-footer">↑↓ 选择 <span>↵ 打开</span> <span>Esc 关闭</span></footer>
      </section>
    </div>
  );
}
