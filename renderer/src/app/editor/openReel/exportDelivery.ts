import { t } from '@/i18n';
import { store, touchProject, flushProjectCheckpoint } from "../../../store/projectStore";
import { desktopApi } from "../../../services/desktopApi";
import { createVideoExportNode, registerVideoExportMaterial, workspaceVideoEditorNode, saveWorkspaceVideoEditorNode, WORKSPACE_VIDEO_EDITOR_ID } from "../../adapters/canvas/videoEditorActions";

export type ClipExportDelivery = {
  id: string;
  requestKey?: string;
  directory: string;
  filePath: string;
  name: string;
  title: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  size: number;
  checksum?: string;
  revision?: string;
  error?: string;
  nodeId?: string;
  materialId?: string;
  abandonedAt?: string;
};

export type ClipExportResult = {
  filePath: string;
  name: string;
  duration: number;
  deliveryId?: string;
  nodeId?: string;
  materialId?: string;
  revision?: string;
  replayed?: boolean;
  applied?: boolean;
};

function owner(nodeId: string): Record<string, any> {
  if (nodeId === WORKSPACE_VIDEO_EDITOR_ID) return store.project;
  const node = store.project.nodes.find((item: any) => item.id === nodeId);
  if (!node) throw new Error(t("ui.exportDelivery.text.82374b66"));
  return node;
}

export function clipExportDeliveries(nodeId: string): ClipExportDelivery[] {
  return owner(nodeId).clipExportDeliveries || [];
}

export function pendingClipExportDeliveries(nodeId: string): ClipExportDelivery[] {
  return clipExportDeliveries(nodeId)
    .filter(entry => (!entry.nodeId || entry.error) && !entry.abandonedAt)
    .map(entry => ({ ...entry, nodeId: entry.nodeId || store.project.nodes.find((node: any) =>
      node.generatedFrom?.nodeId === nodeId && node.generatedFrom?.deliveryId === entry.id)?.id }));
}

/** Stop future registration without deleting any completed file or canvas data. */
export function abandonClipExportDelivery(nodeId: string, id: string) {
  const delivery = clipExportDeliveries(nodeId).find((entry) => entry.id === id);
  if (!delivery) throw new Error(t("ui.exportDelivery.text.734d9773"));
  if (delivery.directory !== store.projectDir) throw new Error(t("ui.exportDelivery.text.3ec52ea0"));
  delivery.abandonedAt ||= new Date().toISOString();
  touchProject();
  return delivery;
}

/** Called only after a successful write receipt. Persist the file before registering canvas data. */
export function stageClipExportDelivery(nodeId: string, delivery: ClipExportDelivery) {
  const target = owner(nodeId);
  if (delivery.directory !== store.projectDir) throw new Error(t("ui.exportDelivery.text.cc7defca"));
  const entries = clipExportDeliveries(nodeId);
  if (!entries.some((entry) => entry.id === delivery.id)) target.clipExportDeliveries = [...entries, { ...delivery }];
  touchProject();
}

export function completeClipExportDelivery(nodeId: string, id: string) {
  const delivery = clipExportDeliveries(nodeId).find((entry) => entry.id === id);
  if (!delivery) throw new Error(t("ui.exportDelivery.text.734d9773"));
  if (delivery.abandonedAt) throw new Error(t("ui.exportDelivery.text.c41e0d39"));
  if (delivery.directory !== store.projectDir) throw new Error(t("ui.exportDelivery.text.5912f0dc"));
  try {
    const source = nodeId === WORKSPACE_VIDEO_EDITOR_ID ? workspaceVideoEditorNode() : owner(nodeId);
    const node = createVideoExportNode(source, { ...delivery, deliveryId: delivery.id }, delivery.title);
    // Re-read the record: a failed registration rolls back canvas objects.
    const current = clipExportDeliveries(nodeId).find((entry) => entry.id === id)!;
    current.nodeId = node.id;
    delete current.error;
    source.videoEditProject = {
      ...source.videoEditProject,
      lastExport: { filePath: delivery.filePath, duration: delivery.duration, revision: delivery.revision, exportedAt: new Date().toISOString() },
    };
    if (nodeId === WORKSPACE_VIDEO_EDITOR_ID) saveWorkspaceVideoEditorNode(source);
    touchProject();
    return node;
  } catch (cause) {
    const current = clipExportDeliveries(nodeId).find((entry) => entry.id === id);
    if (current) current.error = cause instanceof Error ? cause.message : String(cause);
    touchProject();
    throw cause;
  }
}

