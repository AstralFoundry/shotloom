import { runDirectorDeskCommand } from './directorDeskAgentRuntime';
import { findEditorMediaCandidate, listEditorMediaCandidates, resolveEditorMediaAsset } from './editorMediaCatalog';
import { prepareVideoEditor, WORKSPACE_VIDEO_EDITOR_ID } from './videoEditorSession';
import { assertAgentProject } from './agentProjectIdentity';
import type { AgentToolContext } from '../agent/core/types';

export interface EditingHandoff {
  videoArtifactId: string;
  handoffId: string;
  editorNodeId?: string;
  videoVolume?: number;
  audio?: Array<{ assetId: string; startSec: number; durationSec?: number; inPoint?: number; volume?: number }>;
  subtitles?: Array<{ text: string; startSec: number; endSec: number }>;
  export?: boolean;
}
const handoffs = new Map<string, Promise<unknown>>();
/** Serialize assembly within an editor so parallel retries observe the preceding transaction. */
export async function directorEditingHandoff(input: EditingHandoff, context: AgentToolContext) {
  const key = JSON.stringify([context.projectKey, context.projectInstanceId, context.projectGeneration, input.editorNodeId || WORKSPACE_VIDEO_EDITOR_ID]);
  const previous = handoffs.get(key);
  const task = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(() => assembleHandoff(input, context));
  handoffs.set(key, task);
  try { return await task; } finally { if (handoffs.get(key) === task) handoffs.delete(key); }
}
/** Explicit editorial intent becomes native actions; no filename, duration or prose heuristics. */
async function assembleHandoff(input: EditingHandoff, context: AgentToolContext) {
  const fence = () => { context.signal.throwIfAborted(); assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration); };
  fence();
  if (!input.handoffId.trim() || !input.videoArtifactId.trim()) throw Error('handoffId 与 videoArtifactId 不能为空');
  if (input.videoVolume !== undefined && (!Number.isFinite(input.videoVolume) || input.videoVolume < 0)) throw Error('视频音量无效');
  const audio = [];
  for (const item of input.audio ?? []) {
    const candidate = findEditorMediaCandidate(item.assetId);
    if (!candidate || candidate.type !== 'audio') return { success: false, applied: false, error: `音频素材不存在：${item.assetId}` };
    const asset = await resolveEditorMediaAsset(candidate); fence();
    if (!Number.isFinite(item.startSec) || item.startSec < 0 || (item.durationSec !== undefined && !(item.durationSec > 0)) || (item.inPoint !== undefined && !(item.inPoint >= 0)) || (item.volume !== undefined && (!Number.isFinite(item.volume) || item.volume < 0))) throw Error('音频时段或音量无效');
    const inPoint = item.inPoint ?? 0;
    const duration = item.durationSec ?? (asset.duration ?? 0) - inPoint;
    if (!Number.isFinite(duration) || duration <= 0 || inPoint + duration > (asset.duration ?? 0) + 1e-6) throw Error(`音频时段超出素材长度：${item.assetId}`);
    audio.push({ item, asset, inPoint, duration });
  }
  for (const s of input.subtitles ?? []) if (!s.text.trim() || !Number.isFinite(s.startSec) || !Number.isFinite(s.endSec) || s.startSec < 0 || s.endSec <= s.startSec) throw Error('字幕内容或时段无效');
  const artifact = await runDirectorDeskCommand('export_artifact_deliver', { artifactId: input.videoArtifactId, mode: 'ingest' }) as { ingestion: string; delivery?: Array<{ materialId?: string; nodeId?: string }>; error?: string };
  fence();
  if (artifact.ingestion !== 'completed') return { success: false, applied: false, artifactId: input.videoArtifactId, recoverable: true, phase: 'ingestion', error: artifact.error ?? '视频尚未入库，可重试入库或下载' };
  const materialId = artifact.delivery?.[0]?.materialId;
  const outputNodeId = artifact.delivery?.[0]?.nodeId;
  const candidate = (outputNodeId ? listEditorMediaCandidates().find(c => c.nodeId === outputNodeId && c.origin === 'canvas') : undefined) ?? (materialId ? findEditorMediaCandidate(`material:${materialId}`) : undefined);
  if (!candidate || candidate.type !== 'video') return { success: false, applied: false, phase: 'media-resolution', artifactId: input.videoArtifactId, error: '视频已入库但素材目录尚不可解析；稍后重试' };
  const video = await resolveEditorMediaAsset(candidate); fence();
  if (!Number.isFinite(video.duration) || !(video.duration! > 0)) return { success: false, applied: false, phase: 'media-resolution', error: '无法确认视频的真实时长，请检查素材后重试' };
  const editor = await prepareVideoEditor(input.editorNodeId || WORKSPACE_VIDEO_EDITOR_ID, context); fence();
  const intent = JSON.stringify({ videoArtifactId: input.videoArtifactId, videoVolume: input.videoVolume ?? 1, audio: input.audio ?? [], subtitles: input.subtitles ?? [] });
  const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(intent)))].map(n => n.toString(16).padStart(2, '0')).join('');
  fence();
  const signature = `director:${input.handoffId}:${digest}`;
  const prefix = `director-handoff:${input.handoffId}`;
  const trackId = `${prefix}:video`;
  const native = editor.native() as { timeline?: { tracks?: Array<{ id: string; clips?: Array<{ sourceConnectionId?: string }> }> } } | null;
  const existing = native?.timeline?.tracks?.find(t => t.id === trackId);
  if (existing && !existing.clips?.some(c => c.sourceConnectionId === signature)) return { success: false, applied: false, error: 'handoffId 已用于不同的剪辑内容；请用新 handoffId 或编辑现有时间线' };
  const replayed = Boolean(existing);
  const importedIds: string[] = [];
  if (!replayed) {
    const actions: Array<{ type: string; params: Record<string, unknown> }> = [];
    const imported = await editor.importAsset(video); fence();
    if (!imported) return { success: false, applied: false, phase: 'import', error: '视频导入未返回 mediaId' };
    importedIds.push(imported.mediaId);
    actions.push({ type: 'track/add', params: { trackId, trackType: 'video', name: video.name } }, { type: 'clip/add', params: { trackId, mediaId: imported.mediaId, startTime: 0, duration: video.duration, sourceConnectionId: signature, volume: input.videoVolume ?? 1 } });
    for (const [index, { item, asset, inPoint, duration }] of audio.entries()) {
      const media = await editor.importAsset(asset); fence();
      if (!media) return { success: false, applied: importedIds.length > 0, phase: 'import', importedMediaIds: importedIds, error: `音频导入失败：${item.assetId}` };
      importedIds.push(media.mediaId);
      const audioTrack = `${prefix}:audio:${index}`;
      actions.push({ type: 'track/add', params: { trackId: audioTrack, trackType: 'audio', name: asset.name } }, { type: 'clip/add', params: { trackId: audioTrack, mediaId: media.mediaId, startTime: item.startSec, inPoint, outPoint: inPoint + duration, duration, volume: item.volume ?? 1 } });
    }
    for (const s of input.subtitles ?? []) actions.push({ type: 'subtitle/add', params: { text: s.text, startTime: s.startSec, endTime: s.endSec } });
    const result = await editor.executeActions(actions, { description: 'Director previsualization, audio and subtitles' }); fence();
    if (!result.success) return { success: false, applied: importedIds.length > 0, timelineApplied: false, importedMediaIds: importedIds, error: result.error, phase: 'assembly' };
  }
  if (input.export) {
    let delivery: { filePath?: string; path?: string } | null;
    try { delivery = await editor.exportProject(editor.read(), `${context.turnId}:${input.handoffId}`) as typeof delivery; }
    catch (error) { fence(); return { success: false, applied: true, timelineApplied: true, recoverable: true, phase: 'export', error: String(error) }; }
    fence();
    if (!delivery || !(delivery.filePath || delivery.path)) return { success: false, applied: true, timelineApplied: true, recoverable: true, replayed, phase: 'export', error: '剪辑已完成，导出未返回真实文件；可沿用 handoffId 重试导出' };
    return { success: true, applied: true, replayed, editorNodeId: editor.nodeId, delivery };
  }
  return { success: true, applied: !replayed, replayed, editorNodeId: editor.nodeId, importedMediaIds: importedIds, trackId };
}
