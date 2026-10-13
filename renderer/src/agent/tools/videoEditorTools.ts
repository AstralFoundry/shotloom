import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, JsonObject } from '../core/types';
import { convertFileSrc } from '@tauri-apps/api/core';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { agentNodeAliasMaps } from '@/services/agentCanvasSnapshot';
import {
  applyVideoEditorAgentBatch,
  rewriteVideoEditorMediaOps,
  videoEditorAgentDiagnostics,
  videoEditorAgentSnapshot,
} from '@/utils/videoEditorAgent.mjs';
import { inferEditorMediaType, probeEditorMedia } from '@/utils/editorMediaImport.mjs';
import { videoEditorEffectKeys, videoEditorTransitionKeys } from '@/utils/videoEditorEffects.mjs';
import type { VideoEditorAssetType, VideoEditorProject } from '@/app/editor/videoEditorTypes';
import { store } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { editorClipDuration, findEditorClip } from '@/utils/videoEditorProject.mjs';

interface EditorSession {
  projectKey: string;
  nodeId: string;
  read: () => VideoEditorProject;
  commit: (project: VideoEditorProject) => void;
  playhead: () => number;
  selectedClipId: () => string;
  seek: (time: number) => void;
  undo: () => boolean;
  redo: () => boolean;
  canUndo: () => boolean;
  canRedo: () => boolean;
  exportProject: (project: VideoEditorProject) => Promise<unknown>;
}

let activeEditor: EditorSession | null = null;

function editorAvailable(context: AgentToolContext) {
  const conversation = (store.project.copilotConversations || []).find(
    (item: { id?: string }) => String(item.id || '') === context.conversationId,
  ) as { editorNodeId?: string } | undefined;
  return Boolean(activeEditor && activeEditor.projectKey === context.projectKey
    && conversation?.editorNodeId === activeEditor.nodeId);
}

export function registerActiveVideoEditor(session: EditorSession) {
  activeEditor = session;
  return () => {
    if (activeEditor === session) activeEditor = null;
  };
}

function editorFor(context: AgentToolContext) {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  if (!editorAvailable(context) || !activeEditor) {
    throw new Error('剪辑工作区已关闭或项目已切换，请重新打开剪辑工作区');
  }
  return activeEditor;
}

function revision(project: VideoEditorProject) {
  return JSON.stringify(project);
}

