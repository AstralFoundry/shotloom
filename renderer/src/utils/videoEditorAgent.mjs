import {
  addEditorClip,
  addEditorTrack,
  editorClipDuration,
  findEditorClip,
  removeEditorClip,
  updateEditorClip,
  updateEditorTrack,
  videoEditorDuration,
} from './videoEditorProject.mjs';
import { videoEditorEffectKeys, videoEditorTransitionKeys } from './videoEditorEffects.mjs';

const clone = (value) => structuredClone(value);
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;
const minimum = 0.08;

export function videoEditorAgentSnapshot(project, playheadSec = 0, selectedClipId = '') {
  return {
    settings: project.settings,
    durationSec: videoEditorDuration(project),
    playheadSec,
    selectedClipId,
    assets: project.assets.map(({ id, name, type, duration, sourceFile }) =>
      ({ id, name, type, durationSec: duration || 0, sourceFile: sourceFile || '' })),
    tracks: project.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.type,
      locked: track.locked,
      hidden: track.hidden,
      muted: track.muted,
      clips: track.clips.map((clip) => ({
        id: clip.id,
        type: clip.type,
        assetId: clip.assetId || '',
        name: project.assets.find((asset) => asset.id === clip.assetId)?.name || clip.text || clip.type,
        startSec: clip.timelineStart,
        endSec: clip.timelineStart + editorClipDuration(clip),
        durationSec: editorClipDuration(clip),
        sourceInSec: clip.trimStart,
        sourceOutSec: clip.trimEnd,
        speed: clip.speed,
        volume: clip.volume,
        muted: clip.muted,
        text: clip.type === 'text' ? clip.text : undefined,
        style: clip.type === 'text' ? clip.style : undefined,
        transform: ['video', 'image', 'text'].includes(clip.type) ? clip.transform : undefined,
        effectKey: clip.type === 'effect' ? clip.effectKey : undefined,
        transitionKey: clip.type === 'transition' ? clip.transitionKey : undefined,
        fromClipId: clip.type === 'transition' ? clip.fromClipId : undefined,
        toClipId: clip.type === 'transition' ? clip.toClipId : undefined,
      })),
    })),
  };
}

export function videoEditorAgentDiagnostics(project) {
  const assets = new Set(project.assets.map((asset) => asset.id));
  const gaps = [];
  const overlaps = [];
  const missingAssets = [];
  for (const track of project.tracks) {
    let previousEnd = 0;
    for (const clip of [...track.clips].sort((a, b) => a.timelineStart - b.timelineStart)) {
      const start = clip.timelineStart;
      const end = start + editorClipDuration(clip);
      if (start > previousEnd + 0.001) gaps.push({ trackId: track.id, fromSec: previousEnd, toSec: start });
      if (start < previousEnd - 0.001) overlaps.push({ trackId: track.id, fromSec: start, toSec: Math.min(end, previousEnd) });
      if (clip.assetId && !assets.has(clip.assetId)) missingAssets.push({ trackId: track.id, clipId: clip.id, assetId: clip.assetId });
      previousEnd = Math.max(previousEnd, end);
    }
  }
  return { durationSec: videoEditorDuration(project), gaps, overlaps, missingAssets };
}

function requireClip(project, clipId) {
  const found = findEditorClip(project, clipId);
  if (!found) throw new Error(`片段不存在：${clipId}`);
  if (found.track.locked || found.clip.locked) throw new Error(`片段所在轨道已锁定：${clipId}`);
  return found;
}

function requireTime(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`${field} 必须是非负秒数`);
  }
  return value;
}

function requireCanvasSize(value, field) {
  const size = Number(value);
  if (!Number.isInteger(size) || size < 16 || size > 8192) {
    throw new Error(`${field} 必须是 16–8192 的整数像素`);
  }
  return size;
}

function clipPart(clip, start, end) {
  const part = { ...clip, id: id('clip'), timelineStart: start };
  if (clip.type === 'video' || clip.type === 'audio') {
    const speed = Number(clip.speed || 1);
    part.trimStart = Number(clip.trimStart) + (start - clip.timelineStart) * speed;
    part.trimEnd = Number(clip.trimStart) + (end - clip.timelineStart) * speed;
  } else {
    part.duration = end - start;
  }
  return part;
}

