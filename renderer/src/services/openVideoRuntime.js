import { editorProjectToOpenVideo } from '../utils/videoEditorProject.mjs';

const US_PER_SECOND = 1_000_000;
let metadataProviderReady = false;

function secondsToUs(value) {
  return Math.max(0, Math.round((Number(value) || 0) * US_PER_SECOND));
}

function projectDuration(segments = []) {
  return segments.reduce((total, segment) => {
    const speed = Math.max(0.5, Math.min(2, Number(segment.speed) || 1));
    return total + Math.max(0, segment.end - segment.start) / speed;
  }, 0);
}

export function getOpenVideoRuntimeSupport() {
  const canvas = typeof document !== 'undefined' && document.createElement('canvas');
  return {
    preview: Boolean(canvas?.getContext?.('webgl2') || canvas?.getContext?.('webgl')),
    browserEncoding: typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined',
  };
}

export function createOpenVideoProject({
  sourceUrl,
  sourceName = 'video.mp4',
  segments = [],
  width = 1920,
  height = 1080,
  fps = 30,
} = {}) {
  const duration = projectDuration(segments);
  let cursor = 0;
  const clips = {};
  const clipIds = [];

  segments.forEach((segment, index) => {
    const speed = Math.max(0.5, Math.min(2, Number(segment.speed) || 1));
    const clipDuration = Math.max(0, Number(segment.end) - Number(segment.start)) / speed;
    if (!clipDuration) return;
    const id = String(segment.id || `video-${index + 1}`);
    const from = secondsToUs(cursor);
    const to = secondsToUs(cursor + clipDuration);
    clips[id] = {
      id,
      type: 'Video',
      src: sourceUrl,
      name: `${sourceName} · ${String(index + 1).padStart(2, '0')}`,
      timing: {
        display: { from, to },
        trim: { from: secondsToUs(segment.start), to: secondsToUs(segment.end) },
        duration: to - from,
        playbackRate: speed,
      },
      transform: {
        x: 0,
        y: 0,
        width,
        height,
        angle: 0,
        opacity: 1,
        zIndex: 10,
        flip: { x: false, y: false },
      },
      style: {},
      volume: segment.muted ? 0 : 1,
      locked: false,
      effects: [],
      animations: [],
    };
    clipIds.push(id);
    cursor += clipDuration;
  });

  return {
    settings: {
      width,
      height,
      fps,
      duration: secondsToUs(duration),
      backgroundColor: '#050608',
    },
    tracks: [{
      id: 'main-video',
      name: '主画面',
      type: 'Video',
      clipIds,
      accepts: ['Video', 'Image'],
    }],
    clips,
  };
}

export function createOpenVideoStudioProject(project) {
  const converted = editorProjectToOpenVideo(project);
  const interactiveTypes = new Set(['Text', 'Image']);
  const clips = Object.fromEntries(
    Object.entries(converted.clips).filter(([, clip]) => !interactiveTypes.has(clip.type)),
  );
  const tracks = converted.tracks
    .map((track) => ({
      ...track,
      clipIds: track.clipIds.filter((id) => clips[id]),
    }))
    .filter((track) => track.clipIds.length > 0 || ['Video', 'Audio', 'Effect'].includes(track.type));
  return { ...converted, tracks, clips };
}

export async function createOpenVideoRuntime({
  canvas,
  project,
  previewScale = 0.75,
  onTime,
  onSelection,
  onTransformStart,
  onTransformEnd,
  onPlayingChange,
}) {
  const [{ BrowserMetadataProvider, Core, CoreConfig }, { Studio }] = await Promise.all([
    import('@openvideo/core'),
    import('@openvideo/engine-pixi'),
  ]);
  if (!metadataProviderReady) {
    CoreConfig.setMetadataProvider(new BrowserMetadataProvider());
    metadataProviderReady = true;
  }
  const core = new Core(project);
  const studio = new Studio({
    width: project.settings.width,
    height: project.settings.height,
    fps: project.settings.fps,
    backgroundColor: '#11151a',
    artboardColor: '#050608',
    canvas,
    core,
    interactivity: true,
    allowZoom: true,
    allowPan: true,
    previewScale,
  });
  if (onTime) studio.on('currentTime', ({ currentTime }) => onTime(currentTime / US_PER_SECOND));
  const emitSelection = ({ selected = [] } = {}) => onSelection?.(selected.map((clip) => clip.id));
  studio.on('selection:created', emitSelection);
  studio.on('selection:updated', emitSelection);
  studio.on('selection:cleared', () => onSelection?.([]));
  studio.on('transform:start', () => onTransformStart?.());
  studio.on('transform:end', () => {
    for (const clip of studio.getSelectedClips()) {
      onTransformEnd?.({
        id: clip.id,
        transform: {
          x: clip.left,
          y: clip.top,
          width: clip.width,
          height: clip.height,
          angle: clip.angle,
          opacity: clip.opacity,
          zIndex: clip.zIndex,
          flip: clip.flip,
        },
      });
    }
  });
  studio.on('play', () => onPlayingChange?.(true));
  studio.on('pause', () => onPlayingChange?.(false));
  await studio.ready;

  return {
    core,
    studio,
    replaceProject(nextProject) {
      core.project.import(nextProject);
    },
    exportProject() {
      return core.project.export();
    },
    selectClip(id) {
      studio.selectClipsByIds(id ? [id] : []);
    },
    updateClip(id, updates) {
      return studio.updateClip(id, updates);
    },
    async centerClip(id) {
      await studio.centerClip(id);
      return studio.exportToJSON().clips[id]?.transform;
    },
    async fitClip(id) {
      await studio.scaleToFit(id);
      await studio.centerClip(id);
      return studio.exportToJSON().clips[id]?.transform;
    },
    async coverClip(id) {
      await studio.scaleToCover(id);
      await studio.centerClip(id);
      return studio.exportToJSON().clips[id]?.transform;
    },
    undo() {
      return studio.undo();
    },
    redo() {
      return studio.redo();
    },
    resetView() {
      studio.resetView();
    },
    seek(seconds) {
      return studio.seek(secondsToUs(seconds));
    },
    play() {
      return studio.play();
    },
    pause() {
      studio.pause();
    },
    frameNext() {
      return studio.frameNext();
    },
    framePrev() {
      return studio.framePrev();
    },
    destroy() {
      studio.destroy();
    },
  };
}
