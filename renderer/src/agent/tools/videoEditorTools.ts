import { catalogLabel, t } from '@/i18n/index';
import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, JsonObject, JsonSchema } from '../core/types';
import { openReelAgentTools as openReelTools, supportsEditorTool } from '../core/openReelTools';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { videoEditorAgentDiagnostics } from '@/utils/videoEditorAgent.ts';
import {
  editorMediaUsage,
  findEditorMediaCandidate,
  listEditorMediaCandidates,
  resolveEditorMediaAsset,
} from '@/services/editorMediaCatalog.ts';
import { store } from '@/store/projectStore';
import { desktopApi } from '@/services/desktopApi';
import { editorClipDuration, findEditorClip, videoEditorDuration } from '@/utils/videoEditorProject.ts';

export { registerActiveVideoEditor } from '@/services/videoEditorSession';
import { videoEditorSession, type EditorSession } from '@/services/videoEditorSession';

function editorSessionFor(context: AgentToolContext) {
  const conversation = (store.project.harnessSessions || []).find(
    (item: { id?: string }) => String(item.id || '') === context.conversationId,
  ) as { editorNodeId?: string } | undefined;
  return videoEditorSession(context.projectKey, conversation?.editorNodeId || '');
}
function editorAvailable(context: AgentToolContext) { return Boolean(editorSessionFor(context)); }
function editorFor(context: AgentToolContext) {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const editor = editorSessionFor(context);
  if (!editor) throw new Error(t('tool.feedback.editor.closed'));
  return editor;
}

function nativeProjectSnapshot(editor: EditorSession) {
  const native = (editor.native() || {}) as Record<string, any>;
  const timeline = (native.timeline || {}) as Record<string, any>;
  const media = ((((native.mediaLibrary || {}) as Record<string, any>).items) || []) as Array<Record<string, any>>;
  return {
    nodeId: editor.nodeId,
    name: native.name,
    settings: native.settings,
    duration: Number(timeline.duration) || 0,
    media: media.map((item) => ({
      id: item.id,
      assetId: item.shotloomAssetId,
      name: item.name,
      type: item.type,
      metadata: item.metadata,
    })),
    tracks: timeline.tracks || [],
    textClips: native.textClips || [],
    shapeClips: native.shapeClips || [],
    svgClips: native.svgClips || [],
    stickerClips: native.stickerClips || [],
    playhead: editor.playhead(),
    selectedClipIds: [editor.selectedClipId()].filter(Boolean),
    canUndo: editor.canUndo(),
    canRedo: editor.canRedo(),
    hint: "以上 id 都是 OpenReel 原生 id。先调用 video_project_action_catalog 查看可用动作，再用 video_project_actions 提交。",
  };
}

