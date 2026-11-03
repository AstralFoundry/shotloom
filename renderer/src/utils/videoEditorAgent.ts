// 剪辑 Agent 的时间线诊断：只读 Shotloom 摘要，不产生修改。
import { editorClipDuration, videoEditorDuration } from './videoEditorProject.ts';

type AnyRecord = Record<string, any>;

export function videoEditorAgentDiagnostics(project: AnyRecord) {
  const assets = new Set<string>(project.assets.map((asset: AnyRecord) => asset.id));
  const gaps: AnyRecord[] = [];
  const overlaps: AnyRecord[] = [];
  const missingAssets: AnyRecord[] = [];
  const invalidTransitions: AnyRecord[] = [];
  const clipById = new Map<string, AnyRecord>();
  for (const track of project.tracks) {
    for (const clip of track.clips) clipById.set(String(clip.id), clip);
  }
  for (const track of project.tracks) {
    // 只有主视频/音频轨需要连续。转场、文字、特效、贴图轨允许有间隙，
    // 把它们报成 gap 会诱导 Agent 去 close_gap，反而把转场和片段挪坏。
    if (!['video', 'audio'].includes(String(track.type))) continue;
    let previousEnd = 0;
    for (const clip of [...track.clips].sort((a: AnyRecord, b: AnyRecord) => a.timelineStart - b.timelineStart)) {
      const start = clip.timelineStart;
      const end = start + editorClipDuration(clip);
      if (start > previousEnd + 0.001) gaps.push({ trackId: track.id, fromSec: previousEnd, toSec: start });
      if (start < previousEnd - 0.001) overlaps.push({ trackId: track.id, fromSec: start, toSec: Math.min(end, previousEnd) });
      if (clip.assetId && !assets.has(clip.assetId)) missingAssets.push({ trackId: track.id, clipId: clip.id, assetId: clip.assetId });
      previousEnd = Math.max(previousEnd, end);
    }
  }
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.type !== 'transition') continue;
      const from = clipById.get(String(clip.fromClipId || ''));
      const to = clipById.get(String(clip.toClipId || ''));
      if (!from || !to) {
        invalidTransitions.push({ trackId: track.id, clipId: clip.id, fromClipId: clip.fromClipId || '', toClipId: clip.toClipId || '', reason: '转场引用的片段不存在' });
        continue;
      }
      const fromEnd = from.timelineStart + editorClipDuration(from);
      if (Math.abs(to.timelineStart - fromEnd) > 0.05) {
        invalidTransitions.push({ trackId: track.id, clipId: clip.id, fromClipId: from.id, toClipId: to.id, reason: '转场两端片段不相邻' });
        continue;
      }
      const transitionCenter = clip.timelineStart + editorClipDuration(clip) / 2;
      if (Math.abs(transitionCenter - to.timelineStart) > 0.05) {
        invalidTransitions.push({
          trackId: track.id,
          clipId: clip.id,
          fromClipId: from.id,
          toClipId: to.id,
          reason: '转场未以接缝为中心',
          expectedStartSec: Math.max(0, to.timelineStart - editorClipDuration(clip) / 2),
        });
      }
    }
  }
  return { durationSec: videoEditorDuration(project), gaps, overlaps, missingAssets, invalidTransitions };
}