function applyOperation(project, operation) {
  const type = String(operation.type || '');
  if (type === 'split_clip') {
    const { track, clip } = requireClip(project, String(operation.clipId || ''));
    if (clip.type !== 'video' && clip.type !== 'audio') throw new Error('只能切分视频或音频片段');
    const atSec = requireTime(operation.atSec, 'atSec');
    const local = atSec - clip.timelineStart;
    if (local < minimum || local > editorClipDuration(clip) - minimum) throw new Error('切分位置需要位于片段内部');
    const sourceSec = Number(clip.trimStart) + local * Number(clip.speed || 1);
    let next = updateEditorClip(project, clip.id, { trimEnd: sourceSec });
    next = addEditorClip(next, track.id, { ...clip, id: id('clip'), timelineStart: atSec, trimStart: sourceSec });
    return next;
  }
  if (type === 'trim_clip') {
    const { clip } = requireClip(project, String(operation.clipId || ''));
    const oldEnd = clip.timelineStart + editorClipDuration(clip);
    const start = operation.newStartSec === undefined ? clip.timelineStart : requireTime(operation.newStartSec, 'newStartSec');
    const end = operation.newEndSec === undefined ? oldEnd : requireTime(operation.newEndSec, 'newEndSec');
    if (start < clip.timelineStart || end > oldEnd || end - start < minimum) throw new Error('修剪范围必须在原片段内，且至少保留 0.08 秒');
    if (clip.type === 'video' || clip.type === 'audio') {
      const speed = Number(clip.speed || 1);
      return updateEditorClip(project, clip.id, {
        timelineStart: start,
        trimStart: Number(clip.trimStart) + (start - clip.timelineStart) * speed,
        trimEnd: Number(clip.trimEnd) - (oldEnd - end) * speed,
      });
    }
    return updateEditorClip(project, clip.id, { timelineStart: start, duration: end - start });
  }
  if (type === 'move_clip') {
    const { clip, track } = requireClip(project, String(operation.clipId || ''));
    const toSec = requireTime(operation.toSec, 'toSec');
    const targetId = String(operation.trackId || track.id);
    const target = project.tracks.find((item) => item.id === targetId);
    if (!target || target.locked || target.type !== track.type) throw new Error('目标轨道不存在、已锁定或类型不兼容');
    if (target.id === track.id) return updateEditorClip(project, clip.id, { timelineStart: toSec });
    return addEditorClip(removeEditorClip(project, clip.id), target.id, { ...clip, timelineStart: toSec });
  }
  if (type === 'remove_clip') {
    const { clip, track } = requireClip(project, String(operation.clipId || ''));
    let next = removeEditorClip(project, clip.id);
    if (operation.ripple === true) {
      const end = clip.timelineStart + editorClipDuration(clip);
      const delta = editorClipDuration(clip);
      for (const later of track.clips.filter((item) => item.timelineStart >= end)) {
        next = updateEditorClip(next, later.id, { timelineStart: Math.max(0, later.timelineStart - delta) });
      }
    }
    return next;
  }
  if (type === 'remove_range') {
    const fromSec = requireTime(operation.fromSec, 'fromSec');
    const toSec = requireTime(operation.toSec, 'toSec');
    if (toSec - fromSec < minimum) throw new Error('删除区间至少需要 0.08 秒');
    const targetIds = operation.trackIds;
    if (targetIds !== undefined && (!Array.isArray(targetIds) || targetIds.some((item) => typeof item !== 'string'))) {
      throw new Error('trackIds 必须是轨道 ID 数组');
    }
    if (Array.isArray(targetIds) && targetIds.some((trackId) => !project.tracks.some((track) => track.id === trackId))) {
      throw new Error('删除区间包含不存在的轨道');
    }
    const next = clone(project);
    let changed = false;
    for (const track of next.tracks) {
      if (targetIds && !targetIds.includes(track.id)) continue;
      if (track.locked) {
        if (targetIds) throw new Error(`轨道已锁定：${track.id}`);
        continue;
      }
      const clips = [];
      for (const clip of track.clips) {
        const start = clip.timelineStart;
        const end = start + editorClipDuration(clip);
        if (end <= fromSec || start >= toSec) {
          if (operation.ripple !== false && start >= toSec) {
            clips.push({ ...clip, timelineStart: start - (toSec - fromSec) });
            changed = true;
          } else clips.push(clip);
          continue;
        }
        changed = true;
        if (start < fromSec && fromSec - start >= minimum) {
          clips.push(clipPart(clip, start, fromSec));
        }
        if (end > toSec && end - toSec >= minimum) {
          const part = clipPart(clip, toSec, end);
          if (operation.ripple !== false) part.timelineStart = fromSec;
          clips.push(part);
        }
      }
      track.clips = clips.sort((left, right) => left.timelineStart - right.timelineStart);
    }
    if (!changed) throw new Error('删除区间内没有片段或可移动内容');
    next.updatedAt = new Date().toISOString();
    return next;
  }
  if (type === 'close_gap') {
    const { clip, track } = requireClip(project, String(operation.clipId || ''));
    const earlierEnd = Math.max(0, ...track.clips.filter((item) => item.id !== clip.id && item.timelineStart < clip.timelineStart)
      .map((item) => item.timelineStart + editorClipDuration(item)));
    if (earlierEnd >= clip.timelineStart - 0.001) throw new Error('片段前没有空隙');
    return updateEditorClip(project, clip.id, { timelineStart: earlierEnd });
  }
  if (type === 'add_track') {
    const kind = String(operation.kind || '');
    if (!['video', 'audio', 'text'].includes(kind)) throw new Error('轨道类型必须是 video、audio 或 text');
    return addEditorTrack(project, kind, String(operation.name || kind));
  }
  if (type === 'duplicate_clip') {
    const { clip, track } = requireClip(project, String(operation.clipId || ''));
    return addEditorClip(project, track.id, {
      ...clip, id: id('clip'), timelineStart: clip.timelineStart + editorClipDuration(clip),
    });
  }
  if (type === 'add_clip') {
    const asset = project.assets.find((item) => item.id === operation.assetId);
    if (!asset) throw new Error(`素材不存在：${operation.assetId}`);
    const trackType = asset.type === 'image' ? 'overlay' : asset.type;
    let next = project;
    let track = operation.trackId
      ? next.tracks.find((item) => item.id === operation.trackId)
      : next.tracks.find((item) => item.type === trackType && !item.locked);
    if (operation.trackId && !track) throw new Error(`轨道不存在：${operation.trackId}`);
    if (!track) {
      next = addEditorTrack(next, trackType, trackType === 'overlay' ? '贴图' : trackType === 'audio' ? '音频' : '视频');
      track = next.tracks.at(-1);
    }
    if (!track || track.type !== trackType || track.locked) throw new Error('目标轨道不存在、已锁定或类型不兼容');
    const atSec = operation.atSec === undefined
      ? Math.max(0, ...track.clips.map((item) => item.timelineStart + editorClipDuration(item)))
      : requireTime(operation.atSec, 'atSec');
    if (asset.type === 'image') {
      return addEditorClip(next, track.id, {
        id: id('clip'), type: 'image', assetId: asset.id, src: asset.sourceUrl,
        timelineStart: atSec, duration: 4,
      });
    }
    if (!Number.isFinite(asset.duration) || asset.duration < minimum) throw new Error('素材缺少有效时长');
    return addEditorClip(next, track.id, {
      id: id('clip'), type: asset.type, assetId: asset.id, timelineStart: atSec,
      trimStart: 0, trimEnd: asset.duration, speed: 1, volume: 1, muted: false,
    });
  }
  if (type === 'set_speed') {
    const { clip } = requireClip(project, String(operation.clipId || ''));
    if (clip.type !== 'video' && clip.type !== 'audio') throw new Error('速度仅适用于视频或音频');
    const speed = Number(operation.speed);
    if (!Number.isFinite(speed) || speed < 0.5 || speed > 2) throw new Error('速度范围为 0.5–2 倍');
    return updateEditorClip(project, clip.id, { speed });
  }
  if (type === 'add_text') {
    const text = String(operation.text || '').trim();
    if (!text) throw new Error('文字内容不能为空');
    const atSec = requireTime(operation.atSec, 'atSec');
    const duration = operation.durationSec === undefined ? 3 : requireTime(operation.durationSec, 'durationSec');
    if (duration < minimum) throw new Error('文字片段至少持续 0.08 秒');
    let next = project;
    let track = operation.trackId
      ? next.tracks.find((item) => item.id === operation.trackId)
      : next.tracks.find((item) => item.type === 'text' && !item.locked);
    if (operation.trackId && !track) throw new Error(`轨道不存在：${operation.trackId}`);
    if (!track) {
      next = addEditorTrack(next, 'text', '文字');
      track = next.tracks.at(-1);
    }
    if (!track || track.type !== 'text' || track.locked) throw new Error('文字轨道不可用');
    return addEditorClip(next, track.id, { id: id('clip'), type: 'text', text, timelineStart: atSec, duration });
  }
  if (type === 'set_text') {
    const { clip } = requireClip(project, String(operation.clipId || ''));
    if (clip.type !== 'text') throw new Error('目标不是文字片段');
    const text = String(operation.text || '').trim();
    if (!text) throw new Error('文字内容不能为空');
    return updateEditorClip(project, clip.id, { text });
  }
  if (type === 'set_text_style') {
    const { clip } = requireClip(project, String(operation.clipId || ''));
    if (clip.type !== 'text') throw new Error('目标不是文字片段');
    const style = { ...(clip.style || {}) };
    if (operation.fontSize !== undefined) {
      const size = Number(operation.fontSize);
      if (!Number.isFinite(size) || size < 8 || size > 600) throw new Error('文字字号必须在 8–600 像素');
      style.fontSize = size;
    }
    if (operation.color !== undefined) {
      if (typeof operation.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(operation.color)) throw new Error('文字颜色必须是 #RRGGBB');
      style.color = operation.color;
    }
    if (operation.fontSize === undefined && operation.color === undefined) throw new Error('没有提供文字样式修改');
    return updateEditorClip(project, clip.id, { style });
  }
  if (type === 'set_transform') {
    const { clip } = requireClip(project, String(operation.clipId || ''));
    if (!['video', 'image', 'text'].includes(clip.type)) throw new Error('目标片段不支持画面位置调整');
    const transform = { ...(clip.transform || {}) };
    let changed = false;
    for (const key of ['x', 'y', 'width', 'height', 'opacity', 'angle']) {
      if (operation[key] === undefined) continue;
      const value = Number(operation[key]);
      if (!Number.isFinite(value)) throw new Error(`${key} 必须是有限数字`);
      if ((key === 'width' || key === 'height') && value <= 0) throw new Error(`${key} 必须大于 0`);
      if (key === 'opacity' && (value < 0 || value > 1)) throw new Error('opacity 必须在 0–1 之间');
      transform[key] = value;
      changed = true;
    }
    if (operation.fit !== undefined) {
      const fit = String(operation.fit);
      if (fit !== 'fit' && fit !== 'fill') throw new Error(`fit 必须是 fit 或 fill，收到：${fit}`);
      transform.fit = fit;
      changed = true;
    }
    if (!changed) throw new Error('没有提供画面位置修改');
    return updateEditorClip(project, clip.id, { transform });
  }
  if (type === 'add_effect' || type === 'add_transition') {
    const key = String(operation.key || '');
    const isEffect = type === 'add_effect';
    const label = isEffect ? '特效' : '转场';
    const available = isEffect ? videoEditorEffectKeys : videoEditorTransitionKeys;
    // 报错必须列出可用值：模型无法从 schema 之外猜测引擎实现，空 key 更是无从修正。
    if (!key) throw new Error(`${type} 必须提供 key，可用的${label}：${available.join('、')}`);
    if (!available.includes(key)) throw new Error(`不支持的${label}「${key}」，可用的${label}：${available.join('、')}`);
    const atSec = requireTime(operation.atSec, 'atSec');
    const duration = operation.durationSec === undefined ? (type === 'add_effect' ? 4 : .6) : requireTime(operation.durationSec, 'durationSec');
    if (duration < minimum) throw new Error('效果时长至少需要 0.08 秒');
    const trackType = type === 'add_effect' ? 'effect' : 'transition';
    let next = project;
    let track = operation.trackId
      ? next.tracks.find((item) => item.id === operation.trackId)
      : next.tracks.find((item) => item.type === trackType && !item.locked);
    if (operation.trackId && !track) throw new Error(`轨道不存在：${operation.trackId}`);
    if (!track) {
      next = addEditorTrack(next, trackType, type === 'add_effect' ? '全局特效' : '转场');
      track = next.tracks.at(-1);
    }
    if (!track || track.type !== trackType || track.locked) throw new Error('效果轨道不可用');
    if (type === 'add_effect') {
      return addEditorClip(next, track.id, { id: id('clip'), type: 'effect', timelineStart: atSec, duration, effectKey: key, values: {} });
    }
    const from = requireClip(next, String(operation.fromClipId || '')).clip;
    const to = requireClip(next, String(operation.toClipId || '')).clip;
    if (from.type !== 'video' || to.type !== 'video' || from.id === to.id) throw new Error('转场必须连接两段不同的视频');
    if (Math.abs(to.timelineStart - (from.timelineStart + editorClipDuration(from))) > .05) throw new Error('转场两端视频必须在时间线上相邻');
    if (atSec < Math.max(0, to.timelineStart - duration) || atSec > to.timelineStart) throw new Error('转场起点必须落在两段视频的接缝附近');
    return addEditorClip(next, track.id, {
      id: id('clip'), type: 'transition', timelineStart: atSec, duration,
      transitionKey: key, fromClipId: from.id, toClipId: to.id,
    });
  }
  if (type === 'set_clip') {
    const { clip } = requireClip(project, String(operation.clipId || ''));
    if (clip.type !== 'audio' && clip.type !== 'video') throw new Error('音量仅适用于视频或音频');
    const volume = Number(operation.volume);
    if (!Number.isFinite(volume) || volume < 0 || volume > 2) throw new Error('音量范围为 0–2');
    return updateEditorClip(project, clip.id, { volume });
  }
  if (type === 'set_canvas') {
    // 画布格式决定成片比例（抖音 9:16、横屏 16:9 等）。这里只改画布尺寸，不动任何片段：
    // 片段要不要铺满由各自的 transform.fit 决定，自动改动片段会让用户丢失原有构图。
    const width = requireCanvasSize(operation.width, 'width');
    const height = requireCanvasSize(operation.height, 'height');
    if (width === project.settings.width && height === project.settings.height) {
      throw new Error(`画布已经是 ${width}×${height}`);
    }
    return {
      ...project,
      settings: { ...project.settings, width, height },
      updatedAt: new Date().toISOString(),
    };
  }
  if (type === 'set_track') {
    const track = project.tracks.find((item) => item.id === operation.trackId);
    if (!track) throw new Error(`轨道不存在：${operation.trackId}`);
    const changes = {};
    for (const key of ['muted', 'hidden', 'locked']) {
      if (operation[key] !== undefined) {
        if (typeof operation[key] !== 'boolean') throw new Error(`${key} 必须是布尔值`);
        changes[key] = operation[key];
      }
    }
    if (operation.name !== undefined) {
      const name = String(operation.name).trim();
      if (!name) throw new Error('轨道名称不能为空');
      changes.name = name;
    }
    if (!Object.keys(changes).length) throw new Error('没有提供轨道修改内容');
    return updateEditorTrack(project, track.id, changes);
  }
  throw new Error(`暂不支持剪辑操作：${type}`);
}

