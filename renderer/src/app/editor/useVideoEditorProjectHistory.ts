import { useCallback, useRef, useState } from "react";
import type { VideoEditorProject } from "./videoEditorTypes";

const cloneProject = (project: VideoEditorProject) =>
  JSON.parse(JSON.stringify(project)) as VideoEditorProject;

export function useVideoEditorProjectHistory(
  initialProject: VideoEditorProject,
  controller: { persist: (project: VideoEditorProject) => void },
) {
  const [project, setProject] = useState(initialProject);
  const projectRef = useRef(project);
  const [history, setHistory] = useState<VideoEditorProject[]>([]);
  const [future, setFuture] = useState<VideoEditorProject[]>([]);
  projectRef.current = project;

  const recordHistory = useCallback((snapshot: VideoEditorProject) => {
    setHistory((items) => [...items.slice(-59), snapshot]);
    setFuture([]);
  }, []);

  const commit = useCallback((next: VideoEditorProject, record = true) => {
    if (next === projectRef.current) return;
    if (record) recordHistory(cloneProject(projectRef.current));
    projectRef.current = next;
    setProject(next);
    controller.persist(next);
  }, [controller, recordHistory]);

  const undo = useCallback(() => {
    const previous = history.at(-1);
    if (!previous) return;
    setHistory((items) => items.slice(0, -1));
    setFuture((items) => [...items, cloneProject(projectRef.current)]);
    commit(cloneProject(previous), false);
  }, [commit, history]);

  const redo = useCallback(() => {
    const next = future.at(-1);
    if (!next) return;
    setFuture((items) => items.slice(0, -1));
    setHistory((items) => [...items, cloneProject(projectRef.current)]);
    commit(cloneProject(next), false);
  }, [commit, future]);

  return {
    project,
    projectRef,
    setProject,
    commit,
    recordHistory,
    undo,
    redo,
    canUndo: history.length > 0,
    canRedo: future.length > 0,
  };
}
