export const MIN_DURATION = 0.08;
const TRACK_TYPES = new Set(['video', 'audio', 'text', 'overlay', 'effect', 'transition']);
const CLIP_TYPES = new Set(['video', 'audio', 'text', 'image', 'effect', 'transition']);

const number = (value, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value, min, max) => Math.min(max, Math.max(min, number(value, min)));
const idFactory = (prefix = 'item') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const copy = (value) => JSON.parse(JSON.stringify(value));

export function createVideoEditorProject({
  sourceFile = '',
  sourceUrl = '',
  sourceName = 'video.mp4',
  duration = 0,
  width = 1920,
  height = 1080,
  fps = 30,
  createId = idFactory,
} = {}) {
  const assetId = createId('asset');
  const videoTrackId = createId('track-video');
  const audioTrackId = createId('track-audio');
  const clipId = createId('clip');
  const safeDuration = Math.max(0, number(duration));
  return {
    schema: 'shotloom.video-edit',
    version: 2,
    settings: {
      width: Math.max(16, Math.round(number(width, 1920))),
      height: Math.max(16, Math.round(number(height, 1080))),
      fps: clamp(fps, 1, 120),
      backgroundColor: '#050608',
    },
    assets: sourceFile || sourceUrl ? [
      {
        id: assetId,
        type: 'video',
        name: sourceName,
        sourceFile,
        sourceUrl,
        duration: safeDuration,
        width: number(width, 1920),
        height: number(height, 1080),
      },
    ] : [],
    tracks: [
      {
        id: videoTrackId,
        type: 'video',
        name: '主画面',
        locked: false,
        hidden: false,
        muted: false,
        clips:
          safeDuration > 0
            ? [
                {
                  id: clipId,
                  type: 'video',
                  assetId,
                  timelineStart: 0,
                  trimStart: 0,
                  trimEnd: safeDuration,
                  speed: 1,
                  muted: false,
                  transform: defaultTransform(width, height, 10),
                  effects: [],
                },
              ]
            : [],
      },
      {
        id: audioTrackId,
        type: 'audio',
        name: '音乐与音效',
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeVideoEditorProject(project, options = {}) {
  if (project?.version !== 2 || project?.schema !== 'shotloom.video-edit')
    return migrateLegacyProject(project, options);
  const base = createVideoEditorProject({ ...options, duration: 0 });
  const assets = Array.isArray(project.assets)
    ? project.assets.map(normalizeAsset).filter(Boolean)
    : base.assets;
  const tracks = Array.isArray(project.tracks)
    ? project.tracks.map((track, index) => normalizeTrack(track, index, assets)).filter(Boolean)
    : [];
  if (!tracks.some((track) => track.type === 'video'))
    tracks.unshift({
      id: idFactory('track-video'),
      type: 'video',
      name: '主画面',
      locked: false,
      hidden: false,
      muted: false,
      clips: [],
    });
  return {
    schema: base.schema,
    version: 2,
    settings: {
      ...base.settings,
      ...(project.settings || {}),
      width: clamp(Math.round(number(project.settings?.width, base.settings.width)), 16, 8192),
      height: clamp(Math.round(number(project.settings?.height, base.settings.height)), 16, 8192),
      fps: clamp(project.settings?.fps, 1, 120),
    },
    assets,
    tracks,
    updatedAt: String(project.updatedAt || new Date().toISOString()),
    ...(project.lastExport ? { lastExport: copy(project.lastExport) } : {}),
  };
}

function migrateLegacyProject(project, options) {
  const base = createVideoEditorProject(options);
  const asset = base.assets[0];
  const duration = Math.max(
    0,
    number(options.duration ?? project?.sourceDuration ?? asset?.duration),
  );
  if (!asset) return base;
  asset.duration = duration;
  const legacy = Array.isArray(project?.segments) ? project.segments : [];
  let cursor = 0;
  base.tracks[0].clips = legacy
    .map((segment, index) => {
      const trimStart = clamp(segment.start, 0, duration);
      const trimEnd = clamp(segment.end, trimStart, duration);
      const speed = clamp(segment.speed || 1, 0.5, 2);
      const clip = {
        id: String(segment.id || `clip-${index + 1}`),
        type: 'video',
        assetId: asset.id,
        timelineStart: cursor,
        trimStart,
        trimEnd,
        speed,
        muted: segment.muted === true,
        transform: defaultTransform(base.settings.width, base.settings.height, 10),
        effects: [],
      };
      cursor += Math.max(0, trimEnd - trimStart) / speed;
      return clip;
    })
    .filter((clip) => clip.trimEnd - clip.trimStart >= MIN_DURATION);
  if (!base.tracks[0].clips.length && duration > 0)
    base.tracks[0].clips = [
      {
        id: idFactory('clip'),
        type: 'video',
        assetId: asset.id,
        timelineStart: 0,
        trimStart: 0,
        trimEnd: duration,
        speed: 1,
        muted: false,
        transform: defaultTransform(base.settings.width, base.settings.height, 10),
        effects: [],
      },
    ];
  if (project?.lastExport) base.lastExport = copy(project.lastExport);
  return base;
}

function normalizeAsset(asset) {
  if (!asset || !['video', 'audio', 'image'].includes(asset.type)) return null;
  return {
    ...copy(asset),
    id: String(asset.id || idFactory('asset')),
    type: asset.type,
    name: String(asset.name || '素材'),
    sourceFile: String(asset.sourceFile || ''),
    sourceUrl: String(asset.sourceUrl || ''),
    duration: Math.max(0, number(asset.duration)),
    width: Math.max(0, number(asset.width)),
    height: Math.max(0, number(asset.height)),
  };
}

/**
 * Add a canvas media result to an editor project without duplicating an
 * already-added result. Canvas callers use a stable asset id, so reopening an
 * output focuses the existing clip instead of silently growing the timeline.
 */
export function appendEditorMediaAsset(project, asset, {
  imageDuration = 4,
  createId = idFactory,
} = {}) {
  if (!asset || !['video', 'audio', 'image'].includes(asset.type)) {
    return { project, added: false, clipId: '' };
  }
  let next = normalizeVideoEditorProject(project, { createId });
  const existing = next.tracks
    .flatMap((track) => track.clips)
    .find((clip) => clip.assetId === String(asset.id));
  if (existing) return { project: next, added: false, clipId: existing.id };

  const normalizedAsset = normalizeAsset(asset);
  if (!normalizedAsset) return { project, added: false, clipId: '' };
  next = copy(next);
  if (!next.assets.some((item) => item.id === normalizedAsset.id)) {
    next.assets.push(normalizedAsset);
  }

  const trackType = asset.type === 'image' ? 'overlay' : asset.type;
  let track = next.tracks.find((item) => item.type === trackType);
  if (!track) {
    next = addEditorTrack(
      next,
      trackType,
      asset.type === 'image' ? '画面素材' : asset.type === 'audio' ? '音乐与音效' : '主画面',
      createId,
    );
    track = next.tracks.find((item) => item.type === trackType);
  }
  if (!track) return { project, added: false, clipId: '' };

  const clipId = createId('clip');
  const timelineEnd = Math.max(
    0,
    ...track.clips.map((clip) => number(clip.timelineStart) + editorClipDuration(clip)),
  );
  const mediaDuration = Math.max(0, number(normalizedAsset.duration));
  const clip = asset.type === 'image'
    ? {
        id: clipId,
        type: 'image',
        assetId: normalizedAsset.id,
        src: normalizedAsset.sourceUrl,
        timelineStart: timelineEnd,
        duration: Math.max(MIN_DURATION, number(imageDuration, 4)),
        transform: defaultTransform(
          normalizedAsset.width || next.settings.width,
          normalizedAsset.height || next.settings.height,
          30,
        ),
      }
    : {
        id: clipId,
        type: asset.type,
        assetId: normalizedAsset.id,
        timelineStart: timelineEnd,
        trimStart: 0,
        trimEnd: mediaDuration,
        speed: 1,
        muted: false,
        volume: 1,
      };
  if (asset.type !== 'image' && mediaDuration < MIN_DURATION) {
    return { project, added: false, clipId: '' };
  }
  next = addEditorClip(next, track.id, clip, createId);
  const added = Boolean(findEditorClip(next, clipId));
  return { project: added ? next : project, added, clipId: added ? clipId : '' };
}

function normalizeTrack(track, index, assets) {
  if (!track || !TRACK_TYPES.has(track.type)) return null;
  const clips = Array.isArray(track.clips)
    ? track.clips.map((clip) => normalizeClip(clip, assets)).filter(Boolean)
    : [];
  return {
    id: String(track.id || idFactory(`track-${track.type}`)),
    type: track.type,
    name: String(track.name || `${track.type} ${index + 1}`),
    locked: track.locked === true,
    hidden: track.hidden === true,
    muted: track.muted === true,
    clips,
  };
}

function normalizeClip(clip, assets) {
  if (!clip || !CLIP_TYPES.has(clip.type)) return null;
  const common = {
    ...copy(clip),
    id: String(clip.id || idFactory('clip')),
    timelineStart: Math.max(0, number(clip.timelineStart)),
    locked: clip.locked === true,
  };
  if (clip.type === 'video' || clip.type === 'audio') {
    const asset = assets.find((item) => item.id === clip.assetId);
    if (!asset) return null;
    const trimStart = clamp(clip.trimStart, 0, asset.duration);
    const trimEnd = clamp(clip.trimEnd, trimStart, asset.duration);
    if (trimEnd - trimStart < MIN_DURATION) return null;
    return {
      ...common,
      assetId: asset.id,
      trimStart,
      trimEnd,
      speed: clamp(clip.speed || 1, 0.5, 2),
      muted: clip.muted === true,
      volume: clamp(clip.volume ?? 1, 0, 2),
      transform: normalizeFit({
        ...defaultTransform(asset.width || 1920, asset.height || 1080, 10),
        ...(clip.transform || {}),
      }),
      effects: Array.isArray(clip.effects) ? clip.effects.map(String) : [],
    };
  }
  const duration = Math.max(MIN_DURATION, number(clip.duration, 3));
  if (clip.type === 'text')
    return {
      ...common,
      duration,
      text: String(clip.text ?? '文字'),
      style: {
        fontSize: 72,
        fontFamily: 'PingFang SC',
        fontWeight: 700,
        color: '#ffffff',
        align: 'center',
        ...(clip.style || {}),
        stroke: { color: '#000000', width: 0 },
        background: { color: '#000000', opacity: 0, borderRadius: 0, paddingX: 0, paddingY: 0 },
      },
      transform: normalizeFit({ ...defaultTransform(1200, 180, 40), y: 760, ...(clip.transform || {}) }),
    };
  if (clip.type === 'image')
    return {
      ...common,
      duration,
      assetId: String(clip.assetId || ''),
      src: String(clip.src || ''),
      transform: normalizeFit({ ...defaultTransform(480, 480, 30), x: 720, y: 300, ...(clip.transform || {}) }),
      style: { ...(clip.style || {}) },
    };
  if (clip.type === 'effect')
    return {
      ...common,
      duration,
      effectKey: String(clip.effectKey || 'vignette'),
      values: { ...(clip.values || {}) },
    };
  return {
    ...common,
    duration,
    transitionKey: String(clip.transitionKey || 'fade'),
    fromClipId: clip.fromClipId ? String(clip.fromClipId) : null,
    toClipId: clip.toClipId ? String(clip.toClipId) : null,
  };
}

function defaultTransform(width, height, zIndex) {
  return {
    x: 0,
    y: 0,
    width: Math.max(1, number(width, 1920)),
    height: Math.max(1, number(height, 1080)),
    angle: 0,
    opacity: 1,
    zIndex,
    flip: { x: false, y: false },
  };
}

// fit 是片段缩放语义的唯一声明。缺省表示留边，非法值必须丢弃：预览与导出各自读取
// 这个字段，容忍未知值会让两边按不同语义渲染同一片段。
function normalizeFit(transform) {
  const next = { ...transform };
  if (next.fit === 'fill') next.fit = 'fill';
  else delete next.fit;
  return next;
}

export function editorClipDuration(clip) {
  return clip?.type === 'video' || clip?.type === 'audio'
    ? Math.max(0, number(clip.trimEnd) - number(clip.trimStart)) / clamp(clip.speed || 1, 0.5, 2)
    : Math.max(0, number(clip?.duration));
}
export function activeEditorClip(clips, time) {
  let active = null;
  for (const clip of clips || []) {
    const start = number(clip.timelineStart);
    const end = start + editorClipDuration(clip);
    if (time >= start && time < end && (!active || start >= active.timelineStart)) {
      active = clip;
    }
  }
  return active;
}
// 吸附优先级：片段边缘与时间线起点永远优先于播放头，播放头优先于网格。
// 仅比较距离会让 1 秒网格抢走接缝，手感立刻变差。
const SNAP_PRIORITY = { clip: 0, playhead: 1, grid: 2 };

export function snapEditorClipStart(project, clipId, requestedStart, tolerance, options = {}) {
  const found = findEditorClip(project, clipId);
  if (!found) return requestedStart;
  const duration = editorClipDuration(found.clip);
  const { playhead, gridSize = 0 } = options;
  const candidates = [];
  const add = (time, priority) => {
    const value = number(time);
    if (value >= 0) candidates.push({ time: value, priority });
  };
  add(0, SNAP_PRIORITY.clip);
  for (const clip of found.track.clips) {
    if (clip.id === clipId) continue;
    const start = number(clip.timelineStart);
    add(start, SNAP_PRIORITY.clip);
    add(start + editorClipDuration(clip), SNAP_PRIORITY.clip);
  }
  if (Number.isFinite(playhead)) add(playhead, SNAP_PRIORITY.playhead);
  if (gridSize > 0) add(Math.round(requestedStart / gridSize) * gridSize, SNAP_PRIORITY.grid);

  let best = requestedStart;
  let bestPriority = Number.POSITIVE_INFINITY;
  let bestDistance = tolerance;
  for (const candidate of candidates) {
    // 拖动的是片段起点，但被拖片段的终点也要找落点，所以两个方向都试。
    for (const time of [candidate.time, candidate.time - duration]) {
      if (time < 0) continue;
      const distance = Math.abs(time - requestedStart);
      if (distance > tolerance) continue;
      if (candidate.priority < bestPriority
        || (candidate.priority === bestPriority && distance < bestDistance)) {
        best = time;
        bestPriority = candidate.priority;
        bestDistance = distance;
      }
    }
  }
  return best;
}
export function videoEditorDuration(project) {
  return Math.max(
    0,
    ...(project?.tracks || []).flatMap((track) =>
      (track.clips || []).map((clip) => number(clip.timelineStart) + editorClipDuration(clip)),
    ),
  );
}
export function findEditorClip(project, clipId) {
  for (const track of project?.tracks || []) {
    const index = track.clips.findIndex((clip) => clip.id === clipId);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}

export function addEditorTrack(project, type, name, createId = idFactory) {
  if (!TRACK_TYPES.has(type)) return project;
  const next = copy(project);
  next.tracks.push({
    id: createId(`track-${type}`),
    type,
    name: name || type,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  });
  next.updatedAt = new Date().toISOString();
  return next;
}
export function removeEmptyEditorTrack(project, trackId) {
  const track = project?.tracks?.find((item) => item.id === trackId);
  if (!track || track.clips.length) return project;
  const next = copy(project);
  next.tracks = next.tracks.filter((item) => item.id !== trackId);
  next.updatedAt = new Date().toISOString();
  return next;
}
export function addEditorClip(project, trackId, clip, createId = idFactory) {
  const next = copy(project);
  const track = next.tracks.find((item) => item.id === trackId);
  if (!track || track.locked) return project;
  const normalized = normalizeClip({ ...clip, id: clip.id || createId('clip') }, next.assets);
  if (!normalized) return project;
  track.clips.push(normalized);
  track.clips.sort((a, b) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString();
  return next;
}
export function updateEditorClip(project, clipId, updates) {
  const next = copy(project);
  const found = findEditorClip(next, clipId);
  if (!found || found.track.locked || found.clip.locked) return project;
  const normalized = normalizeClip({ ...found.clip, ...updates }, next.assets);
  if (!normalized) return project;
  found.track.clips[found.index] = normalized;
  found.track.clips.sort((a, b) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString();
  return next;
}
export function removeEditorClip(project, clipId) {
  const next = copy(project);
  const found = findEditorClip(next, clipId);
  if (!found || found.track.locked) return project;
  found.track.clips.splice(found.index, 1);
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * 以源秒为增量调整片段入点或出点，供时间线上拖动裁剪手柄使用。
 *
 * 裁左边时固定右端：时间线起点与源入点同向移动，片段右端不动，因此不会在时间线上
 * 整体漂移。两端都留有最小时长，且不越过素材边界；增量在源时间上计算，所以变速片段
 * 裁同样长度只占更短的时间轴。
 *
 * `origin` 是手势开始时的时间线起点与源入出点。拖动过程中每帧都基于它算绝对位置，
 * 否则把同一段位移反复叠加到已经裁剪过的片段上，越拖越偏。
 */
export function trimEditorClip(project, clipId, edge, deltaSource, origin) {
  const found = findEditorClip(project, clipId);
  if (!found) return project;
  const { clip } = found;
  // 源时间按毫秒定精度：增量与钳位会产生 1e-16 级残渣，不该写进工程 JSON。
  const roundSource = (value) => Math.round(value * 1000) / 1000;
  const speed = clamp(clip.speed || 1, 0.5, 2);
  const minSource = MIN_DURATION * speed;
  const base = origin || {
    timelineStart: number(clip.timelineStart),
    trimStart: number(clip.trimStart),
    trimEnd: number(clip.trimEnd),
  };
  if (edge === 'start') {
    const delta = clamp(
      deltaSource,
      Math.max(-base.trimStart, -base.timelineStart * speed),
      base.trimEnd - base.trimStart - minSource,
    );
    return updateEditorClip(project, clipId, {
      trimStart: roundSource(base.trimStart + delta),
      timelineStart: Math.round((base.timelineStart + delta / speed) * 100) / 100,
    });
  }
  const assetDuration = number(project.assets.find((item) => item.id === clip.assetId)?.duration);
  const delta = clamp(
    deltaSource,
    minSource - (base.trimEnd - base.trimStart),
    assetDuration > 0 ? assetDuration - base.trimEnd : 0,
  );
  return updateEditorClip(project, clipId, { trimEnd: roundSource(base.trimEnd + delta) });
}

export function updateEditorTrack(project, trackId, updates) {
  const next = copy(project);
  const track = next.tracks.find((item) => item.id === trackId);
  if (!track) return project;
  Object.assign(track, updates);
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * 把片段移到目标轨道的指定时间。同轨只改时间；跨轨在同一份副本上完成。
 *
 * 跨轨必须先校验再搬移：若走「先 removeEditorClip 再 addEditorClip」，一旦加入失败
 * （素材缺失、时长不合法等）片段就永久消失了。任何一步不成立都返回原工程（不抛）。
 */
export function moveEditorClip(project, clipId, trackId, timelineStart) {
  const found = findEditorClip(project, clipId);
  if (!found || found.track.locked || found.clip.locked) return project;
  const start = Math.max(0, number(timelineStart));
  if (found.track.id === trackId) {
    return updateEditorClip(project, clipId, { timelineStart: start });
  }
  const target = project.tracks.find((item) => item.id === trackId);
  if (!target || target.locked || target.type !== found.track.type) return project;
  const next = copy(project);
  const source = findEditorClip(next, clipId);
  const destination = next.tracks.find((item) => item.id === trackId);
  if (!source || !destination) return project;
  const normalized = normalizeClip(
    { ...source.clip, timelineStart: start },
    next.assets,
  );
  if (!normalized) return project;
  source.track.clips.splice(source.index, 1);
  destination.clips.push(normalized);
  destination.clips.sort((a, b) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function editorProjectToOpenVideo(project) {
  const us = (seconds) => Math.max(0, Math.round(number(seconds) * 1_000_000));
  const assets = new Map((project.assets || []).map((asset) => [asset.id, asset]));
  const clips = {};
  const tracks = [];
  // Pixi derives visual z-order from track index and ignores a clip's stored
  // zIndex during frame updates: earlier tracks render above later tracks.
  // Effects stay first so their compositor can target every visual layer;
  // text and stickers must precede video or the video sprite covers them.
  const engineLayer = {
    effect: 500,
    text: 400,
    overlay: 300,
    video: 200,
    transition: 100,
    audio: 0,
  };
  const engineTracks = [...(project.tracks || [])].sort(
    (left, right) => (engineLayer[right.type] || 0) - (engineLayer[left.type] || 0),
  );
  for (const track of engineTracks) {
    if (track.hidden) continue;
    const clipIds = [];
    for (const clip of track.clips || []) {
      const duration = editorClipDuration(clip);
      if (duration < MIN_DURATION) continue;
      const from = us(clip.timelineStart);
      const to = us(clip.timelineStart + duration);
      const timing = {
        display: { from, to },
        trim: { from: us(clip.trimStart || 0), to: us(clip.trimEnd ?? duration) },
        duration: to - from,
        playbackRate: number(clip.speed, 1),
      };
      const transform = {
        ...defaultTransform(project.settings.width, project.settings.height, 10),
        ...(clip.transform || {}),
      };
      let result = {
        id: clip.id,
        name: clip.name || clip.type,
        timing,
        transform,
        locked: clip.locked === true,
      };
      if (clip.type === 'video' || clip.type === 'audio') {
        const asset = assets.get(clip.assetId);
        if (!asset) continue;
        result = {
          ...result,
          type: clip.type === 'video' ? 'Video' : 'Audio',
          src: asset.sourceUrl || asset.sourceFile,
          ...(clip.type === 'video' ? { audio: true, objectFit: clip.transform?.fit === 'fill' ? 'cover' : 'contain' } : {}),
          volume: track.muted || clip.muted ? 0 : number(clip.volume, 1),
          effects: clip.effects || [],
        };
      } else if (clip.type === 'text')
        result = { ...result, type: 'Text', text: clip.text, style: clip.style || {} };
      else if (clip.type === 'image') {
        const asset = assets.get(clip.assetId);
        result = {
          ...result,
          type: 'Image',
          src: clip.src || asset?.sourceUrl || asset?.sourceFile || '',
          objectFit: clip.transform?.fit === 'fill' ? 'cover' : 'contain',
          style: clip.style || {},
        };
        if (!result.src) continue;
      } else if (clip.type === 'effect')
        result = {
          ...result,
          type: 'Effect',
          duration: to - from,
          effectKey: clip.effectKey,
          values: clip.values || {},
        };
      else
        result = {
          ...result,
          type: 'Transition',
          duration: to - from,
          transitionKey: clip.transitionKey,
          fromClipId: clip.fromClipId,
          toClipId: clip.toClipId,
        };
      clips[clip.id] = result;
      clipIds.push(clip.id);
    }
    tracks.push({
      id: track.id,
      name: track.name,
      type:
        {
          video: 'Video',
          audio: 'Audio',
          text: 'Text',
          overlay: 'Image',
          effect: 'Effect',
          transition: 'Transition',
        }[track.type] || track.type,
      clipIds,
    });
  }
  // OpenVideo stores transition clips on the same engine track as their source
  // clip. A standalone Transition track is valid editor UI state, but the Pixi
  // timeline would never bind it to either video during preview or export.
  const transitionTrackIds = new Set(
    tracks.filter((track) => track.type === 'Transition').map((track) => track.id),
  );
  for (const transitionTrack of tracks.filter((track) => track.type === 'Transition')) {
    for (const clipId of transitionTrack.clipIds) {
      const transition = clips[clipId];
      const parentTrack = tracks.find(
        (track) =>
          !transitionTrackIds.has(track.id) && track.clipIds.includes(transition?.fromClipId),
      );
      if (
        !transition?.fromClipId ||
        !transition?.toClipId ||
        !parentTrack ||
        !clips[transition.toClipId]
      ) {
        delete clips[clipId];
        continue;
      }
      parentTrack.clipIds.push(clipId);
      parentTrack.accepts = [
        ...new Set([...(parentTrack.accepts || [parentTrack.type.toLowerCase()]), 'transition']),
      ];
    }
  }
  const renderTracks = tracks.filter((track) => !transitionTrackIds.has(track.id));
  return {
    settings: {
      width: project.settings.width,
      height: project.settings.height,
      fps: project.settings.fps,
      duration: us(videoEditorDuration(project)),
      backgroundColor: project.settings.backgroundColor || '#050608',
    },
    tracks: renderTracks,
    clips,
  };
}

export { MIN_DURATION as MIN_EDITOR_CLIP_DURATION };
