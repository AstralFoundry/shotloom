import { t } from '@/i18n';
import { desktopApi } from "../../services/desktopApi.ts";
import {
  cloneRecentProject,
  createNewProject,
  exportProjectPackage,
  importProjectPackage,
  loadRecentProjects,
  navigateToRoute,
  openProjectInNewWindow,
  openRecentProject,
  persistSession,
  showProjectInFolder,
  store,
  trashRecentProject,
} from "../../store/projectStore.ts";
import { settingsStore } from "../../store/settingsStore.ts";
import { hasActiveGenerationTasks } from "../../store/taskStore.ts";
import { showToast } from "../../store/notificationStore";
import type {
  LibraryEntry,
  ProjectsController,
} from "../views/ProjectsView";
import { confirmAction } from "../ui/confirm/confirmService";

function replacePathPrefix(value: unknown, oldDir: string, newDir: string) {
  if (typeof value !== "string") return value;
  if (value === oldDir) return newDir;
  return value.startsWith(`${oldDir}/`) || value.startsWith(`${oldDir}\\`)
    ? `${newDir}${value.slice(oldDir.length)}`
    : value;
}

async function migrateRenamedRecentProjects(
  entry: LibraryEntry,
  result: { oldDir: string; newDir: string; name: string },
) {
  const recent = await desktopApi.recent.list();
  const affected = recent.filter((project: { filePath?: string; projectDir?: string }) => (
    replacePathPrefix(project.filePath, result.oldDir, result.newDir) !== project.filePath ||
    replacePathPrefix(project.projectDir, result.oldDir, result.newDir) !== project.projectDir
  ));
  for (const project of affected) {
    if (project.filePath) await desktopApi.recent.remove(project.filePath);
  }
  for (const project of [...affected].reverse()) {
    await desktopApi.recent.add({
      ...project,
      name: entry.kind === "project" ? result.name : project.name,
      projectDir: replacePathPrefix(project.projectDir, result.oldDir, result.newDir),
      filePath: replacePathPrefix(project.filePath, result.oldDir, result.newDir),
    });
  }
}

async function ensureRoot() {
  const requested = settingsStore.projectRootDir ||
    await desktopApi.project.getDefaultRoot();
  return desktopApi.project.ensureRoot(requested);
}

function findProjectFolderPath(
  entries: LibraryEntry[],
  filePath: string | null | undefined,
): string[] {
  if (!filePath) return [];
  for (const entry of entries) {
    if (entry.kind !== "folder") continue;
    const children = entry.children || [];
    if (
      children.some((child) =>
        child.kind === "project" && child.filePath === filePath
      )
    ) {
      return [entry.folderDir];
    }
    const nestedPath = findProjectFolderPath(children, filePath);
    if (nestedPath.length) return [entry.folderDir, ...nestedPath];
  }
  return [];
}

export function projectLibraryData() {
  const entries = (store.projectLibraryEntries || []) as LibraryEntry[];
  return {
    entries,
    currentFilePath: store.filePath,
    initialFolderPath: findProjectFolderPath(entries, store.filePath),
    cloneProgress: store.cloneProgressByProject || {},
  };
}

export const projectLibraryController: ProjectsController = {
  async importPackage() {
    await importProjectPackage();
  },
  async createFolder(parentDir, name) {
    await desktopApi.project.createLibraryFolder(
      parentDir || await ensureRoot(),
      name,
    );
    await loadRecentProjects();
  },
  async createProject(name, folder) {
    await createNewProject(name, {
      openAfterCreate: false,
      parentDir: folder.folderDir,
      sharedRootDir: folder.sharedRootDir || folder.folderDir,
      sharedName: folder.name,
    });
  },
  async rename(entry, name) {
    const oldDir = entry.kind === "project"
      ? entry.projectDir
      : entry.folderDir;
    const result = await desktopApi.project.renameEntry(oldDir, name);
    await migrateRenamedRecentProjects(entry, result);
    store.projectDir = replacePathPrefix(
      store.projectDir,
      result.oldDir,
      result.newDir,
    ) as string | null;
    store.filePath = replacePathPrefix(
      store.filePath,
      result.oldDir,
      result.newDir,
    ) as string | null;
    for (const key of ["library", "series"]) {
      const boundary = store.project[key];
      if (!boundary) continue;
      boundary.rootDir = replacePathPrefix(
        boundary.rootDir,
        result.oldDir,
        result.newDir,
      );
      boundary.assetRootDir = replacePathPrefix(
        boundary.assetRootDir,
        result.oldDir,
        result.newDir,
      );
      boundary.libraryFile = replacePathPrefix(
        boundary.libraryFile,
        result.oldDir,
        result.newDir,
      );
    }
    if (
      entry.kind === "project" && oldDir === result.oldDir &&
      store.projectDir === result.newDir
    ) {
      store.project.name = result.name;
      if (Number.isInteger(result.storageRevision)) store.project.storageRevision = result.storageRevision;
    }
    persistSession();
    await loadRecentProjects();
    showToast(t("ui.projectLibraryAdapter.text.dc9fe43f"));
  },
  async openProject(filePath) {
    if (filePath === store.filePath) {
      navigateToRoute("creation");
      return;
    }
    if (hasActiveGenerationTasks()) {
      const projectDir = filePath.split(/[\\/]/).slice(0, -1).join("/");
      const opened = await openProjectInNewWindow(projectDir);
      if (opened) showToast(t("ui.projectLibraryAdapter.text.c8a1d53e"));
      return;
    }
    await openRecentProject(filePath);
  },
  async showInFolder(entry) {
    await showProjectInFolder(
      entry.kind === "project" ? entry.projectDir : entry.folderDir,
    );
  },
  async copy(entry) {
    if (entry.kind === "project") await cloneRecentProject(entry);
    else {
      const result = await desktopApi.project.cloneLibraryFolder(
        entry.folderDir,
      );
      if (result?.ok) {
        await loadRecentProjects();
        showToast(t("ui.projectLibraryAdapter.text.ce11e56d", { value0: result.name }));
      }
    }
  },
  async export(entry) {
    if (entry.kind === "project") await exportProjectPackage(entry);
    else {
      const result = await desktopApi.project.exportLibraryFolder(
        entry.folderDir,
      );
      if (result?.ok) showToast(t("ui.projectLibraryAdapter.text.247d0662"));
    }
  },
  async trash(entry) {
    if (entry.kind === "project") {
      const confirmed = await confirmAction({
        title: t("ui.projectLibraryAdapter.text.bade510b", { value0: entry.name || t("ui.ProjectCard.text.060f1435") }),
        danger: true,
      });
      if (confirmed) await trashRecentProject(entry);
      return;
    }
    const confirmed = await confirmAction({
      title: t("ui.projectLibraryAdapter.text.7c9ffe46", { value0: entry.name }),
      danger: true,
    });
    if (!confirmed) return;
    const result = await desktopApi.project.trashLibraryFolder(entry.folderDir);
    if (result?.ok) {
      await loadRecentProjects();
      showToast(t("ui.projectLibraryAdapter.text.465a30d7"));
    } else showToast(result?.error || t("ui.projectLibraryAdapter.text.09daea6f"));
  },
};