// add_media 把“引入素材”和“放到时间线”合并成一个操作：工具层负责解析真实来源并探测媒体信息，
// 这里只做纯改写 —— 用解析出的资产把 add_media 换成等价的 add_clip。这样导入与排序在同一个
// 批次内原子生效，并直接沿用 add_clip 已有的轨道查找与“缺省追加到轨道末尾”行为。
export function mediaSourceKey(operation) {
  const materialId = String(operation?.materialId || '');
  if (materialId) return `material:${materialId}`;
  const nodeId = String(operation?.nodeId || '');
  if (nodeId) return `node:${nodeId}`;
  return '';
}

export function rewriteVideoEditorMediaOps(project, resolvedAssets, operations) {
  const resolved = new Map(
    (resolvedAssets || []).map((item) => [String(item?.sourceKey || ''), item?.asset]),
  );
  const assets = [...project.assets];
  const notices = [];
  const rewritten = operations.map((operation, index) => {
    if (String(operation?.type || '') !== 'add_media') return operation;
    const step = `第 ${index + 1} 步 add_media`;
    const key = mediaSourceKey(operation);
    if (!key) {
      throw new Error(`${step} 必须提供 materialId 或 nodeId，请先调用 video_project_media 获取真实 ID`);
    }
    const asset = resolved.get(key);
    if (!asset) {
      throw new Error(`${step} 引用了不存在或不可剪辑的来源：${key}，请重新调用 video_project_media`);
    }
    if (assets.some((item) => item.id === asset.id)) {
      notices.push(`${step} 的素材「${asset.name}」已在剪辑工程中，复用该素材追加片段`);
    } else {
      assets.push(asset);
    }
    const next = { type: 'add_clip', assetId: asset.id };
    if (operation.atSec !== undefined) next.atSec = operation.atSec;
    if (operation.trackId !== undefined) next.trackId = operation.trackId;
    return next;
  });
  return { project: { ...project, assets }, operations: rewritten, notices };
}

export function applyVideoEditorAgentBatch(project, operations) {
  if (!Array.isArray(operations) || !operations.length || operations.length > 50) {
    throw new Error('请提供 1–50 个剪辑操作');
  }
  let next = clone(project);
  const results = [];
  for (const [index, operation] of operations.entries()) {
    try {
      const changed = applyOperation(next, operation);
      if (changed === next) throw new Error('操作没有产生变化');
      next = changed;
      results.push({ index, type: operation.type, ok: true });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`第 ${index + 1} 步 ${String(operation?.type || '')} 失败：${reason}`);
    }
  }
  return { project: next, results };
}
