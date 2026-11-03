import { t } from '../i18n/index.ts';
// 剪辑工程是持久化的松散 JSON 结构：内部按 AnyRecord 读写，只在导出边界收敛为 app 层严格类型。
// import type 不产生运行时依赖，因此 utils 引用 app 类型不违反分层约束。
import type {
  VideoEditorClip,
  VideoEditorProject,
  VideoEditorTrack,
} from '@/app/editor/videoEditorTypes';

type AnyRecord = Record<string, any>;

export const MIN_DURATION = 0.08;
const TRACK_TYPES = new Set(['video', 'audio', 'text', 'overlay', 'effect', 'transition']);
const CLIP_TYPES = new Set(['video', 'audio', 'text', 'image', 'effect', 'transition']);
const TRACK_LABELS: Record<string, string> = {
  video: t('editor.track.video'), audio: t('editor.track.audio'), text: t('editor.track.text'),
  overlay: t('editor.track.overlay'), effect: t('editor.track.effect'), transition: t('editor.track.transition'),
};

const number = (value: unknown, fallback = 0) => (Number.isFinite(Number(value)) ? Number(value) : fallback);
const clamp = (value: unknown, min: number, max: number) => Math.min(max, Math.max(min, number(value, min)));
const idFactory = (prefix = 'item') =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const copy = (value: unknown) => JSON.parse(JSON.stringify(value)) as AnyRecord;

export function createVideoEditorProject({
  sourceFile = '',
  sourceUrl = '',
  sourceName = 'video.mp4',
  duration = 0,
  width = 1920,
  height = 1080,
  fps = 30,
  createId = idFactory,
}: {
  sourceFile?: string;
  sourceUrl?: string;
  sourceName?: string;
  duration?: number;
  width?: number;
  height?: number;
  fps?: number;
  createId?: (prefix?: string) => string;
} = {}): VideoEditorProject {
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
        name: t('editor.track.video'),
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
        name: t('editor.track.audio'),
        locked: false,
        hidden: false,
        muted: false,
        clips: [],
      },
    ],
    updatedAt: new Date().toISOString(),
  };
}

export function createVideoSegmentProject(
  options: AnyRecord,
  segment: { start?: unknown; end?: unknown } | null | undefined,
): VideoEditorProject {
  const start = Number(segment?.start);
  const end = Number(segment?.end);
  const sourceDuration = Number(options.duration);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > sourceDuration + 0.01) {
    throw new Error(t('editor.segment.invalidRange'));
  }
  const project = createVideoEditorProject(options);
  const clip = project.tracks[0]?.clips[0];
  if (!clip) throw new Error(t('editor.segment.missing'));
  clip.trimStart = start;
  clip.trimEnd = end;
  return project;
}

