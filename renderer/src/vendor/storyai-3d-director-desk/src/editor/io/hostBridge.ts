import { useDirectorStore } from "../store/directorStore";
import type { DirectorProject } from "../schema/directorProject";

interface HostPanoramaPayload {
  edgeId?: unknown;
  sourceNodeId?: unknown;
  imageUrl?: unknown;
  fileName?: unknown;
}

interface HostSessionPayload {
  instanceId?: unknown;
  theme?: unknown;
  project?: unknown;
}

export interface HostCaptureItemPayload {
  dataUrl?: unknown;
  fileName?: unknown;
}

export interface HostCaptureBatchPayload {
  captures?: HostCaptureItemPayload[];
}

interface HostConnectedPanorama {
  edgeId: string;
  sourceNodeId: string;
}

let initialized = false;
let hostConnectedPanorama: HostConnectedPanorama | null = null;
let removeUnsubscribe: (() => void) | null = null;
let projectUnsubscribe: (() => void) | null = null;
let projectNotifyTimer = 0;
let suppressNextPanoramaRemovalNotice = false;

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function getHostOrigin() {
  return window.location.origin;
}

function normalizeTheme(value: unknown): "dark" | "light" | null {
  return value === "light" || value === "dark" ? value : null;
}

function applyDirectorDeskTheme(theme: "dark" | "light") {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function getInitialHostTheme() {
  try {
    return normalizeTheme(new URLSearchParams(window.location.search).get("theme"));
  } catch {
    return null;
  }
}

function notifyPanoramaRemoved() {
  if (!hostConnectedPanorama) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-panorama-removed",
      payload: hostConnectedPanorama,
    },
    getHostOrigin(),
  );
  hostConnectedPanorama = null;
}

function subscribeToPanoramaRemoval() {
  if (removeUnsubscribe) {
    return;
  }

  let previousPanoramaAssetId = useDirectorStore.getState().project.panoramaAssetId;
  removeUnsubscribe = useDirectorStore.subscribe((state) => {
    const nextPanoramaAssetId = state.project.panoramaAssetId;

    if (previousPanoramaAssetId && !nextPanoramaAssetId) {
      if (suppressNextPanoramaRemovalNotice) {
        suppressNextPanoramaRemovalNotice = false;
        hostConnectedPanorama = null;
      } else {
        notifyPanoramaRemoved();
      }
    }

    previousPanoramaAssetId = nextPanoramaAssetId;
  });
}

function importHostPanorama(payload: HostPanoramaPayload) {
  const imageUrl = normalizeString(payload.imageUrl);
  if (!imageUrl) {
    return;
  }

  const fileName = normalizeString(payload.fileName) || "画布全景图.png";
  const edgeId = normalizeString(payload.edgeId);
  const sourceNodeId = normalizeString(payload.sourceNodeId);

  if (hostConnectedPanorama && useDirectorStore.getState().project.panoramaAssetId) {
    suppressNextPanoramaRemovalNotice = true;
    useDirectorStore.getState().removePanoramaAsset();
  }
  hostConnectedPanorama = edgeId && sourceNodeId ? { edgeId, sourceNodeId } : null;
  useDirectorStore.getState().addImportedAsset({
    kind: "panorama",
    name: fileName,
    fileName,
    url: imageUrl,
    projectionMode: "backdrop",
  });
}

function clearHostPanorama() {
  if (!hostConnectedPanorama) return;
  suppressNextPanoramaRemovalNotice = true;
  useDirectorStore.getState().removePanoramaAsset();
  hostConnectedPanorama = null;
}

function openHostSession(payload: HostSessionPayload) {
  const instanceId = normalizeString(payload.instanceId);
  const theme = normalizeTheme(payload.theme);
  if (theme) {
    applyDirectorDeskTheme(theme);
  }
  suppressNextPanoramaRemovalNotice = Boolean(useDirectorStore.getState().project.panoramaAssetId);
  useDirectorStore.getState().openScopedScene(instanceId || null);
  if (isDirectorProject(payload.project)) {
    useDirectorStore.getState().replaceProject(payload.project);
  }
  suppressNextPanoramaRemovalNotice = false;
  hostConnectedPanorama = null;
}

function isDirectorProject(value: unknown): value is DirectorProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const project = value as Partial<DirectorProject>;
  return (
    project.version === 1 &&
    Boolean(project.scene) &&
    Array.isArray(project.assets) &&
    Array.isArray(project.objects) &&
    Array.isArray(project.cameras)
  );
}

function subscribeToProjectChanges() {
  if (projectUnsubscribe) return;
  let previousProject = useDirectorStore.getState().project;
  projectUnsubscribe = useDirectorStore.subscribe((state) => {
    if (state.project === previousProject) return;
    previousProject = state.project;
    window.clearTimeout(projectNotifyTimer);
    projectNotifyTimer = window.setTimeout(() => {
      window.parent?.postMessage(
        {
          type: "storyai:director-desk-project-changed",
          payload: { project: useDirectorStore.getState().project },
        },
        getHostOrigin(),
      );
    }, 180);
  });
}

export function postDirectorDeskCapturesToHost(
  captures: Array<{
    dataUrl: string;
    fileName?: string;
  }>,
) {
  const normalizedCaptures = captures
    .map((capture, index) => {
      const dataUrl = normalizeString(capture.dataUrl);
      if (!dataUrl) {
        return null;
      }

      return {
        dataUrl,
        fileName: normalizeString(capture.fileName) || `director-desk-capture-${index + 1}.png`,
      };
    })
    .filter((capture): capture is { dataUrl: string; fileName: string } => Boolean(capture));

  if (normalizedCaptures.length === 0) {
    return;
  }

  window.parent?.postMessage(
    {
      type: "storyai:director-desk-captures-sent",
      payload: {
        captures: normalizedCaptures,
      },
    },
    getHostOrigin(),
  );
}

function handleHostMessage(event: MessageEvent) {
  if (event.origin !== getHostOrigin()) {
    return;
  }

  if (event.data?.type === "storyai:director-desk-session") {
    openHostSession((event.data.payload || {}) as HostSessionPayload);
    return;
  }

  if (event.data?.type === "storyai:director-desk-panorama") {
    importHostPanorama((event.data.payload || {}) as HostPanoramaPayload);
    return;
  }

  if (event.data?.type === "storyai:director-desk-panorama-clear") {
    clearHostPanorama();
  }
}

function notifyHostInteraction() {
  window.parent?.postMessage({ type: "storyai:director-desk-interaction" }, getHostOrigin());
}

export function initDirectorDeskHostBridge() {
  if (initialized) {
    return;
  }

  initialized = true;
  applyDirectorDeskTheme(getInitialHostTheme() ?? "dark");
  window.addEventListener("message", handleHostMessage);
  window.addEventListener("pointerdown", notifyHostInteraction, true);
  subscribeToPanoramaRemoval();
  subscribeToProjectChanges();
}

export function clearDirectorDeskHostBridge() {
  if (!initialized) {
    return;
  }

  initialized = false;
  hostConnectedPanorama = null;
  suppressNextPanoramaRemovalNotice = false;
  window.removeEventListener("message", handleHostMessage);
  window.removeEventListener("pointerdown", notifyHostInteraction, true);
  removeUnsubscribe?.();
  removeUnsubscribe = null;
  projectUnsubscribe?.();
  projectUnsubscribe = null;
  window.clearTimeout(projectNotifyTimer);
  projectNotifyTimer = 0;
}
