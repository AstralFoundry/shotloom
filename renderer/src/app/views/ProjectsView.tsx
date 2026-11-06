import { t } from '@/i18n';
import { Dropdown, Select, type MenuProps } from "antd";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatTime, formatItemCount } from "../../utils/format.ts";
import { showErrorMessage } from "../../store/notificationStore";
import { useAppStore } from "../store/appStore";
import { ProjectCover } from "../components/ProjectCover";
import { IconSymbol } from "../components/IconSymbol";
import {
  ProjectCard,
  type ProjectLibraryEntry,
} from "../components/ProjectCard";
import { SearchInput } from "../components/SearchInput";

export interface ProjectFolderEntry {
  kind: "folder";
  name: string;
  folderDir: string;
  sharedRootDir?: string;
  lastOpenedAt?: string;
  createdAt?: string | number;
  updatedAt?: string | number;
  itemCount?: number;
  children?: LibraryEntry[];
}

export type LibraryEntry = ProjectLibraryEntry | ProjectFolderEntry;

export interface ProjectsController {
  importPackage: () => Promise<void>;
  createFolder: (parentDir: string | null, name: string) => Promise<void>;
  createProject: (name: string, folder: ProjectFolderEntry) => Promise<void>;
  rename: (entry: LibraryEntry, name: string) => Promise<void>;
  openProject: (filePath: string) => Promise<void>;
  showInFolder: (entry: LibraryEntry) => Promise<void>;
  copy: (entry: LibraryEntry) => Promise<void>;
  export: (entry: LibraryEntry) => Promise<void>;
  trash: (entry: LibraryEntry) => Promise<void>;
}

interface ProjectsViewProps {
  entries: LibraryEntry[];
  currentFilePath?: string | null;
  initialFolderPath?: string[];
  cloneProgress?: Record<
    string,
    {
      phase: "starting" | "copying" | "completed" | "failed";
      percent?: number;
      error?: string;
    }
  >;
  controller: ProjectsController;
}

type Draft = {
  type: "folder" | "canvas";
  name: string;
  context: ProjectFolderEntry | null;
};
type MenuState = { x: number; y: number; entry?: LibraryEntry } | null;
const sortOptions = { updated: t("ui.ProjectsView.updated.80920cd6"), created: t("ui.ProjectsView.created.77752f69"), name: t("ui.ProjectsView.name.8dc72b8f") } as const;
type SortOrder = keyof typeof sortOptions;
function entryTime(value: string | number | undefined) {
  const time = typeof value === 'number' ? value : Date.parse(value || '');
  return Number.isFinite(time) ? time : 0;
}

function entryKey(entry: LibraryEntry) {
  return entry.kind === "project" ? entry.filePath : entry.folderDir;
}

function findFolder(
  entries: LibraryEntry[],
  key: string,
): ProjectFolderEntry | null {
  for (const entry of entries) {
    if (entry.kind !== "folder") continue;
    if (entry.folderDir === key) return entry;
    const nested = findFolder(entry.children || [], key);
    if (nested) return nested;
  }
  return null;
}

