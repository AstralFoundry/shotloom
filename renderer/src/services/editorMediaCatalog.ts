import { t } from '../i18n/index.ts';
import { inferMediaType } from '../utils/mediaType.ts';
import { createNodeMediaCatalog, selectedNodeMedia } from "../utils/nodeMedia.ts";
import { convertFileSrc } from "@tauri-apps/api/core";
import { store } from "../store/projectStore.ts";
import { desktopApi } from "./desktopApi.ts";
import { agentNodeAliasMaps } from "./agentCanvasSnapshot.ts";
import { probeEditorMedia } from "../utils/editorMediaImport.ts";
import type { VideoEditorAsset, VideoEditorAssetType } from "../app/editor/videoEditorTypes.ts";

/**
 * 剪辑台可导入媒体的唯一清单来源。
 *
 * 参考实现里"添加媒体"的候选集就是宿主画布产物的枚举：剪辑台不自己去磁盘捞文件，
 * 宿主把当前可用的资源清单交给选择器。画布"加入剪辑"、剪辑台选择器和 Agent 的
 * video_project_media 必须共用这一份枚举与同一套稳定 key，否则同一个节点在三个入口
 * 会得出不同素材，选择器的"已添加"判定也会与工程里的资产对不上。
 */

export type EditorMediaCandidate = {
  key: string;
  name: string;
  type: VideoEditorAssetType;
  sourceFile: string;
  remoteUrl: string;
  /** 能在渲染进程里直接访问的地址，用于缩略图预览。 */
  previewUrl: string;
  hasLocalFile: boolean;
  durationSec: number;
  width: number;
  height: number;
  origin: "canvas" | "material";
  nodeId: string;
  alias: string;
  nodeType: string;
  tags: string[];
};

function localMediaUrl(sourceFile: string, remoteUrl: string) {
  if (!sourceFile) return remoteUrl;
  // convertFileSrc 只在 Tauri 环境可用；浏览器调试模式退回原始远程地址或空串。
  try {
    return convertFileSrc(sourceFile);
  } catch {
    return remoteUrl;
  }
}
/**
 * 画布产物的选择顺序：显式选中 > 标记选中 > 最后一个产物 > 上传文件。
 * 剪辑台选择器和节点"加入剪辑"共用，两侧对同一节点必须得出同一个产物。
 */
export function canvasNodeOutput(node: Record<string, any>) {
  return selectedNodeMedia(node, store.project);
}

/**
 * 产物的稳定标识：节点 id + 产物 id。节点重新生成后产物 id 变化，
 * 剪辑台据此分辨"旧素材"和"新素材"，选择器据此判断是否已经添加过。
 */
export function editorCanvasAssetKey(nodeId: string, output: Record<string, any>): string {
  const sourceFile = String(output?.filePath || output?.path || "");
  const remoteUrl = String(output?.url || output?.remoteUrl || output?.previewUrl || "");
  return `canvas:${nodeId}:${String(output?.id || sourceFile || remoteUrl)}`;
}

function toCandidate(
  source: Record<string, any>,
  fallbackName: string,
): {
  name: string;
  type: VideoEditorAssetType;
  sourceFile: string;
  remoteUrl: string;
  previewUrl: string;
  durationSec: number;
  width: number;
  height: number;
} | null {
  const sourceFile = String(source?.filePath || source?.path || "");
  const remoteUrl = String(source?.url || source?.remoteUrl || source?.previewUrl || "");
  if (!sourceFile && !remoteUrl) return null;
  const metadata = source?.metadata || {};
  const type = inferMediaType({ resourceType: String(source?.resourceType || source?.mimeType || source?.type || ""), filePath: sourceFile || remoteUrl });
  if (type !== "image" && type !== "video" && type !== "audio") return null;
  const previewUrl = localMediaUrl(sourceFile, remoteUrl);
  // 可播放地址只服务缩略图与就地预览：没有它素材依然可以按本地文件导入，
  // 不能因为当前环境没有资源协议就把来源从清单里抹掉。
  return {
    name: String(source?.title || source?.name || fallbackName || t("ui.canvasAdapter.text.75e00c77")),
    type,
    sourceFile,
    remoteUrl,
    previewUrl,
    durationSec: Number(source?.duration || metadata.duration || 0),
    width: Number(source?.width || metadata.width || 0),
    height: Number(source?.height || metadata.height || 0),
  };
}