// 候选清单、稳定 key 与真实元数据探测只有一份实现（services/editorMediaCatalog），
// 剪辑台资源选择器和 Agent 读到的必须是同一批来源，否则两侧会对同一节点给出不同素材。
function videoEditorMediaSources(editor: EditorSession) {
  const usage = editorMediaUsage(editor.read());
  return {
    assets: listEditorMediaCandidates().map((candidate) => ({
      id: candidate.key,
      name: candidate.name,
      type: candidate.type,
      duration: candidate.durationSec,
      hasLocalFile: candidate.hasLocalFile,
      alreadyAdded: usage.has(candidate),
      ...(candidate.origin === "canvas"
        ? { nodeId: candidate.nodeId, alias: candidate.alias, nodeType: candidate.nodeType }
        : {}),
    })),
    hint: 'video_project_import_media 用上面的 id 作为 assetId。alreadyAdded 为真表示该产物已经在剪辑工程媒体库里，不要重复导入。省略 atSec 时片段追加到目标轨道末尾，一次提交多段即按顺序首尾相接；缺少媒体信息的来源不会出现在这里。',
  };
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
  for (const tool of openReelTools) {
    // Upstream calls scene export read-only because it only returns JSON. Our
    // integration saves that artifact, which is a product filesystem write.
    const savesModelFile = tool.name === 'export_creation_scene_gltf';
    registerAgentTool({
      id: `openreel_${tool.name}`, title: catalogLabel(tool.title, `tool.openreel.${tool.name}`), description: tool.description
        + (['bake_creation_asset', 'export_creation_scene_gltf'].includes(tool.name) ? ' Shotloom only delivers supported generated geometry; model/text3d placeholder meshes are rejected.' : ''),
      inputSchema: tool.inputSchema as JsonSchema,
      ...(tool.name === 'bake_creation_asset' ? { resolveInputSchema: () => desktopApi.platform !== 'browser' && store.projectDir
        ? tool.inputSchema as JsonSchema
        : { ...tool.inputSchema, properties: { ...tool.inputSchema.properties, includeGltf: { type: 'boolean', enum: [false] } } } as JsonSchema } : {}),
      effect: tool.readOnly && !savesModelFile ? 'read' : 'project_write', activity: 'editor',
      ...(savesModelFile ? { resolveEffect: (input: JsonObject) => input.includeGltf === false ? 'read' as const : 'project_write' as const } : {}),
      approvalRequired: tool.destructive || tool.expensive,
      isAvailable: context => editorAvailable(context) && supportsEditorTool(`openreel_${tool.name}`, desktopApi.platform !== 'browser' && Boolean(store.projectDir)),
      timeoutMs: tool.expensive ? 0 : 120_000,
      execute: async (input, context) => {
        const editor = editorFor(context);
        const result = await editor.executeNativeTool(tool.name, input);
        editorFor(context); // Reject stale node/session ownership after async work.
        await editor.refreshState();
        const { image, ...receipt } = result;
        if (receipt.data && typeof receipt.data === 'object' && !Array.isArray(receipt.data)) {
          const data = { ...receipt.data } as Record<string, unknown>;
          // Upstream capability and inspection responses also recommend tools.
          // Keep these hints consistent with the actual model-facing catalog.
          for (const key of ['coreWorkflow', 'recoveryWorkflow', 'suggestedNextTools']) {
            if (Array.isArray(data[key])) data[key] = data[key].filter(name => typeof name === 'string'
              && openReelTools.some(tool => tool.name === name || `openreel_${tool.name}` === name)
              && supportsEditorTool(name.startsWith('openreel_') ? name : `openreel_${name}`, desktopApi.platform !== 'browser' && Boolean(store.projectDir)));
          }
          receipt.data = data;
        }
        return {
          ...receipt, success: result.ok, applied: result.ok && (!tool.readOnly || Boolean(result.outputs?.length)),
          ...(image ? { __toolAttachments: [{ type: 'file', mime: image.mimeType || 'image/png', filename: 'openreel-preview.png', url: image.dataUrl }] } : {}),
        };
      },
    });
  }
  registerAgentTool({
    id: 'video_project_media',
    icon: 'film',
    title: t('tool.title.video_project_media'),
    description: '列出可导入当前剪辑工程的项目素材与画布节点产物。返回的 id 可直接传给 video_project_import_media 的 assetId；alreadyAdded 表示该产物已在工程媒体库内。不修改任何内容。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => {
      const editor = editorFor(context);
      return videoEditorMediaSources(editor);
    },
  });

  registerAgentTool({
    id: 'video_project_get',
    icon: 'search',
    title: t('tool.title.video_project_get'),
    description: '读取当前 OpenReel 工程的真实设置、媒体、轨道、片段、文字/图形、播放头、选择与撤销状态。所有 id 都是 OpenReel 原生 id；修改前必须先用它定位目标。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => nativeProjectSnapshot(editorFor(context)),
  });

  registerAgentTool({
    id: 'video_project_action_catalog',
    icon: 'list-bullet',
    title: t('tool.title.video_project_action_catalog'),
    description: '返回当前 OpenReel 允许 Agent 调用的全部剪辑动作、中文说明和参数提示。先读目录，再用 video_project_actions 提交。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => {
      const catalog = editorFor(context).actionCatalog();
      return catalog || { error: t('tool.feedback.editor.catalogNotReady') };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_actions',
    icon: 'scissors',
    title: t('tool.title.video_project_actions'),
    description: '把 1–50 个 OpenReel 原生动作按顺序作为一次可撤销修改提交。先调用 video_project_get 获取真实 id，并调用 video_project_action_catalog 查看允许的动作与参数。validateOnly 只校验不写入。动作最终由 OpenReel 的 ActionExecutor 校验；失败时整批不提交。',
    effect: 'project_write',
    activity: 'editor',
    resolveEffect: (input) => input.validateOnly === true ? 'read' : 'project_write',
    isAvailable: editorAvailable,
    inputSchema: {
      type: 'object',
      required: ['description', 'actions'],
      properties: {
        description: { type: 'string' },
        validateOnly: { type: 'boolean' },
        actions: {
          type: 'array',
          minItems: 1,
          maxItems: 50,
          items: {
            type: 'object',
            required: ['type'],
            properties: {
              type: { type: 'string' },
              params: { type: 'object' },
            },
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.description || t('tool.feedback.editor.actions')),
    execute: async (input, context) => {
      const editor = editorFor(context);
      const catalog = editor.actionCatalog();
      if (!catalog) return { success: false, error: t('tool.feedback.editor.catalogNotReady') };
      const allowed = new Set(catalog.actions.map((action) => action.type));
      const denied = new Set(catalog.denylist);
      const actions = (input.actions as Array<{ type: string; params?: Record<string, unknown> }>) || [];
      for (const action of actions) {
        if (!action?.type || denied.has(action.type) || !allowed.has(action.type)) {
          return { success: false, error: t('tool.feedback.actionDenied', { type: action?.type || '' }) };
        }
      }
      const result = await editor.executeActions(actions, {
        validateOnly: input.validateOnly === true,
        description: String(input.description || t('tool.feedback.editor.actions')),
      });
      return {
        success: result.success,
        applied: result.success && input.validateOnly !== true,
        validated: true,
        appliedCount: input.validateOnly === true
          ? 0
          : result.results.filter((item) => item.success).length,
        results: result.results,
        error: result.error,
        summary: nativeProjectSnapshot(editor),
      };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_import_media',
    icon: 'upload',
    title: t('tool.title.video_project_import_media'),
    description: '把 video_project_media 返回的 assetId 导入当前剪辑工程，返回 OpenReel mediaId；随后用 video_project_actions 的 clip/add 把 mediaId 放到目标轨道。与剪辑台"添加媒体"走同一个解析与导入入口，不要凭文件名或路径猜来源。',
    effect: 'project_write',
    activity: 'editor',
    isAvailable: editorAvailable,
    inputSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: async (input, context) => {
      const editor = editorFor(context);
      const candidate = findEditorMediaCandidate(String(input.assetId || ''));
      if (!candidate) {
        return { success: false, error: t('tool.feedback.editor.missingAsset') };
      }
      const asset = await resolveEditorMediaAsset(candidate);
      const imported = await editor.importAsset(asset);
      if (!imported) return { success: false, error: t('tool.feedback.editor.noMediaId') };
      return {
        success: true,
        mediaId: imported.mediaId,
        assetId: asset.id,
        name: asset.name,
        hint: '把 mediaId 用作 clip/add 的 mediaId；目标 trackId 从 video_project_get 读取。',
      };
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_view',
    icon: 'image',
    title: t('tool.title.video_project_view'),
    description: '将播放头定位到指定项目时间（秒），便于用户预览和核验；不修改剪辑项目。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', required: ['timeSec'], properties: { timeSec: { type: 'number' } }, additionalProperties: false },
    execute: (input, context) => {
      const editor = editorFor(context);
      const time = Number(input.timeSec);
      const duration = Number((editor.native()?.timeline as Record<string, unknown> | undefined)?.duration)
        || videoEditorDuration(editor.read());
      if (!Number.isFinite(time) || time < 0 || time > duration) {
        return { success: false, error: t('tool.feedback.editor.playheadRange') };
      }
      editor.seek(time);
      return { success: true, playheadSec: time };
    },
  });

  registerAgentTool({
    id: 'video_project_diagnostics',
    icon: 'warning',
    title: t('tool.title.video_project_diagnostics'),
    description: '核验时间线上每条轨道的空隙、重叠和缺失素材。修改剪辑后调用，依据真实项目状态判断是否达到用户要求。',
    effect: 'read',
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: (_input, context) => videoEditorAgentDiagnostics(editorFor(context).read()),
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_frame',
    icon: 'camera',
    title: t('tool.title.video_project_frame'),
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
      if (!found || found.clip.type !== 'video') return { success: false, error: t('tool.feedback.editor.missingClip') };
      const { clip } = found;
      const timeSec = Number(input.timeSec);
      const end = clip.timelineStart + editorClipDuration(clip);
      if (!Number.isFinite(timeSec) || timeSec < clip.timelineStart || timeSec >= end) {
        return { success: false, error: t('tool.feedback.clipRange', { start: clip.timelineStart, end }) };
      }
      const asset = project.assets.find((item) => item.id === clip.assetId);
      if (!asset?.sourceFile) return { success: false, error: t('tool.feedback.editor.noSourceFile') };
      const sourceSec = Number(clip.trimStart || 0) + (timeSec - clip.timelineStart) * Number(clip.speed || 1);
      try {
        const frame = await desktopApi.file.captureVideoFrameToProject(asset.sourceFile, sourceSec, `agent-frame-${clip.id}.png`);
        const path = String(frame?.filePath || frame?.path || '');
        if (!path) throw new Error(t('tool.feedback.frame.noFile'));
        const bytes = await desktopApi.file.readImagePreview(path, 1280);
        if (!bytes?.byteLength) throw new Error(t('tool.feedback.frame.unreadable'));
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
    title: t('tool.title.video_project_export'),
    description: '仅在用户明确要求导出时调用。调用 OpenReel 渲染 MP4 并写入当前项目素材，同时在画布创建视频节点；只有返回真实 filePath 才可报告导出成功。',
    effect: 'project_write',
    activity: "editor",
    isAvailable: editorAvailable,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    // 导出会先等用户选保存路径，再等真实渲染完成，两者都不该被工具超时打断。
    timeoutMs: 0,
    execute: async (_input, context) => {
      const editor = editorFor(context);
      try {
        const result = await editor.exportProject(editor.read(), context.turnId) as {
          filePath?: string; path?: string; name?: string; duration?: number;
          deliveryId?: string; nodeId?: string; materialId?: string; revision?: string;
          replayed?: boolean; applied?: boolean;
        } | null;
        if (!result) return { success: false, applied: false, canceled: true, error: '用户取消保存，未导出视频' };
        const path = String(result.filePath || result.path || '');
        if (!path) return { success: false, applied: false, error: '导出未返回文件路径，不能确认成片已生成' };
        return {
          success: true, applied: result.applied ?? true, filePath: path, name: result.name || '', durationSec: result.duration,
          ...(result.deliveryId ? { deliveryId: result.deliveryId } : {}),
          ...(result.nodeId ? { nodeId: result.nodeId } : {}),
          ...(result.materialId ? { materialId: result.materialId } : {}),
          ...(result.revision ? { revision: result.revision } : {}),
          ...(result.replayed ? { replayed: true } : {}),
        };
      } catch (error) {
        return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });

  registerAgentTool<JsonObject>({
    id: 'video_project_history',
    icon: 'clock',
    title: t('tool.title.video_project_history'),
    description: '对当前剪辑项目执行一次撤销或重做。每个 video_project_actions 批次是一条历史记录。',
    effect: 'project_write',
    activity: "editor",
    isAvailable: editorAvailable,
    inputSchema: {
      type: 'object', required: ['action'],
      properties: { action: { type: 'string', enum: ['undo', 'redo'] } },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.action || ''),
    execute: async (input, context) => {
      const editor = editorFor(context);
      if (input.action === 'undo' && !editor.canUndo()) {
        return { success: false, applied: false, error: t('tool.feedback.editor.noUndo') };
      }
      if (input.action === 'redo' && !editor.canRedo()) {
        return { success: false, applied: false, error: t('tool.feedback.editor.noRedo') };
      }
      const applied = input.action === 'undo' ? editor.undo() : editor.redo();
      if (!applied) return { success: false, applied: false, error: t('tool.feedback.editor.historyFailed') };
      await editor.refreshState();
      return { success: true, applied: true, action: input.action, summary: nativeProjectSnapshot(editor) };
    },
  });
}