export function ProjectsView(
  {
    entries,
    currentFilePath,
    initialFolderPath = [],
    cloneProgress = {},
    controller,
  }:
    ProjectsViewProps,
) {
  const initialFolderPathKey = initialFolderPath.join("\u0000");
  const [folderPath, setFolderPath] = useState<string[]>(initialFolderPath);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [rename, setRename] = useState<
    { entry: LibraryEntry; name: string } | null
  >(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState<"all" | "project" | "folder">("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated');
  const [openingPath, setOpeningPath] = useState<string | null>(null);
  const opening = useRef(false);
  const createInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const renameEntryKey = rename ? entryKey(rename.entry) : "";
  const currentFolder = folderPath.length
    ? findFolder(entries, folderPath.at(-1)!)
    : null;
  const visibleEntries = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return (currentFolder?.children || entries)
      .filter(entry => entryFilter === "all" || entry.kind === entryFilter)
      .filter(entry => (entry.name || '').toLocaleLowerCase().includes(keyword))
      .slice().sort((a, b) => {
        if (sortOrder === 'name') return (a.name || '').localeCompare(b.name || '', 'zh-CN', { numeric: true, sensitivity: 'base' });
        return entryTime(sortOrder === 'created' ? b.createdAt : b.updatedAt || b.lastOpenedAt)
          - entryTime(sortOrder === 'created' ? a.createdAt : a.updatedAt || a.lastOpenedAt);
      });
  }, [currentFolder, entries, query, sortOrder, entryFilter]);

  useEffect(() => {
    createInput.current?.focus();
    createInput.current?.select();
  }, [draft]);
  useEffect(() => {
    renameInput.current?.focus();
    renameInput.current?.select();
  }, [renameEntryKey]);
  useEffect(() => {
    setFolderPath(initialFolderPath);
  }, [initialFolderPathKey]);
  useEffect(() => {
    setFolderPath((path) =>
      path.filter((key) => Boolean(findFolder(entries, key)))
    );
  }, [entries]);

  function closeMenus() {
    setMenu(null);
  }
  function enterFolder(folder: ProjectFolderEntry) {
    closeMenus();
    setQuery('');
    setEntryFilter('all');
    setFolderPath((path) => [...path, folder.folderDir]);
  }
  function goToLevel(index: number) {
    closeMenus();
    setQuery('');
    setEntryFilter('all');
    setDraft(null);
    setRename(null);
    setFolderPath((path) => index < 0 ? [] : path.slice(0, index + 1));
  }

  // 只记录指针在滚动内容里的坐标；翻转与边缘避让交给 Dropdown 自己算。
  function menuPosition(event: MouseEvent<HTMLElement>) {
    const browser = event.currentTarget.closest(
      ".project-browser",
    ) as HTMLElement;
    const bounds = browser.getBoundingClientRect();
    return {
      x: browser.scrollLeft + event.clientX - bounds.left,
      y: browser.scrollTop + event.clientY - bounds.top,
    };
  }

  function openCreateMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (
      (event.target as Element).closest(".project-tile, .ant-dropdown")
    ) return;
    setMenu(menuPosition(event));
  }

  function openEntryMenu(event: MouseEvent<HTMLElement>, entry: LibraryEntry) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ ...menuPosition(event), entry });
  }

  function beginCreate(type: Draft["type"]) {
    closeMenus();
    if (type === "canvas" && !currentFolder) return;
    setEntryFilter("all");
    setDraft({
      type,
      name: type === "folder" ? t("ui.ProjectsView.text.95cf3cd4") : t("ui.ProjectsView.text.afb7afc7"),
      context: currentFolder,
    });
  }

  async function commitCreate() {
    if (!draft || pending) return;
    const value = draft;
    const name = value.name.trim();
    setDraft(null);
    if (!name) return;
    setPending(true);
    try {
      if (value.type === "folder") {
        await controller.createFolder(value.context?.folderDir || null, name);
      } else if (value.context) await controller.createProject(name, value.context);
    } catch (error) {
      showErrorMessage(error instanceof Error ? error.message : String(error), value.type === "folder" ? t("ui.ProjectsView.text.91ab3905") : t("project.createFailed"));
    } finally {
      setPending(false);
    }
  }

  async function commitRename() {
    if (!rename || pending) return;
    const value = rename;
    const name = value.name.trim();
    setRename(null);
    if (!name || name === value.entry.name) return;
    setPending(true);
    try {
      await controller.rename(value.entry, name);
    } catch (error) {
      showErrorMessage(error instanceof Error ? error.message : String(error), t("ui.ProjectsView.text.1664ff60"));
    } finally {
      setPending(false);
    }
  }

  async function runMenuAction(
    action: keyof Pick<
      ProjectsController,
      "showInFolder" | "copy" | "export" | "trash"
    >,
    entry: LibraryEntry,
  ) {
    closeMenus();
    try {
      await controller[action](entry);
    } catch (error) {
      showErrorMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openProject(filePath: string) {
    if (opening.current) return;
    opening.current = true;
    setOpeningPath(filePath);
    useAppStore.getState().setOpeningProjectPath(filePath);
    closeMenus();
    try {
      await controller.openProject(filePath);
    } catch (error) {
      showErrorMessage(error instanceof Error ? error.message : String(error), t("project.openFailed"));
    } finally {
      opening.current = false;
      setOpeningPath(null);
      if (useAppStore.getState().openingProjectPath === filePath) useAppStore.getState().setOpeningProjectPath(null);
    }
  }

  function onMenuClick({ key }: { key: string }) {
    const entry = menu?.entry;
    if (!entry) {
      if (key === "create-folder") beginCreate("folder");
      if (key === "create-canvas") beginCreate("canvas");
      return;
    }
    if (key === "open") {
      closeMenus();
      if (entry.kind === "folder") enterFolder(entry);
      else void openProject(entry.filePath);
    } else if (key === "rename") {
      closeMenus();
      setRename({ entry, name: entry.name || t("ui.ProjectsView.text.21964bda") });
    } else if (key === "showInFolder") {
      void runMenuAction("showInFolder", entry);
    } else if (key === "copy") {
      void runMenuAction("copy", entry);
    } else if (key === "export") {
      void runMenuAction("export", entry);
    } else if (key === "trash") {
      void runMenuAction("trash", entry);
    }
  }

  const menuItems: MenuProps["items"] = menu?.entry
    ? [
      { key: "open", icon: <IconSymbol name="cursor" />, label: t("ui.ProjectSearch.text.65fc81e1") },
      { key: "showInFolder", icon: <IconSymbol name="folder" />, label: t("ui.ProjectsView.text.0d6e116b") },
      { type: "divider" },
      { key: "rename", icon: <IconSymbol name="pencil" />, label: t("ui.ProjectsView.text.1cd80fd7") },
      { key: "copy", icon: <IconSymbol name="copy" />, label: t("ui.ProjectsView.text.4edd1d00") },
      { key: "export", icon: <IconSymbol name="download" />, label: t("ui.ProjectsView.text.18889679") },
      { type: "divider" },
      { key: "trash", icon: <IconSymbol name="trash" />, label: t("ui.MaterialGrid.title.3755f56f"), danger: true },
    ]
    : [
      { key: "create-folder", icon: <IconSymbol name="folder" />, label: t("ui.ProjectsView.text.95cf3cd4") },
      ...(currentFolder ? [{ key: "create-canvas", icon: <IconSymbol name="grid" />, label: t("ui.ProjectsView.text.afb7afc7") }] : []),
    ];

  const breadcrumbs = folderPath.map((key) => findFolder(entries, key)).filter(
    Boolean,
  ) as ProjectFolderEntry[];
  return (
    <>
      <div className="page-head project-page-head">
        <div>
          {currentFolder && (
            <nav className="project-breadcrumb" aria-label={t("ui.ProjectsView.arialabel.1471a504")}>
              <button
                type="button"
                onClick={() =>
                  goToLevel(-1)}
              >
                {t("ui.ProjectScopeHeader.text.79b705bd")}</button>
              {breadcrumbs.map((folder, index) => (
                <span
                  key={folder.folderDir}
                  className="project-breadcrumb-segment"
                >
                  <i>/</i>
                  <button
                    type="button"
                    className={index === breadcrumbs.length - 1
                      ? "current"
                      : ""}
                    onClick={() => goToLevel(index)}
                  >
                    {folder.name}
                  </button>
                </span>
              ))}
            </nav>
          )}
          <h1 className="page-title">{currentFolder?.name || t("ui.ProjectScopeHeader.text.79b705bd")}</h1>
          {!currentFolder && <p className="project-page-description">{t("ui.ProjectsView.text.f5b63ec3")}</p>}
        </div>
        <div className="project-page-actions">
          {currentFolder && <button className="button primary" type="button" onClick={() => beginCreate("canvas")}>
            <IconSymbol name="grid" />{t("ui.ProjectsView.text.afb7afc7")}
          </button>}
          <button
            className={`button ${currentFolder ? "ghost" : "primary"}`}
            type="button"
            onClick={() => beginCreate("folder")}
          >
            <IconSymbol name="folder" />{t("ui.ProjectsView.text.95cf3cd4")}</button>
          <button
            className="button ghost"
            type="button"
            onClick={() => void controller.importPackage()}
          >
            <IconSymbol name="upload" />{t("ui.CreationView.text.60e2bcad")}</button>
        </div>
      </div>
      <div
        className="scroll-area project-browser"
        onClick={closeMenus}
        onContextMenu={openCreateMenu}
      >
        <div className="project-library-shell">
          <header className="project-library-head">
            <div>
              <strong>{currentFolder?.name || t("ui.ProjectsView.text.f095b12b")}</strong>
              <span>{formatItemCount(visibleEntries.length)}</span>
            </div>
            <div className="project-library-controls" onContextMenu={event => event.stopPropagation()}>
              <label className="project-library-search">
                <SearchInput
                  value={query}
                  onChange={setQuery}
                  placeholder={t("ui.ProjectSearch.text.b617f05c")}
                />
              </label>
              {currentFolder && <Select
                className="project-library-filter"
                aria-label={t("ui.CreationView.text.fa6968d9")}
                value={entryFilter}
                onChange={(value) => setEntryFilter(value)}
                options={[
                  { value: "all", label: t("ui.taskAdapter.label.778fc8f9") },
                  { value: "project", label: t("ui.ProjectSearch.kind.95b2102f") },
                  { value: "folder", label: t("ui.ProjectsView.text.46ecac29") },
                ]}
              />}
              <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                menu={{
                  selectable: true,
                  selectedKeys: [sortOrder],
                  items: (Object.keys(sortOptions) as SortOrder[]).map(option => ({
                    key: option,
                    label: sortOptions[option],
                  })),
                  onClick: ({ key }) => setSortOrder(key as SortOrder),
                }}
              >
                <button className="project-library-sort-trigger" type="button">
                  {sortOptions[sortOrder]}<IconSymbol name="chevron-down" />
                </button>
              </Dropdown>
            </div>
          </header>
          {(visibleEntries.length > 0 || draft)
            ? (
              <div className="project-card-grid">
                {draft && (
                  <article className={`project-tile project-create-tile ${draft.type === "folder" ? "project-folder-tile" : "project-canvas-tile"}`}>
                    <div className="project-tile-preview">
                      <ProjectCover folder={draft.type === "folder"} />
                    </div>
                    <div className="project-tile-body">
                      <input
                        ref={createInput}
                        value={draft.name}
                        className="project-create-name"
                        aria-label={draft.type === "folder"
                          ? t("ui.ProjectsView.text.6af274b8")
                          : t("ui.ProjectsView.text.ca98baa8")}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) =>
                          setDraft({ ...draft, name: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") void commitCreate();
                          if (event.key === "Escape") setDraft(null);
                        }}
                        onBlur={() => void commitCreate()}
                      />
                      <small>
                        {draft.type === "folder" ? t("ui.ProjectsView.text.37e8824f") : t("ui.ProjectsView.text.f4e88e98")}
                      </small>
                    </div>
                  </article>
                )}
                {visibleEntries.map((entry) =>
                  rename?.entry === entry
                    ? (
                      <article
                        key={entryKey(entry)}
                        className={`project-tile project-create-tile ${entry.kind === "folder" ? "project-folder-tile" : "project-canvas-tile"}`}
                      >
                        <div className="project-tile-preview">
                          <ProjectCover
                            folder={entry.kind === "folder"}
                            source={entry.kind === "project" ? entry.coverSource || "" : ""}
                            revision={entry.kind === "project" ? entry.updatedAt || "" : ""}
                          />
                        </div>
                        <div className="project-tile-body">
                          <input
                            ref={renameInput}
                            value={rename.name}
                            className="project-create-name"
                            aria-label={t("ui.AssetsView.text.29e63aed")}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              setRename({
                                ...rename,
                                name: event.target.value,
                              })}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") {
                                event.preventDefault();
                                event.currentTarget.blur();
                              }
                              if (event.key === "Escape") setRename(null);
                            }}
                            onBlur={() => void commitRename()}
                          />
                          <small>
                            {entry.kind === "project" ? t("ui.ProjectSearch.kind.95b2102f") : t("ui.ProjectsView.text.46ecac29")} ·
                            {" "}
                            {formatTime(entry.lastOpenedAt)}
                          </small>
                        </div>
                      </article>
                    )
                    : entry.kind === "folder"
                    ? (
                      <article
                        key={entry.folderDir}
                        className="project-tile project-folder-tile"
                        onDoubleClick={() => enterFolder(entry)}
                        onContextMenu={(event) => openEntryMenu(event, entry)}
                      >
                        <div className="project-tile-preview">
                          <ProjectCover folder />
                        </div>
                        <div className="project-tile-body">
                          <h3>{entry.name}</h3>
                          <p>
                            {formatItemCount(entry.itemCount || 0)} ·{" "}
                            {formatTime(entry.lastOpenedAt)}
                          </p>
                        </div>
                        <button
                          className="project-tile-menu"
                          type="button"
                          title={t("ui.ProjectCard.title.77836d3a")}
                          onClick={(event) => openEntryMenu(event, entry)}
                        >
                          <IconSymbol name="more" />
                        </button>
                      </article>
                    )
                    : (
                      <ProjectCard
                        key={entry.filePath}
                        project={entry}
                        isCurrent={entry.filePath === currentFilePath}
                        cloneProgress={cloneProgress[entry.projectDir]}
                        opening={openingPath === entry.filePath}
                        disabled={openingPath !== null}
                        onOpen={(project) =>
                          void openProject(project.filePath)}
                        onMenu={(event) => openEntryMenu(event, entry)}
                        onContextMenu={(event) => openEntryMenu(event, entry)}
                      />
                    )
                )}
              </div>
            )
            : (
              <div className="project-library-empty">
                <img
                  className="project-library-empty-art"
                  src="./noproject.svg"
                  alt=""
                  aria-hidden="true"
                />
                <strong>{(query.trim() || entryFilter !== "all") ? t("ui.ProjectsView.text.ede67948") : t("ui.ProjectsView.text.a3dba20f")}</strong>
                {!query.trim() && entryFilter === "all" && <span>{t("ui.ProjectsView.text.f4ca1241")}</span>}
              </div>
            )}
        </div>
        <Dropdown
          open={Boolean(menu)}
          onOpenChange={(open) => { if (!open) closeMenus(); }}
          trigger={[]}
          placement="bottomLeft"
          menu={{ items: menuItems, onClick: onMenuClick }}
        >
          <span
            className="project-menu-anchor"
            style={{ left: menu?.x ?? 0, top: menu?.y ?? 0 }}
          />
        </Dropdown>
      </div>
    </>
  );
}
