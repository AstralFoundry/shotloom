import { t } from '../i18n/index.ts';
import { store } from "../store/projectStore";
import { uid } from "../utils/format";
import { readNativeSnapshot, snapshotRelativePath, writeNativeSnapshot } from "./clipSnapshotStore";
import { desktopApi } from "./desktopApi";

type RecordValue = Record<string, any>;
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** Clipboard staging belongs to the clipboard lifetime; copied clips need project-owned media. */
export async function copyClipWorkflowResources(nodes: RecordValue[], resources: RecordValue[], directory: string) {
  const required = new Set<string>(nodes.filter((node) => node.type === "clipStudio")
    .flatMap((node) => (node.videoEditProject?.assets || []).map((asset: RecordValue) => String(asset.sourceFile || ""))).filter(Boolean));
  const next = copy(resources);
  for (const path of required) {
    const resource = next.find((item) => [item.path, item.filePath, item.localPath].includes(path));
    if (!directory || !resource?.stagedPath) throw new Error(t("errors.ceede8d685", { value0: path }));
    const saved = await desktopApi.file.copyToDirectory(resource.stagedPath, `${directory.replace(/[\\/]$/, "")}/assets`, resource.name || resource.fileName);
    if (!saved?.filePath) throw new Error(t("errors.19fb816c7a", { value0: path }));
    resource.stagedPath = saved.filePath;
  }
  return next;
}

/** Workflow payloads carry full native facts; canvas nodes retain only their own snapshot reference. */
export async function captureClipWorkflowNodes(nodes: RecordValue[]) {
  const project = store.project;
  const directory = store.projectDir;
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!;
    if (node.type !== "clipStudio") continue;
    if (!directory) throw new Error(t("errors.c8ade6b52c"));
    const source = project.nodes.find((item: RecordValue) => item.id === node.id);
    if (!source) throw new Error(t("errors.7fd88fca60"));
    const native = await readNativeSnapshot(directory, node.id, true);
    if (!native) throw new Error(t("errors.a047370de4"));
    if (store.project !== project || store.projectDir !== directory || !project.nodes.includes(source)) {
      throw new Error(t("errors.6544e727d9"));
    }
    nodes[index] = { ...copy(source), clipTransfer: { version: 1, native } };
  }
}

/** Prepare all independent files before the caller mutates the destination canvas/history. */
export async function restoreClipWorkflowNodes(
  nodes: RecordValue[],
  nodeIds: Map<string, string>,
  edgeIds: Map<string, string>,
  resourcePaths: Map<string, string> = new Map(),
  edges: RecordValue[] = [],
) {
  const project = store.project;
  const directory = store.projectDir;
  for (const node of nodes) {
    if (node.type !== "clipStudio") continue;
    const native = node.clipTransfer?.version === 1 ? node.clipTransfer.native : null;
    if (!native || !directory || !node.videoEditProject) throw new Error(t("errors.e6af142b11"));
    const assetIds = new Map<string, string>();
    for (const asset of node.videoEditProject?.assets || []) {
      for (const [oldId, newId] of nodeIds) {
        const prefix = `canvas:${oldId}:`;
        if (String(asset.id).startsWith(prefix)) assetIds.set(asset.id, `canvas:${newId}:${asset.id.slice(prefix.length)}`);
      }
    }
    const nativeId = native.id;
    const newNativeId = uid();
    // Action history contains earlier clip/project snapshots too. Remap the same facts
    // throughout it so undo cannot reconnect a duplicate to the original canvas.
    const remap = (value: any): any => {
      if (Array.isArray(value)) return value.map(remap);
      if (!value || typeof value !== "object") return value;
      const next: RecordValue = {};
      for (const [key, item] of Object.entries(value)) {
        if (key === "sourceConnectionId") {
          if (edgeIds.has(String(item))) next[key] = edgeIds.get(String(item));
        } else if ((key === "assetId" || key === "shotloomAssetId") && assetIds.has(String(item))) next[key] = assetIds.get(String(item));
        else if ((key === "id" || key === "projectId") && item === nativeId) next[key] = newNativeId;
        else if (key === "sourceFile" && resourcePaths.has(String(item))) next[key] = resourcePaths.get(String(item));
        else next[key] = remap(item);
      }
      return next;
    };
    const restored = remap(native);
    node.videoEditProject = remap(node.videoEditProject);
    for (const asset of node.videoEditProject?.assets || []) {
      if (assetIds.has(asset.id)) asset.id = assetIds.get(asset.id);
    }
    node.clipSources = (node.clipSources || []).filter((source: RecordValue) => edgeIds.has(source.edge?.id)).map((source: RecordValue) => {
      const next = remap(source);
      next.edge.id = edgeIds.get(source.edge.id);
      next.edge.source = nodeIds.get(source.edge.source);
      next.edge.target = node.id;
      return next;
    });
    for (const edge of edges) {
      if (edge.target === node.id && assetIds.has(edge.data?.assetId)) edge.data = remap(edge.data);
    }
    delete node.clipTransfer;
    delete node.clipExportDeliveries;
    delete node.videoEdit;
    if (node.videoEditProject) delete node.videoEditProject.lastExport;
    const written = await writeNativeSnapshot(directory, node.id, restored);
    if (!written) throw new Error(t("errors.9c1842acf5"));
    if (store.project !== project || store.projectDir !== directory) throw new Error(t("errors.50b98e9a71"));
    node.videoEditProject.openReelSnapshot = snapshotRelativePath(node.id);
  }
}
