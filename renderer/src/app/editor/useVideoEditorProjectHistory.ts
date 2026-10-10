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
  const historyRef = useRef(history);
  const futureRef = useRef(future);
  projectRef.current = project;

  const recordHistory = useCallback((snapshot: VideoEditorProject) => {
    historyRef.current = [...historyRef.current.slice(-59), snapshot];
    futureRef.current = [];
    setHistory(historyRef.current);
    setFuture(futureRef.current);
  }, []);

  const commit = useCallback((next: VideoEditorProject, record = true) => {
    if (next === projectRef.current) return;
    if (record) recordHistory(cloneProject(projectRef.current));
    projectRef.current = next;
    setProject(next);
    controller.persist(next);
  }, [controller, recordHistory]);

  const undo = useCallback(() => {
    const previous = historyRef.current.at(-1);
    if (!previous) return false;
    historyRef.current = historyRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, cloneProject(projectRef.current)];
    setHistory(historyRef.current);
    setFuture(futureRef.current);
    commit(cloneProject(previous), false);
    return true;
  }, [commit]);

  const redo = useCallback(() => {
    const next = futureRef.current.at(-1);
    if (!next) return false;
    futureRef.current = futureRef.current.slice(0, -1);
    historyRef.current = [...historyRef.current, cloneProject(projectRef.current)];
    setFuture(futureRef.current);
    setHistory(historyRef.current);
    commit(cloneProject(next), false);
    return true;
  }, [commit]);

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