type EditorMediaCandidate = {
  key: string;
  name: string;
  sourceFile: string;
  remoteUrl: string;
  hintedType: string;
  duration: number;
  width: number;
  height: number;
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

function mediaTypeOf(candidate: EditorMediaCandidate): VideoEditorAssetType {
  const hinted = candidate.hintedType.toLowerCase();
  if (hinted.includes("image")) return "image";
  if (hinted.includes("audio")) return "audio";
  if (hinted.includes("video")) return "video";
  return inferEditorMediaType(candidate.sourceFile || candidate.remoteUrl) as VideoEditorAssetType;
}

function candidateOf(source: Record<string, any>, name: string): EditorMediaCandidate | null {
  const sourceFile = String(source?.filePath || source?.path || "");
  const remoteUrl = String(source?.url || source?.remoteUrl || source?.previewUrl || "");
  if (!sourceFile && !remoteUrl) return null;
  const metadata = source?.metadata || {};
  const candidate: EditorMediaCandidate = {
    key: "",
    name: String(source?.title || source?.name || name || "素材"),
    sourceFile,
    remoteUrl,
    hintedType: String(source?.resourceType || source?.mimeType || source?.type || ""),
    duration: Number(source?.duration || metadata.duration || 0),
    width: Number(source?.width || metadata.width || 0),
    height: Number(source?.height || metadata.height || 0),
  };
  return ["video", "image", "audio"].includes(mediaTypeOf(candidate)) ? candidate : null;
}

// 与画布“加入剪辑”保持同一套产物选择顺序，避免两侧对同一节点得出不同素材。
function canvasNodeOutput(node: Record<string, any>) {
  const outputs = [
    ...(Array.isArray(node.generatedOutputs) ? node.generatedOutputs : []),
    ...((store.project.materials || []) as Record<string, any>[])
      .filter((item) => item.nodeId === node.id)
      .map((item) => ({ ...item, id: `material:${item.id}` })),
    ...((store.project.nodes || []) as Record<string, any>[]).filter(
      (item) => item.type === "resource" && !item.archived && item.generatedFrom?.nodeId === node.id,
    ),
  ];
  const selectedId = String(node.selectedOutputNodeId || "");
  return outputs.find((item) => String(item.id) === selectedId)
    || outputs.find((item) => item.selected)
    || outputs.at(-1)
    || node.uploadedFile
    || null;
}

function mediaCandidates() {
  const materials: EditorMediaCandidate[] = [];
  for (const material of (store.project.materials || []) as Record<string, any>[]) {
    const candidate = candidateOf(material, "项目素材");
    if (candidate) materials.push({ ...candidate, key: `material:${material.id}` });
  }
  const aliasById = agentNodeAliasMaps((store.project.nodes || []) as never[]).aliasById;
  const canvasNodes: Array<EditorMediaCandidate & { nodeId: string; alias: string; nodeType: string }> = [];
  for (const node of (store.project.nodes || []) as Record<string, any>[]) {
    if (node.archived) continue;
    const output = canvasNodeOutput(node);
    const candidate = candidateOf(output || {}, node.title || "画布产物");
    if (!candidate) continue;
    canvasNodes.push({
      ...candidate,
      key: `node:${node.id}`,
      nodeId: String(node.id),
      alias: String(aliasById[node.id] || ""),
      nodeType: String(node.type || ""),
    });
  }
  return { materials, canvasNodes };
}

export function videoEditorMediaSources() {
  const { materials, canvasNodes } = mediaCandidates();
  const toEntry = (candidate: EditorMediaCandidate) => ({
    id: candidate.key,
    name: candidate.name,
    type: mediaTypeOf(candidate),
    hasLocalFile: Boolean(candidate.sourceFile),
  });
  return {
    materials: materials.map(toEntry),
    canvasNodes: canvasNodes.map((candidate) => ({
      ...toEntry(candidate),
      nodeId: candidate.nodeId,
      alias: candidate.alias,
      nodeType: candidate.nodeType,
    })),
    hint: "add_media 接受上面的 id 作为 materialId 或 nodeId。省略 atSec 时片段追加到目标轨道末尾，一次提交多段即按顺序首尾相接；缺少媒体信息的来源不会出现在这里。",
  };
}

// 只有工具返回过的真实来源才会被解析成资产：模型无法凭空指定文件路径。
async function resolveMediaOperations(operations: JsonObject[]) {
  const { materials, canvasNodes } = mediaCandidates();
  const pool = [...materials, ...canvasNodes];
  const wanted = new Map<string, EditorMediaCandidate>();
  for (const operation of operations) {
    if (String(operation?.type || "") !== "add_media") continue;
    const materialId = String(operation.materialId || "");
    const nodeId = String(operation.nodeId || "");
    const key = materialId ? `material:${materialId}` : nodeId ? `node:${nodeId}` : "";
    const found = key ? pool.find((candidate) => candidate.key === key) : undefined;
    if (found) wanted.set(key, found);
  }
  const resolved: Array<{ sourceKey: string; asset: unknown }> = [];
  for (const [key, candidate] of wanted) {
    const type = mediaTypeOf(candidate);
    const sourceUrl = localMediaUrl(candidate.sourceFile, candidate.remoteUrl);
    let facts = { duration: candidate.duration, width: candidate.width, height: candidate.height };
    try {
      facts = await probeEditorMedia({
        type,
        sourceFile: candidate.sourceFile,
        sourceUrl,
        readArrayBuffer: desktopApi.file.readArrayBuffer,
        probeNative: desktopApi.file.probeMedia,
      });
    } catch {
      if (type !== "image" && !facts.duration) {
        throw new Error(`无法读取素材「${candidate.name}」的媒体信息，不能加入剪辑`);
      }
    }
    resolved.push({
      sourceKey: key,
      asset: {
        id: `agent:${key}`,
        type,
        name: candidate.name,
        sourceFile: candidate.sourceFile,
        sourceUrl,
        duration: Number(facts.duration) || 0,
        width: Number(facts.width) || 0,
        height: Number(facts.height) || 0,
      },
    });
  }
  return resolved;
}

function imageDataUrl(bytes: ArrayBuffer) {
  const data = new Uint8Array(bytes);
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export function registerVideoEditorTools() {
  registerAgentTool({
    id: 'video_project_media',
    icon: 'film',
    title: '列出可导入剪辑的媒体',
    description: '列出可导入当前剪辑工程的项目素材与画布节点产物。返回的 id 可直接作为 video_project_edit 的 add_media 的 materialId 或 nodeId；不修改任何内容。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => {
      editorFor(context);
      return videoEditorMediaSources();
    },
  });

  registerAgentTool({
    id: 'video_project_get',
    icon: 'search',
    title: '读取剪辑项目',
    description: '读取当前剪辑工作区的真实媒体、轨道、片段时间、播放头和选择状态。剪辑前及修改后使用；返回的 ID 可用于 video_project_edit。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => {
      const editor = editorFor(context);
      const project = editor.read();
      context.state.set('videoProjectRevision', revision(project));
      return { nodeId: editor.nodeId, ...videoEditorAgentSnapshot(project, editor.playhead(), editor.selectedClipId()) };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_edit',
    icon: 'scissors',
    title: '修改剪辑时间线',
    description: '将 1–50 个操作按顺序作为一次可撤销修改提交。先调用 video_project_get 获取真实 ID。支持 split_clip、trim_clip、move_clip、remove_clip、remove_range、close_gap、duplicate_clip、add_clip、add_media、add_track、add_text、set_text、set_text_style、set_transform、set_clip、set_speed、set_track、set_canvas、add_effect、add_transition。add_media 用 video_project_media 返回的 materialId/nodeId 把画布产物或项目素材导入工程；add_clip 与 add_media 省略 atSec 时追加到目标轨道末尾，因此一次提交多段即按顺序首尾相接。set_canvas 只改画布尺寸（如抖音竖屏 1080×1920），不会改动已有片段；要让某个片段铺满画面，再用 set_transform 把它的框设为画布尺寸并设 fit:"fill"（居中裁剪填满），fit:"fit" 或省略则留边。时间单位是秒。validateOnly 可预检整个批次；失败则整个批次不写入。',
    effect: 'project_write',
    resolveEffect: (input) => input.validateOnly === true ? 'read' : 'project_write',
    isAvailable: editorAvailable,
    inputSchema: {
      type: 'object',
      required: ['description', 'operations'],
      properties: {
        description: { type: 'string' },
        validateOnly: { type: 'boolean' },
        operations: { type: 'array', minItems: 1, maxItems: 50, items: {
          type: 'object',
          required: ['type'],
          properties: {
            type: { type: 'string', enum: ['split_clip', 'trim_clip', 'move_clip', 'remove_clip', 'remove_range', 'close_gap', 'duplicate_clip', 'add_clip', 'add_media', 'add_track', 'add_text', 'set_text', 'set_text_style', 'set_transform', 'set_clip', 'set_speed', 'set_track', 'set_canvas', 'add_effect', 'add_transition'] },
            clipId: { type: 'string' }, trackId: { type: 'string' }, assetId: { type: 'string' },
            materialId: { type: 'string' }, nodeId: { type: 'string' },
            atSec: { type: 'number' }, toSec: { type: 'number' },
            fromSec: { type: 'number' }, trackIds: { type: 'array', items: { type: 'string' } }, kind: { type: 'string' },
            newStartSec: { type: 'number' }, newEndSec: { type: 'number' },
            durationSec: { type: 'number' }, volume: { type: 'number' }, speed: { type: 'number' },
            text: { type: 'string' }, name: { type: 'string' }, key: { type: 'string', enum: [...videoEditorTransitionKeys, ...videoEditorEffectKeys] },
            fit: { type: 'string', enum: ['fit', 'fill'] },
            fromClipId: { type: 'string' }, toClipId: { type: 'string' },
            fontSize: { type: 'number' }, color: { type: 'string' },
            x: { type: 'number' }, y: { type: 'number' }, width: { type: 'number' }, height: { type: 'number' },
            opacity: { type: 'number' }, angle: { type: 'number' },
            ripple: { type: 'boolean' }, muted: { type: 'boolean' },
            hidden: { type: 'boolean' }, locked: { type: 'boolean' },
          },
          additionalProperties: false,
        } },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.description || '修改剪辑'),
    execute: async (input, context) => {
      const editor = editorFor(context);
      const source = editor.read();
      const expected = String(context.state.get('videoProjectRevision') || '');
      if (!expected) return { success: false, error: '请先调用 video_project_get 读取当前剪辑项目' };
      if (expected !== revision(source)) {
        return { success: false, error: '剪辑项目在读取后被修改；请重新调用 video_project_get，再提交操作' };
      }
      try {
        const operations = input.operations as JsonObject[];
        const resolved = await resolveMediaOperations(operations);
        const rewritten = rewriteVideoEditorMediaOps(source, resolved, operations);
        const result = applyVideoEditorAgentBatch(rewritten.project, rewritten.operations);
        if (input.validateOnly !== true) {
          editor.commit(result.project);
          context.state.set('videoProjectRevision', revision(result.project));
        }
        return {
          success: true,
          applied: input.validateOnly !== true,
          appliedCount: input.validateOnly === true ? 0 : result.results.length,
          validated: true,
          description: String(input.description || '剪辑修改'),
          results: result.results,
          notices: rewritten.notices,
          summary: videoEditorAgentSnapshot(result.project, editor.playhead(), editor.selectedClipId()),
        };
      } catch (error) {
        return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_view',
    icon: 'image',
    title: '定位剪辑播放头',
    description: '将播放头定位到指定项目时间（秒），便于用户预览和核验；不修改剪辑项目。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', required: ['timeSec'], properties: { timeSec: { type: 'number' } }, additionalProperties: false },
    execute: (input, context) => {
      const editor = editorFor(context);
      const time = Number(input.timeSec);
      if (!Number.isFinite(time) || time < 0 || time > videoEditorAgentSnapshot(editor.read()).durationSec) {
        return { success: false, error: '播放头时间超出剪辑范围' };
      }
      editor.seek(time);
      return { success: true, playheadSec: time };
    },
  });

  registerAgentTool({
    id: 'video_project_diagnostics',
    icon: 'warning',
    title: '检查剪辑时间线',
    description: '核验时间线上每条轨道的空隙、重叠和缺失素材。修改剪辑后调用，依据真实项目状态判断是否达到用户要求。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => videoEditorAgentDiagnostics(editorFor(context).read()),
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_frame',
    icon: 'camera',
    title: '查看剪辑素材帧',
    description: '按真实片段 ID 和该片段内的项目时间读取源视频帧，作为画面内容与剪点判断的证据。返回图片附件；只代表源素材，不包含文字、特效、叠层或转场的合成结果。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: {
      type: 'object', required: ['clipId', 'timeSec'],
      properties: { clipId: { type: 'string' }, timeSec: { type: 'number' } },
      additionalProperties: false,
    },
    summarizeInput: (input) => `${input.clipId} @ ${input.timeSec}s`,
    execute: async (input, context) => {
      const project = editorFor(context).read();
      const found = findEditorClip(project, String(input.clipId || ''));
      if (!found || found.clip.type !== 'video') return { success: false, error: '视频片段不存在，请重新读取项目' };
      const { clip } = found;
      const timeSec = Number(input.timeSec);
      const end = clip.timelineStart + editorClipDuration(clip);
      if (!Number.isFinite(timeSec) || timeSec < clip.timelineStart || timeSec >= end) {
        return { success: false, error: `时间必须在此片段的 ${clip.timelineStart}–${end} 秒范围内` };
      }
      const asset = project.assets.find((item) => item.id === clip.assetId);
      if (!asset?.sourceFile) return { success: false, error: '源视频没有可读取的本地文件' };
      const sourceSec = Number(clip.trimStart || 0) + (timeSec - clip.timelineStart) * Number(clip.speed || 1);
      try {
        const frame = await desktopApi.file.captureVideoFrameToProject(asset.sourceFile, sourceSec, `agent-frame-${clip.id}.png`);
        const path = String(frame?.filePath || frame?.path || '');
        if (!path) throw new Error('截帧没有返回文件');
        const bytes = await desktopApi.file.readImagePreview(path, 1280);
        if (!bytes?.byteLength) throw new Error('截帧文件无法读取');
        return {
          success: true, clipId: clip.id, projectTimeSec: timeSec, sourceTimeSec: sourceSec,
          evidence: '源视频帧；不含时间线合成效果',
          __toolAttachments: [{ type: 'file', mime: 'image/jpeg', filename: 'frame.jpg', url: imageDataUrl(bytes) }],
        };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool({
    id: 'video_project_export',
    icon: 'download',
    title: '导出剪辑成片',
    description: '仅在用户明确要求导出时调用。打开 MP4 保存对话框并等待真实导出完成；用户取消时返回未导出。',
    effect: 'project_write',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: async (_input, context) => {
      const editor = editorFor(context);
      try {
        const result = await editor.exportProject(editor.read()) as { filePath?: string; path?: string; name?: string; duration?: number } | null;
        if (!result) return { success: false, applied: false, canceled: true, error: '用户取消保存，未导出视频' };
        const path = String(result.filePath || result.path || '');
        if (!path) return { success: false, applied: false, error: '导出未返回文件路径，不能确认成片已生成' };
        return { success: true, applied: true, filePath: path, name: result.name || '', durationSec: result.duration };
      } catch (error) {
        return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_history',
    icon: 'clock',
    title: '剪辑撤销与重做',
    description: '对当前剪辑项目执行一次撤销或重做。每个 video_project_edit 批次是一条历史记录。',
    effect: 'project_write',
    isAvailable: editorAvailable,
    inputSchema: {
      type: 'object', required: ['action'],
      properties: { action: { type: 'string', enum: ['undo', 'redo'] } },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.action || ''),
    execute: (input, context) => {
      const editor = editorFor(context);
      const applied = input.action === 'undo' ? editor.undo() : editor.redo();
      if (!applied) return { success: false, applied: false, error: input.action === 'undo' ? '当前没有可撤销的剪辑操作' : '当前没有可重做的剪辑操作' };
      context.state.set('videoProjectRevision', revision(editor.read()));
      return { success: true, applied: true, action: input.action, summary: videoEditorAgentSnapshot(editor.read(), editor.playhead(), editor.selectedClipId()) };
    },
  });
}