/** A persisted receipt is not evidence that its file still exists after reopening. */
export async function retryClipExportDelivery(nodeId: string, id: string, options: { replay?: boolean; assertCurrent?: () => void } = {}) {
  const project = store.project;
  const directory = store.projectDir;
  const sourceOwner = owner(nodeId);
  const delivery = clipExportDeliveries(nodeId).find((entry) => entry.id === id);
  if (!delivery) throw new Error(t("ui.exportDelivery.text.734d9773"));
  if (delivery.abandonedAt) throw new Error(t("ui.exportDelivery.text.c41e0d39"));
  if (delivery.directory !== directory) throw new Error(t("ui.exportDelivery.text.5912f0dc"));
  const expected = { ...delivery };
  try {
    const actual = await desktopApi.file.checksum(expected.filePath);
    if (!actual?.checksum || actual.size !== expected.size || (expected.checksum && actual.checksum !== expected.checksum)) {
      throw new Error(t("ui.exportDelivery.text.e204f7df"));
    }
    if (store.project !== project || store.projectDir !== directory) {
      throw new Error(t("ui.exportDelivery.text.cc7defca"));
    }
    if (owner(nodeId) !== sourceOwner) throw new Error(t("ui.exportDelivery.text.6df2fd64"));
    const current = clipExportDeliveries(nodeId).find((entry) => entry.id === id);
    if (!current || current.filePath !== expected.filePath || current.size !== expected.size || current.checksum !== expected.checksum) {
      throw new Error(t("ui.exportDelivery.text.baa42ff0"));
    }
    if (current.abandonedAt) throw new Error(t("ui.exportDelivery.text.c41e0d39"));
    options.assertCurrent?.();
    if (current.nodeId) {
      const result = project.nodes.find((node: any) => node.id === current.nodeId);
      if (!result || result.generatedFrom?.nodeId !== nodeId || result.generatedFrom?.deliveryId !== id
        || !project.materials.some((material: any) => material.id === result.materialId)
        || (result.uploadedFile?.path || result.uploadedFile?.filePath) !== current.filePath) {
        throw new Error(t("ui.exportDelivery.text.08f6bd94"));
      }
      if (!options.replay || current.error) {
        delete current.error;
        touchProject();
        if (!await flushProjectCheckpoint({ force: true })) throw new Error(t("ui.exportDelivery.text.d3255706"));
      }
      return result;
    }
    const checkpoint = async () => {
      touchProject();
      if (!await flushProjectCheckpoint({ force: true })) throw new Error(t("ui.exportDelivery.text.710f861b"));
      options.assertCurrent?.();
      if (store.project !== project || store.projectDir !== directory) throw new Error(t("ui.exportDelivery.text.cc7defca"));
      if (owner(nodeId) !== sourceOwner) throw new Error(t("ui.exportDelivery.text.6df2fd64"));
      if (current.abandonedAt) throw new Error(t("ui.exportDelivery.text.c41e0d39"));
    };
    // Persist the real file receipt before registration, then the material receipt
    // before placement. A placement failure must not undo a confirmed material.
    await checkpoint();
    current.materialId = registerVideoExportMaterial(current).id;
    await checkpoint();
    const result = completeClipExportDelivery(nodeId, id);
    await checkpoint();
    return result;
  } catch (cause) {
    // Never attach an old asynchronous error to a different project or replacement receipt.
    if (store.project === project && store.projectDir === directory) {
      const source = nodeId === WORKSPACE_VIDEO_EDITOR_ID ? project : project.nodes.find((node: any) => node.id === nodeId);
      const current = source === sourceOwner ? source?.clipExportDeliveries?.find((entry: ClipExportDelivery) => entry.id === id) : undefined;
      if (current && current.filePath === expected.filePath && current.checksum === expected.checksum) {
        current.error = cause instanceof Error ? cause.message : String(cause);
        touchProject();
      }
    }
    throw cause;
  }
}

/** Exact tool-call identity survives reloads; a completed replay is read-only. */
export async function replayClipExportDelivery(nodeId: string, requestKey: string): Promise<ClipExportResult | null> {
  const delivery = clipExportDeliveries(nodeId).find(entry => entry.requestKey === requestKey);
  if (!delivery) return null;
  const hadResult = store.project.nodes.some((node: any) =>
    node.generatedFrom?.nodeId === nodeId && node.generatedFrom?.deliveryId === delivery.id);
  const result = await retryClipExportDelivery(nodeId, delivery.id, { replay: true });
  return {
    filePath: delivery.filePath, name: delivery.name, duration: delivery.duration,
    deliveryId: delivery.id, nodeId: result.id, materialId: result.materialId,
    ...(delivery.revision ? { revision: delivery.revision } : {}), replayed: true, applied: !hadResult,
  };
}
