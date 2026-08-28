import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { formatTime } from "../../utils/format.js";
import { EmptyState } from "../components/EmptyState";
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
  itemCount?: number;
  children?: LibraryEntry[];
}

export type LibraryEntry = ProjectLibraryEntry | ProjectFolderEntry;

export interface ProjectsController {
  importPackage: () => Promise<void>;
  createFolder: (parentDir: string | null, name: string) => Promise<void>;
  createProject: (
    name: string,
    folder?: ProjectFolderEntry | null,
  ) => Promise<void>;
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
  const createInput = useRef<HTMLInputElement>(null);
  const renameInput = useRef<HTMLInputElement>(null);
  const renameEntryKey = rename ? entryKey(rename.entry) : "";
  const currentFolder = folderPath.length
    ? findFolder(entries, folderPath.at(-1)!)
    : null;
  const visibleEntries = useMemo(() => currentFolder?.children || entries, [
    currentFolder,
    entries,
  ]);

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
    setFolderPath((path) => [...path, folder.folderDir]);
  }
  function goToLevel(index: number) {
    closeMenus();
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
    setDraft({
      type,
      name: type === "folder" ? "新建文件夹" : "新建画布",
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
      } else await controller.createProject(name, value.context);
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
    if (entry) await controller[action](entry);
  }

  function openMenuEntry() {
    const entry = entryMenu?.entry;
    closeMenus();
    if (!entry) return;
    if (entry.kind === "folder") enterFolder(entry);
    else void controller.openProject(entry.filePath);
  }

  const breadcrumbs = folderPath.map((key) => findFolder(entries, key)).filter(
    Boolean,
  ) as ProjectFolderEntry[];
  return (
    <>
      <div className="page-head project-page-head">
        <div>
          <h1 className="page-title">项目库</h1>
          {currentFolder && (
            <nav className="project-breadcrumb" aria-label="项目路径">
              <button
                className="project-breadcrumb-back"
                type="button"
                title="返回上一层"
                onClick={() =>
                  goToLevel(folderPath.length - 2)}
              >
                <IconSymbol name="chevron-left" />
              </button>
              <button
                type="button"
                onClick={() =>
                  goToLevel(-1)}
              >
                项目库
              </button>
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
        </div>
        <div className="project-page-actions">
          <button
            className="button primary"
            type="button"
            onClick={() => beginCreate("canvas")}
          >
            <IconSymbol name="grid" />新建画布
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => beginCreate("folder")}
          >
            <IconSymbol name="folder" />新建文件夹
          </button>
          <button
            className="button ghost"
            type="button"
            onClick={() => void controller.importPackage()}
          >
            <IconSymbol name="upload" />导入
          </button>
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
              <strong>{currentFolder?.name || "项目与文件夹"}</strong>
              <span>{visibleEntries.length} 个条目</span>
            </div>
          </header>
          {(visibleEntries.length > 0 || draft)
            ? (
              <div className="project-card-grid">
                {draft && (
                  <article className="project-tile project-create-tile">
                    <div className="project-tile-preview">
                      <span
                        className={draft.type === "folder"
                          ? "project-folder-glyph"
                          : "project-canvas-glyph"}
                      >
                        <IconSymbol
                          name={draft.type === "folder" ? "folder" : "grid"}
                        />
                      </span>
                    </div>
                    <div className="project-tile-body">
                      <input
                        ref={createInput}
                        value={draft.name}
                        className="project-create-name"
                        aria-label={draft.type === "folder"
                          ? "文件夹名称"
                          : "画布名称"}
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
                        {draft.type === "folder" ? "新文件夹" : "新画布"}
                      </small>
                    </div>
                  </article>
                )}
                {visibleEntries.map((entry) =>
                  rename?.entry === entry
                    ? (
                      <article
                        key={entryKey(entry)}
                        className="project-tile project-create-tile"
                      >
                        <div className="project-tile-preview">
                          <span
                            className={entry.kind === "project"
                              ? "project-canvas-glyph"
                              : "project-folder-glyph"}
                          >
                            <IconSymbol
                              name={entry.kind === "project"
                                ? "grid"
                                : "folder"}
                            />
                          </span>
                        </div>
                        <div className="project-tile-body">
                          <input
                            ref={renameInput}
                            value={rename.name}
                            className="project-create-name"
                            aria-label="修改名称"
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
                            {entry.kind === "project" ? "画布" : "文件夹"} ·
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
                          <span className="project-folder-glyph">
                            <IconSymbol name="folder" />
                          </span>
                        </div>
                        <div className="project-tile-body">
                          <h3>{entry.name}</h3>
                          <p>
                            {entry.itemCount || 0} 个条目 ·{" "}
                            {formatTime(entry.lastOpenedAt)}
                          </p>
                        </div>
                        <button
                          className="project-tile-menu"
                          type="button"
                          title="更多操作"
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
                        onOpen={(project) =>
                          void controller.openProject(project.filePath)}
                        onMenu={(event) => openEntryMenu(event, entry)}
                        onContextMenu={(event) => openEntryMenu(event, entry)}
                      />
                    )
                )}
              </div>
            )
            : <EmptyState icon="folder" text="暂无最近项目" />}
        </div>
        {createMenu && (
          <div
            className="project-create-menu"
            style={{ left: createMenu.x, top: createMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button type="button" onClick={() => beginCreate("folder")}>
              <IconSymbol name="folder" />
              <span>新建文件夹</span>
            </button>
            <button type="button" onClick={() => beginCreate("canvas")}>
              <IconSymbol name="grid" />
              <span>新建画布</span>
            </button>
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
              <span>打开</span>
            </button>
            <button
              type="button"
              onClick={() => void runMenuAction("showInFolder")}
            >
              <IconSymbol name="folder" />
              <span>在目录中显示</span>
            </button>
            <div className="project-menu-separator" />
            <button
              type="button"
              onClick={() => {
                const entry = entryMenu.entry!;
                closeMenus();
                setRename({ entry, name: entry.name || "未命名画布" });
              }}
            >
              <IconSymbol name="pencil" />
              <span>重命名</span>
            </button>
            <button type="button" onClick={() => void runMenuAction("copy")}>
              <IconSymbol name="copy" />
              <span>复制</span>
            </button>
            <button type="button" onClick={() => void runMenuAction("export")}>
              <IconSymbol name="download" />
              <span>导出</span>
            </button>
            <div className="project-menu-separator" />
            <button
              type="button"
              className="danger"
              onClick={() => void runMenuAction("trash")}
            >
              <IconSymbol name="trash" />
              <span>删除</span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}
