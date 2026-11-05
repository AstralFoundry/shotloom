import { t } from '@/i18n';
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
  const [createMenu, setCreateMenu] = useState<MenuState>(null);
  const [entryMenu, setEntryMenu] = useState<MenuState>(null);
  const [pending, setPending] = useState(false);
  const [query, setQuery] = useState('');
  const [entryFilter, setEntryFilter] = useState<"all" | "project" | "folder">("all");
  const [sortOrder, setSortOrder] = useState<SortOrder>('updated');
  const [sortOpen, setSortOpen] = useState(false);
  const sortRoot = useRef<HTMLDivElement>(null);
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
    if (!sortOpen) return;
    const close = (event: PointerEvent) => { if (!sortRoot.current?.contains(event.target as Node)) setSortOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [sortOpen]);

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
    setCreateMenu(null);
    setEntryMenu(null);
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

  function menuPosition(event: MouseEvent<HTMLElement>, height: number) {
    const browser = event.currentTarget.closest(
      ".project-browser",
    ) as HTMLElement;
    const bounds = browser.getBoundingClientRect();
    return {
      x: browser.scrollLeft +
        Math.min(event.clientX - bounds.left, Math.max(8, bounds.width - 210)),
      y: browser.scrollTop +
        Math.min(
          event.clientY - bounds.top,
          Math.max(8, bounds.height - height),
        ),
    };
  }

  function openCreateMenu(event: MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    if (
      (event.target as Element).closest(".project-tile, .project-create-menu")
    ) return;
    setEntryMenu(null);
    setCreateMenu(menuPosition(event, 96));
  }

  function openEntryMenu(event: MouseEvent<HTMLElement>, entry: LibraryEntry) {
    event.preventDefault();
    event.stopPropagation();
    setCreateMenu(null);
    setEntryMenu({ ...menuPosition(event, 276), entry });
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
  ) {
    const entry = entryMenu?.entry;
    closeMenus();
    if (!entry) return;
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

  function openMenuEntry() {
    const entry = entryMenu?.entry;
    closeMenus();
    if (!entry) return;
    if (entry.kind === "folder") enterFolder(entry);
    else void openProject(entry.filePath);
  }

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
                <IconSymbol name="search" />
                <input type="search" aria-label={t("ui.ProjectSearch.text.b617f05c")} placeholder={t("ui.ProjectSearch.text.b617f05c")} value={query} onChange={event => setQuery(event.target.value)} />
              </label>
              {currentFolder && <label className="project-library-filter">
                <select aria-label={t("ui.CreationView.text.fa6968d9")} value={entryFilter} onChange={event => setEntryFilter(event.target.value as typeof entryFilter)}>
                  <option value="all">{t("ui.taskAdapter.label.778fc8f9")}</option>
                  <option value="project">{t("ui.ProjectSearch.kind.95b2102f")}</option>
                  <option value="folder">{t("ui.ProjectsView.text.46ecac29")}</option>
                </select>
                <IconSymbol name="chevron-down" />
              </label>}
              <div className="project-library-sort" ref={sortRoot} onKeyDown={event => {
                if (event.key === 'Escape') { setSortOpen(false); sortRoot.current?.querySelector('button')?.focus(); }
              }}>
                <button className="project-library-sort-trigger" type="button" aria-haspopup="menu" aria-expanded={sortOpen}
                  onClick={() => setSortOpen(!sortOpen)}>{sortOptions[sortOrder]}<IconSymbol name="chevron-down" /></button>
                {sortOpen && <div className="project-library-sort-menu" role="menu" aria-label={t("ui.ProjectsView.arialabel.08f059ce")} onKeyDown={event => {
                  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                  event.preventDefault();
                  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
                  buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
                }}>
                  <p>{t("ui.ProjectsView.arialabel.08f059ce")}</p>
                  {(Object.keys(sortOptions) as SortOrder[]).map(option => <button key={option} type="button" role="menuitemradio"
                    aria-checked={sortOrder === option} onClick={() => { setSortOrder(option); setSortOpen(false); sortRoot.current?.querySelector('button')?.focus(); }}>
                    {sortOptions[option]}{sortOrder === option && <IconSymbol name="check" />}
                  </button>)}
                </div>}
              </div>
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
        {createMenu && (
          <div
            className="project-create-menu"
            style={{ left: createMenu.x, top: createMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => beginCreate("folder")}>
              <IconSymbol name="folder" />
              <span>{t("ui.ProjectsView.text.95cf3cd4")}</span>
            </button>
            {currentFolder && <button type="button" onClick={() => beginCreate("canvas")}>
              <IconSymbol name="grid" />
              <span>{t("ui.ProjectsView.text.afb7afc7")}</span>
            </button>}
          </div>
        )}
        {entryMenu?.entry && (
          <div
            className="project-create-menu project-entry-menu"
            style={{ left: entryMenu.x, top: entryMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={openMenuEntry}>
              <IconSymbol name="cursor" />
              <span>{t("ui.ProjectSearch.text.65fc81e1")}</span>
            </button>
            <button
              type="button"
              onClick={() => void runMenuAction("showInFolder")}
            >
              <IconSymbol name="folder" />
              <span>{t("ui.ProjectsView.text.0d6e116b")}</span>
            </button>
            <div className="project-menu-separator" />
            <button
              type="button"
              onClick={() => {
                const entry = entryMenu.entry!;
                closeMenus();
                setRename({ entry, name: entry.name || t("ui.ProjectsView.text.21964bda") });
              }}
            >
              <IconSymbol name="pencil" />
              <span>{t("ui.ProjectsView.text.1cd80fd7")}</span>
            </button>
            <button type="button" onClick={() => void runMenuAction("copy")}>
              <IconSymbol name="copy" />
              <span>{t("ui.ProjectsView.text.4edd1d00")}</span>
            </button>
            <button type="button" onClick={() => void runMenuAction("export")}>
              <IconSymbol name="download" />
              <span>{t("ui.ProjectsView.text.18889679")}</span>
            </button>
            <div className="project-menu-separator" />
            <button
              type="button"
              className="danger"
              onClick={() => void runMenuAction("trash")}
            >
              <IconSymbol name="trash" />
              <span>{t("ui.MaterialGrid.title.3755f56f")}</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