/**
 * 素材库条目（project.assets）按 materialId 挂标签与分类，节点产物本身不带标签。
 * 选择器的标签筛选必须来自真实数据，不能照抄参考实现里那几枚写死的标签名。
 */
function materialTagIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const asset of (store.project.assets || []) as Record<string, any>[]) {
    const materialId = String(asset?.materialId || "");
    if (!materialId) continue;
    const labels = [
      ...(Array.isArray(asset?.tags) ? asset.tags.map(String) : []),
      String(asset?.category || ""),
    ].filter(Boolean);
    if (!labels.length) continue;
    index.set(materialId, [...new Set([...(index.get(materialId) || []), ...labels])]);
  }
  return index;
}

/** 产物指向哪个素材库条目：节点自己的 materialId，或合成的素材产物 id `material:<id>`。 */
function outputMaterialId(node: Record<string, any>, output: Record<string, any>): string {
  const direct = String(node?.materialId || output?.materialId || "");
  if (direct) return direct;
  const id = String(output?.id || "");
  return id.startsWith("material:") ? id.slice("material:".length) : "";
}

function fileIdentity(sourceFile: string, remoteUrl: string) {
  return String(sourceFile || remoteUrl || "");
}

export function listEditorMediaCandidates(): EditorMediaCandidate[] {
  const tagsByMaterial = materialTagIndex();
  const out: EditorMediaCandidate[] = [];
  const aliasById = agentNodeAliasMaps((store.project.nodes || []) as never[]).aliasById;
  const canvasFiles = new Set<string>();
  const media = createNodeMediaCatalog(store.project);
  for (const node of (store.project.nodes || []) as Record<string, any>[]) {
    if (node.archived) continue;
    const output = media.selected(node);
    if (!output) continue;
    const detail = toCandidate(output, node.title || t("media.canvasOutput"));
    if (!detail) continue;
    const identity = fileIdentity(detail.sourceFile, detail.remoteUrl);
    if (identity) canvasFiles.add(identity);
    const materialId = outputMaterialId(node, output);
    out.push({
      key: editorCanvasAssetKey(String(node.id), output),
      ...detail,
      hasLocalFile: Boolean(detail.sourceFile),
      origin: "canvas",
      nodeId: String(node.id),
      alias: String(aliasById[node.id] || ""),
      nodeType: String(node.type || ""),
      tags: [...(tagsByMaterial.get(materialId) || [])],
    });
  }
  for (const material of (store.project.materials || []) as Record<string, any>[]) {
    const detail = toCandidate(material, t("ui.AssetPickerDialog.label.5be49fff"));
    if (!detail) continue;
    const identity = fileIdentity(detail.sourceFile, detail.remoteUrl);
    // 节点产物已经覆盖了同一份文件时只留画布条目，否则选择器会出现两个同名磁贴。
    if (identity && canvasFiles.has(identity)) continue;
    out.push({
      key: `material:${material.id}`,
      ...detail,
      hasLocalFile: Boolean(detail.sourceFile),
      origin: "material",
      nodeId: String(material.nodeId || ""),
      alias: "",
      nodeType: "",
      tags: [
        ...new Set([
          ...(Array.isArray(material.tags) ? material.tags.map(String) : []),
          ...(tagsByMaterial.get(String(material.id || "")) || []),
        ]),
      ],
    });
  }
  return out;
}

/** 按稳定 key 取回当前仍然存在的候选；产物变化或节点删除后取不到，即视为不可导入。 */
export function findEditorMediaCandidate(key: string): EditorMediaCandidate | null {
  if (!key) return null;
  return listEditorMediaCandidates().find((candidate) => candidate.key === key) || null;
}

/** 节点当前的产物候选；节点还没有可剪产物时返回 null，由调用方决定提示。 */
export function editorCanvasCandidate(nodeId: string): EditorMediaCandidate | null {
  if (!nodeId) return null;
  return listEditorMediaCandidates().find(
    (candidate) => candidate.origin === "canvas" && candidate.nodeId === String(nodeId),
  ) || null;
}