export function normalizeVideoEditorProject(
  project: AnyRecord | null | undefined,
  options: AnyRecord = {},
): VideoEditorProject {
  if (project?.version !== 2 || project?.schema !== 'shotloom.video-edit')
    return migrateLegacyProject(project, options) as VideoEditorProject;
  const base = createVideoEditorProject({ ...options, duration: 0 });
  const assets: AnyRecord[] = Array.isArray(project.assets)
    ? project.assets.map(normalizeAsset).filter(Boolean) as AnyRecord[]
    : base.assets;
  const tracks: AnyRecord[] = Array.isArray(project.tracks)
    ? project.tracks.map((track: AnyRecord, index: number) => normalizeTrack(track, index, assets)).filter(Boolean) as AnyRecord[]
    : [];
  if (!tracks.some((track) => track.type === 'video'))
    tracks.unshift({
      id: idFactory('track-video'),
      type: 'video',
      name: t('editor.track.video'),
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
    ...(typeof project.openReelSnapshot === "string" ? { openReelSnapshot: project.openReelSnapshot } : {}),
    ...(project.openReelOverview && typeof project.openReelOverview === "object" ? { openReelOverview: copy(project.openReelOverview) } : {}),
    updatedAt: String(project.updatedAt || new Date().toISOString()),
    ...(project.lastExport ? { lastExport: copy(project.lastExport) } : {}),
  } as VideoEditorProject;
}

function migrateLegacyProject(
  project: AnyRecord | null | undefined,
  options: AnyRecord,
): AnyRecord {
  const projectRecord = project;
  const optionsRecord = options;
  const base: AnyRecord = createVideoEditorProject(optionsRecord);
  const asset = base.assets[0];
  const duration = Math.max(
    0,
    number(optionsRecord.duration ?? projectRecord?.sourceDuration ?? asset?.duration),
  );
  if (!asset) return base;
  asset.duration = duration;
  const legacy = Array.isArray(projectRecord?.segments) ? projectRecord.segments : [];
  let cursor = 0;
  base.tracks[0].clips = legacy
    .map((segment: AnyRecord, index: number) => {
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
    .filter((clip: AnyRecord) => clip.trimEnd - clip.trimStart >= MIN_DURATION);
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
  if (projectRecord?.lastExport) base.lastExport = copy(projectRecord.lastExport);
  return base;
}

function normalizeAsset(asset: AnyRecord | null | undefined) {
  if (!asset || !['video', 'audio', 'image'].includes(asset.type)) return null;
  return {
    ...copy(asset),
    id: String(asset.id || idFactory('asset')),
    type: asset.type,
    name: String(asset.name || t('ui.canvasAdapter.text.75e00c77')),
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
export function appendEditorMediaAsset(project: AnyRecord, asset: AnyRecord | null | undefined, {
  imageDuration = 4,
  createId = idFactory,
}: { imageDuration?: number; createId?: (prefix?: string) => string } = {}): {
  project: VideoEditorProject;
  added: boolean;
  clipId: string;
} {
  if (!asset || !['video', 'audio', 'image'].includes(asset.type)) {
    return { project: project as VideoEditorProject, added: false, clipId: '' };
  }
  let next: AnyRecord = normalizeVideoEditorProject(project, { createId });
  const existing = next.tracks
    .flatMap((track: AnyRecord) => track.clips)
    .find((clip: AnyRecord) => clip.assetId === String(asset.id));
  if (existing) return { project: next as VideoEditorProject, added: false, clipId: existing.id };

  const normalizedAsset = normalizeAsset(asset);
  if (!normalizedAsset) return { project: project as VideoEditorProject, added: false, clipId: '' };
  next = copy(next);
  if (!next.assets.some((item: AnyRecord) => item.id === normalizedAsset.id)) {
    next.assets.push(normalizedAsset);
  }

  const trackType = asset.type === 'image' ? 'overlay' : asset.type;
  let track = next.tracks.find((item: AnyRecord) => item.type === trackType);
  if (!track) {
    next = addEditorTrack(
      next,
      trackType,
      asset.type === 'image' ? t('editor.track.overlay') : asset.type === 'audio' ? t('editor.track.audio') : t('editor.track.video'),
      createId,
    );
    track = next.tracks.find((item: AnyRecord) => item.type === trackType);
  }
  if (!track) return { project: project as VideoEditorProject, added: false, clipId: '' };

  const clipId = createId('clip');
  const timelineEnd = Math.max(
    0,
    ...track.clips.map((clip: AnyRecord) => number(clip.timelineStart) + editorClipDuration(clip)),
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
    return { project: project as VideoEditorProject, added: false, clipId: '' };
  }
  next = addEditorClip(next, track.id, clip, createId);
  const added = Boolean(findEditorClip(next, clipId));
  return {
    project: (added ? next : project) as VideoEditorProject,
    added,
    clipId: added ? clipId : '',
  };
}

function normalizeTrack(track: AnyRecord | null | undefined, index: number, assets: AnyRecord[]) {
  if (!track || !TRACK_TYPES.has(track.type)) return null;
  const clips = Array.isArray(track.clips)
    ? track.clips.map((clip: AnyRecord) => normalizeClip(clip, assets)).filter(Boolean)
    : [];
  return {
    id: String(track.id || idFactory(`track-${track.type}`)),
    type: track.type,
    name: String(track.name || t('editor.track.numbered', { name: TRACK_LABELS[track.type] || track.type, number: index + 1 })),
    locked: track.locked === true,
    hidden: track.hidden === true,
    muted: track.muted === true,
    clips,
  };
}

function normalizeClip(clip: AnyRecord | null | undefined, assets: AnyRecord[]): AnyRecord | null {
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
      text: String(clip.text ?? t('ui.projectBridge.name.f4d3dab8')),
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

function defaultTransform(width: unknown, height: unknown, zIndex: number) {
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
function normalizeFit(transform: AnyRecord): AnyRecord {
  const next = { ...transform };
  if (next.fit === 'fill') next.fit = 'fill';
  else delete next.fit;
  return next;
}

export function editorClipDuration(clip: AnyRecord | null | undefined) {
  return clip?.type === 'video' || clip?.type === 'audio'
    ? Math.max(0, number(clip.trimEnd) - number(clip.trimStart)) / clamp(clip.speed || 1, 0.5, 2)
    : Math.max(0, number(clip?.duration));
}
export function activeEditorClip(
  clips: AnyRecord[] | null | undefined,
  time: number,
): VideoEditorClip | null {
  let active: AnyRecord | null = null;
  for (const clip of clips || []) {
    const start = number(clip.timelineStart);
    const end = start + editorClipDuration(clip);
    if (time >= start && time < end && (!active || start >= active.timelineStart)) {
      active = clip;
    }
  }
  return active as VideoEditorClip | null;
}
// 吸附优先级：片段边缘与时间线起点永远优先于播放头，播放头优先于网格。
// 仅比较距离会让 1 秒网格抢走接缝，手感立刻变差。
const SNAP_PRIORITY: Record<'clip' | 'playhead' | 'grid', number> = { clip: 0, playhead: 1, grid: 2 };

export function snapEditorClipStart(project: AnyRecord, clipId: string, requestedStart: number, tolerance: number, options: { playhead?: number; gridSize?: number } = {}): number {
  const found = findEditorClip(project, clipId);
  if (!found) return requestedStart;
  const duration = editorClipDuration(found.clip);
  const { playhead, gridSize = 0 } = options;
  const candidates: { time: number; priority: number }[] = [];
  const add = (time: unknown, priority: number) => {
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
/** OpenReel 里图片/图形片段没有真实时长时的默认长度，与 core 的 clip/add 一致。 */
const DEFAULT_EDITOR_CLIP_DURATION = 5;
/** 摘要轨道类型（overlay）与 OpenReel track/add 的 trackType（image）在这里对齐。 */
function editorMediaTrackSlot(type: string | undefined) {
  if (type === "audio") return { summary: "audio", native: "audio" };
  if (type === "image") return { summary: "overlay", native: "image" };
  return { summary: "video", native: "video" };
}

/**
 * 添加素材时要把片段排到对应轨道末尾；只进媒体库不落时间线，
 * 用户会以为添加没生效。
 * 返回可直接投递给 clip/add 的参数，以及当前工程还缺的轨道类型。
 */
export function planEditorMediaPlacement(
  project: AnyRecord | null | undefined,
  items: Array<{ mediaId: string; type?: string; duration?: number }>,
): {
  clips: Array<{ trackId: string; mediaId: string; startTime: number; duration: number }>;
  missingTracks: string[];
} {
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const ends = new Map<string, number>();
  const clips: Array<{ trackId: string; mediaId: string; startTime: number; duration: number }> = [];
  const missingTracks: string[] = [];
  for (const item of items) {
    if (!item?.mediaId) continue;
    const slot = editorMediaTrackSlot(item.type);
    const track = tracks.find((candidate: AnyRecord) => candidate?.type === slot.summary && !candidate.locked);
    if (!track) {
      if (!missingTracks.includes(slot.native)) missingTracks.push(slot.native);
      continue;
    }
    const trackId = String(track.id);
    const trackEnd = (Array.isArray(track.clips) ? track.clips : []).reduce(
      (end: number, clip: AnyRecord) =>
        Math.max(end, number(clip.timelineStart) + editorClipDuration(clip)),
      0,
    );
    const startTime = Math.max(trackEnd, ends.get(trackId) || 0);
    const duration = number(item.duration) > 0 ? number(item.duration) : DEFAULT_EDITOR_CLIP_DURATION;
    ends.set(trackId, startTime + duration);
    clips.push({ trackId, mediaId: item.mediaId, startTime, duration });
  }
  return { clips, missingTracks };
}

export function videoEditorDuration(project: AnyRecord | null | undefined) {
  return Math.max(
    0,
    ...(project?.tracks || []).flatMap((track: AnyRecord) =>
      (track.clips || []).map((clip: AnyRecord) => number(clip.timelineStart) + editorClipDuration(clip)),
    ),
  );
}
export function findEditorClip(
  project: AnyRecord | null | undefined,
  clipId: string,
): { track: VideoEditorTrack; clip: VideoEditorClip; index: number } | null {
  for (const track of project?.tracks || []) {
    const index = track.clips.findIndex((clip: AnyRecord) => clip.id === clipId);
    if (index >= 0) {
      return {
        track: track as VideoEditorTrack,
        clip: track.clips[index] as VideoEditorClip,
        index,
      };
    }
  }
  return null;
}

export function addEditorTrack(project: AnyRecord, type: string, name: string, createId = idFactory): VideoEditorProject {
  if (!TRACK_TYPES.has(type)) return project as VideoEditorProject;
  const next = copy(project);
  next.tracks.push({
    id: createId(`track-${type}`),
    type,
    name: name || TRACK_LABELS[type] || type,
    locked: false,
    hidden: false,
    muted: false,
    clips: [],
  });
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
}
export function removeEmptyEditorTrack(project: AnyRecord, trackId: string): VideoEditorProject {
  const track = project?.tracks?.find((item: AnyRecord) => item.id === trackId);
  if (!track || track.clips.length) return project as VideoEditorProject;
  const next = copy(project);
  next.tracks = next.tracks.filter((item: AnyRecord) => item.id !== trackId);
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
}
export function addEditorClip(project: AnyRecord, trackId: string, clip: AnyRecord, createId = idFactory): VideoEditorProject {
  const next = copy(project);
  const track = next.tracks.find((item: AnyRecord) => item.id === trackId);
  if (!track || track.locked) return project as VideoEditorProject;
  const normalized = normalizeClip({ ...clip, id: clip.id || createId('clip') }, next.assets);
  if (!normalized) return project as VideoEditorProject;
  track.clips.push(normalized);
  track.clips.sort((a: AnyRecord, b: AnyRecord) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
}
export function updateEditorClip(project: AnyRecord, clipId: string, updates: AnyRecord): VideoEditorProject {
  const next = copy(project);
  const found = findEditorClip(next, clipId);
  if (!found || found.track.locked || found.clip.locked) return project as VideoEditorProject;
  const normalized = normalizeClip({ ...found.clip, ...updates }, next.assets);
  if (!normalized) return project as VideoEditorProject;
  found.track.clips[found.index] = normalized as VideoEditorClip;
  found.track.clips.sort((a: AnyRecord, b: AnyRecord) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
}
export function removeEditorClip(project: AnyRecord, clipId: string): VideoEditorProject {
  const next = copy(project);
  const found = findEditorClip(next, clipId);
  if (!found || found.track.locked) return project as VideoEditorProject;
  found.track.clips.splice(found.index, 1);
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
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
export function trimEditorClip(
  project: AnyRecord,
  clipId: string,
  edge: string,
  deltaSource: number,
  origin?: { timelineStart: number; trimStart: number; trimEnd: number } | null,
): VideoEditorProject {
  const found = findEditorClip(project, clipId);
  if (!found) return project as VideoEditorProject;
  const { clip } = found;
  // 源时间按毫秒定精度：增量与钳位会产生 1e-16 级残渣，不该写进工程 JSON。
  const roundSource = (value: number) => Math.round(value * 1000) / 1000;
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
    return updateEditorClip(project, clip.id, {
      trimStart: roundSource(base.trimStart + delta),
      timelineStart: Math.round((base.timelineStart + delta / speed) * 100) / 100,
    });
  }
  const assetDuration = number(project.assets.find((item: AnyRecord) => item.id === clip.assetId)?.duration);
  const delta = clamp(
    deltaSource,
    minSource - (base.trimEnd - base.trimStart),
    assetDuration > 0 ? assetDuration - base.trimEnd : 0,
  );
  return updateEditorClip(project, clip.id, { trimEnd: roundSource(base.trimEnd + delta) });
}

export function updateEditorTrack(project: AnyRecord, trackId: string, updates: object): VideoEditorProject {
  const next = copy(project);
  const track = next.tracks.find((item: AnyRecord) => item.id === trackId);
  if (!track) return project as VideoEditorProject;
  Object.assign(track, updates);
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
}

/**
 * 把片段移到目标轨道的指定时间。同轨只改时间；跨轨在同一份副本上完成。
 *
 * 跨轨必须先校验再搬移：若走「先 removeEditorClip 再 addEditorClip」，一旦加入失败
 * （素材缺失、时长不合法等）片段就永久消失了。任何一步不成立都返回原工程（不抛）。
 */
export function moveEditorClip(project: AnyRecord, clipId: string, trackId: string, timelineStart: number): VideoEditorProject {
  const found = findEditorClip(project, clipId);
  if (!found || found.track.locked || found.clip.locked) return project as VideoEditorProject;
  const start = Math.max(0, number(timelineStart));
  if (found.track.id === trackId) {
    return updateEditorClip(project, clipId, { timelineStart: start });
  }
  const target = project.tracks.find((item: AnyRecord) => item.id === trackId);
  if (!target || target.locked || target.type !== found.track.type) return project as VideoEditorProject;
  const next = copy(project);
  const source = findEditorClip(next, clipId);
  const destination = next.tracks.find((item: AnyRecord) => item.id === trackId);
  if (!source || !destination) return project as VideoEditorProject;
  const normalized = normalizeClip(
    { ...source.clip, timelineStart: start },
    next.assets,
  );
  if (!normalized) return project as VideoEditorProject;
  source.track.clips.splice(source.index, 1);
  destination.clips.push(normalized);
  destination.clips.sort((a: AnyRecord, b: AnyRecord) => a.timelineStart - b.timelineStart);
  next.updatedAt = new Date().toISOString();
  return next as VideoEditorProject;
}

export { MIN_DURATION as MIN_EDITOR_CLIP_DURATION };