/**
 * 只有清单里真实存在的来源才会被解析成资产：选择器和模型都无法凭空指定文件路径。
 * 探测失败时，图片可以没有时长继续入库，音视频必须失败关闭。
 */
export async function resolveEditorMediaAsset(
  candidate: EditorMediaCandidate,
): Promise<VideoEditorAsset> {
  let facts = {
    duration: candidate.durationSec,
    width: candidate.width,
    height: candidate.height,
  };
  try {
    facts = await probeEditorMedia({
      type: candidate.type,
      sourceFile: candidate.sourceFile,
      sourceUrl: candidate.previewUrl,
      readArrayBuffer: desktopApi.file.readArrayBuffer,
      probeNative: desktopApi.file.probeMedia,
    });
  } catch {
    if (candidate.type !== "image" && !facts.duration) {
      throw new Error(t("errors.c7dba12ee4", { value0: candidate.name }));
    }
  }
  return {
    id: candidate.key,
    type: candidate.type,
    name: candidate.name,
    sourceFile: candidate.sourceFile,
    sourceUrl: candidate.previewUrl,
    duration: Number(facts.duration) || 0,
    width: Number(facts.width) || 0,
    height: Number(facts.height) || 0,
  };
}

/**
 * 摘要里的资产只剩 id、来源字段是空串时（原生快照先落盘、宿主没记下来源）按稳定 key
 * 回查真实文件。只查候选目录与 project.materials 这两份真实数据：节点重新生成后旧产物
 * 不在当前目录里，但文件仍然在素材库。查不到就返回 null，由调用方决定降级，
 * 绝不按名字或时间线去猜一个文件顶上。
 */
export function findEditorMediaSource(assetId: string): { sourceFile: string; sourceUrl: string } | null {
  if (!assetId) return null;
  const candidate = findEditorMediaCandidate(assetId);
  if (candidate?.sourceFile || candidate?.remoteUrl) {
    return { sourceFile: candidate.sourceFile, sourceUrl: candidate.previewUrl };
  }
  // key 契约是 canvas:<nodeId>:<outputId>，产物是素材库条目时 outputId 形如 material:<id>。
  const materialId = assetId.startsWith('material:')
    ? assetId.slice('material:'.length)
    : /:material:[\w-]+$/.exec(assetId)?.[0]?.slice(':material:'.length) || '';
  if (!materialId) return null;
  const material = ((store.project.materials || []) as Record<string, any>[])
    .find((item) => String(item.id) === materialId);
  if (!material) return null;
  const sourceFile = String(material.path || material.filePath || '');
  const remoteUrl = String(material.remoteUrl || material.previewUrl || '');
  if (!sourceFile && !remoteUrl) return null;
  return { sourceFile, sourceUrl: localMediaUrl(sourceFile, remoteUrl) };
}

/**
 * 工程媒体库的使用判定。资产 id 就是候选的稳定 key（画布加入剪辑与选择器都这么写），
 * 但本地上传的文件由宿主生成 id，只能按真实文件路径认出「已添加」，
 * 否则同一个文件会在选择器里出现两次可选项。
 */
export function editorMediaUsage(
  project: Record<string, any> | null | undefined,
) {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const asset of (project?.assets || []) as Record<string, any>[]) {
    if (asset?.id) ids.add(String(asset.id));
    const sourceFile = String(asset?.sourceFile || "");
    if (sourceFile) files.add(sourceFile);
  }
  return {
    has(candidate: EditorMediaCandidate) {
      return ids.has(candidate.key) || Boolean(candidate.sourceFile && files.has(candidate.sourceFile));
    },
    /** 时间线上真正引用着的资产 id：入边断开后只有没被引用的才允许回滚删除。 */
    referencedByClips() {
      const used = new Set<string>();
      for (const track of (project?.tracks || []) as Record<string, any>[]) {
        for (const clip of (track?.clips || []) as Record<string, any>[]) {
          const assetId = String(clip?.assetId || "");
          if (assetId) used.add(assetId);
        }
      }
      return used;
    },
    assetIds() {
      return ids;
    },
  };
}

