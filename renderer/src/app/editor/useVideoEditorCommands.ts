import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  addEditorClip,
  addEditorTrack,
  editorClipDuration,
  findEditorClip,
  removeEditorClip,
  updateEditorClip,
  updateEditorTrack,
} from "../../utils/videoEditorProject.mjs";
import { constrainTransformToCanvas } from "./videoEditorModel";
import { effects, textPresets, transitions } from "./videoEditorCatalog";
import { formatEditorTime } from "./videoEditorFormat";
import type { VideoEditorRuntimeRef } from "./videoEditorRuntimeTypes";
import type {
  VideoEditorAsset,
  VideoEditorClip,
  VideoEditorProject,
  VideoEditorTrack,
  VideoEditorTrackType,
} from "./videoEditorTypes";

type CanvasAction = "centerClip" | "fitClip" | "coverClip";

export function useVideoEditorCommands({
  project,
  projectRef,
  selectedId,
  setSelectedId,
  time,
  duration,
  videoClips,
  runtimeRef,
  runtimeMutationRef,
  createStudioProject,
  commit,
  seekPreview,
  setTextNotice,
  setToolNotice,
}: {
  project: VideoEditorProject;
  projectRef: MutableRefObject<VideoEditorProject>;
  selectedId: string;
  setSelectedId: Dispatch<SetStateAction<string>>;
  time: number;
  duration: number;
  videoClips: VideoEditorClip[];
  runtimeRef: VideoEditorRuntimeRef;
  runtimeMutationRef: MutableRefObject<boolean>;
  createStudioProject: (project: VideoEditorProject) => unknown;
  commit: (project: VideoEditorProject, record?: boolean) => void;
  seekPreview: (time: number) => void;
  setTextNotice: Dispatch<SetStateAction<string>>;
  setToolNotice: Dispatch<SetStateAction<string>>;
}) {
  const selected = selectedId ? findEditorClip(project, selectedId) : null;

  const ensureTrack = (type: VideoEditorTrackType, name: string) => {
    const current = projectRef.current;
    const existing = current.tracks.find((track) => track.type === type);
    if (existing) {
      if (!existing.locked && !existing.hidden) {
        return { project: current, track: existing };
      }
      const next = updateEditorTrack(current, existing.id, {
        locked: false,
        hidden: false,
      });
      return {
        project: next,
        track: next.tracks.find((track: VideoEditorTrack) => track.id === existing.id),
      };
    }
    const next = addEditorTrack(current, type, name, createId);
    return { project: next, track: next.tracks.at(-1) };
  };

  const addClip = (
    type: VideoEditorClip["type"],
    payload: Record<string, unknown>,
    trackType: VideoEditorTrackType,
    trackName: string,
  ) => {
    const ensured = ensureTrack(trackType, trackName);
    if (!ensured.track) return null;
    const clipId = String(payload.id || createId("clip"));
    const next = addEditorClip(ensured.project, ensured.track.id, {
      id: clipId,
      type,
      timelineStart: Math.min(time, duration),
      ...payload,
    }, createId);
    const added = next.tracks.find((track: VideoEditorTrack) =>
      track.id === ensured.track?.id
    )?.clips.find((clip: VideoEditorClip) => clip.id === clipId);
    commit(next);
    if (added) setSelectedId(added.id);
    return added || null;
  };

  const clipFocusTime = (clip: VideoEditorClip) => {
    const start = Math.max(0, Number(clip.timelineStart) || 0);
    const clipDuration = editorClipDuration(clip);
    if (clip.type !== "video" && clip.type !== "audio") return start;
    return Math.min(
      start + Math.max(0, clipDuration - .001),
      start + 1 / projectRef.current.settings.fps,
    );
  };

  const addAsset = (asset: VideoEditorAsset) => {
    const mediaDuration = Number(asset.duration);
    if (asset.type !== "image" && (!Number.isFinite(mediaDuration) || mediaDuration <= 0)) {
      setToolNotice(`“${asset.name}”读取失败，无法添加到时间线。`);
      return;
    }
    if (asset.type !== "image") {
      const matchingAssetIds = new Set(
        projectRef.current.assets
          .filter((item) =>
            item.id === asset.id ||
            (asset.sourceFile && item.sourceFile === asset.sourceFile)
          )
          .map((item) => item.id),
      );
      const existing = projectRef.current.tracks
        .flatMap((track) => track.clips)
        .find((clip) => matchingAssetIds.has(clip.assetId || ""));
      if (existing) {
        setSelectedId(existing.id);
        seekPreview(clipFocusTime(existing));
        setToolNotice(`已定位到“${asset.name}”在时间线中的片段。`);
        return;
      }
    }
    let next = projectRef.current;
    if (!next.assets.some((item) => item.id === asset.id)) {
      next = { ...next, assets: [...next.assets, clone(asset)] };
    }
    const trackType: VideoEditorTrackType = asset.type === "audio"
      ? "audio"
      : asset.type === "image"
      ? "overlay"
      : "video";
    const trackName = asset.type === "audio"
      ? "音乐与音效"
      : asset.type === "image"
      ? "贴图"
      : "补充画面";
    let track = next.tracks.find((item) => item.type === trackType);
    if (!track) {
      next = addEditorTrack(next, trackType, trackName, createId);
      track = next.tracks.at(-1);
    } else if (track.locked || track.hidden) {
      const trackId = track.id;
      next = updateEditorTrack(next, trackId, { locked: false, hidden: false });
      track = next.tracks.find((item) => item.id === trackId);
    }
    if (!track) {
      setToolNotice("无法创建素材轨道，请重试。");
      return;
    }
    const trimEnd = mediaDuration || 0;
    const clipId = createId("clip");
    const imageDuration = 4;
    const imageStart = duration > 0
      ? Math.min(time, Math.max(0, duration - imageDuration))
      : 0;
    const videoStart = asset.type === "video"
      ? Math.max(
        0,
        ...track.clips.map((clip) =>
          Number(clip.timelineStart) + editorClipDuration(clip)
        ),
      )
      : Math.min(time, duration);
    const canvasWidth = next.settings.width;
    const canvasHeight = next.settings.height;
    const sourceWidth = Math.max(1, Number(asset.width) || 512);
    const sourceHeight = Math.max(1, Number(asset.height) || 512);
    const imageScale = Math.min(
      canvasWidth * .28 / sourceWidth,
      canvasHeight * .36 / sourceHeight,
      1,
    );
    const imageWidth = Math.max(80, sourceWidth * imageScale);
    const imageHeight = Math.max(80, sourceHeight * imageScale);
    next = addEditorClip(
      next,
      track.id,
      asset.type === "image"
        ? {
          id: clipId,
          type: "image",
          assetId: asset.id,
          src: asset.sourceUrl,
          timelineStart: imageStart,
          duration: duration > 0
            ? Math.max(.08, Math.min(imageDuration, duration - imageStart))
            : imageDuration,
          transform: {
            x: (canvasWidth - imageWidth) / 2,
            y: (canvasHeight - imageHeight) / 2,
            width: imageWidth,
            height: imageHeight,
            angle: 0,
            opacity: 1,
            zIndex: 30,
            flip: { x: false, y: false },
          },
        }
        : {
          id: clipId,
          type: asset.type,
          assetId: asset.id,
          timelineStart: videoStart,
          trimStart: 0,
          trimEnd,
          speed: 1,
          muted: false,
        },
      createId,
    );
    const added = next.tracks.find((item) => item.id === track?.id)?.clips
      .find((clip) => clip.id === clipId);
    commit(next);
    if (added) {
      setSelectedId(added.id);
      if (asset.type === "image") {
        seekPreview(imageStart + Math.min(.05, editorClipDuration(added) / 2));
        setToolNotice(`“${asset.name}”已添加到画面中央，可在画布拖动、缩放或旋转。`);
      } else if (asset.type === "video") {
        seekPreview(clipFocusTime(added));
        setToolNotice(`“${asset.name}”已追加到视频轨末尾。`);
      }
    } else {
      setToolNotice(
        asset.type === "image"
          ? "贴图添加失败，请重试。"
          : `“${asset.name}”读取失败，无法添加到时间线。`,
      );
    }
  };

  const activateAsset = (asset: VideoEditorAsset) => {
    const existing = projectRef.current.tracks
      .flatMap((track) => track.clips)
      .find((clip) => clip.assetId === asset.id);
    if (!existing) {
      addAsset(asset);
      return;
    }
    setSelectedId(existing.id);
    seekPreview(clipFocusTime(existing));
    setToolNotice(`已定位到“${asset.name}”。`);
  };

  const addText = (preset = textPresets[0]) => {
    const canvasWidth = projectRef.current.settings.width;
    const canvasHeight = projectRef.current.settings.height;
    const textWidth = Math.min(1200, canvasWidth * .76);
    const start = duration > 0
      ? Math.min(time, Math.max(0, duration - 3))
      : 0;
    const added = addClip(
      "text",
      {
        timelineStart: start,
        duration: Math.max(.1, Math.min(3, duration - start || 3)),
        text: preset.sample,
        style: {
          fontSize: preset.fontSize,
          fontFamily: preset.fontFamily,
          fontWeight: preset.fontWeight,
          color: "#ffffff",
          background: {
            color: "#000000",
            opacity: 0,
            borderRadius: 0,
            paddingX: 0,
            paddingY: 0,
          },
          align: "center",
          stroke: { color: "#000000", width: 0 },
        },
        transform: {
          x: (canvasWidth - textWidth) / 2,
          y: canvasHeight * preset.y,
          width: textWidth,
          height: Math.max(120, canvasHeight * .14),
          angle: 0,
          opacity: 1,
          zIndex: 40,
          flip: { x: false, y: false },
        },
      },
      "text",
      "字幕与标题",
    );
    if (added) {
      seekPreview(start);
      setTextNotice(`字幕已添加到 ${formatEditorTime(start)}`);
      window.setTimeout(() => setTextNotice(""), 2200);
    } else {
      setTextNotice("字幕添加失败，请重试");
    }
  };

  const addTransition = (key: string) => {
    if (videoClips.length < 2) {
      setToolNotice("转场需要连接两段视频，请先在时间线上切分视频或添加第二段素材。");
      return;
    }
    const index = videoClips.findIndex((clip) => clip.id === selectedId);
    const toIndex = index > 0 ? index : 1;
    const to = videoClips[toIndex];
    const from = videoClips[toIndex - 1];
    const added = addClip(
      "transition",
      {
        duration: .6,
        timelineStart: to.timelineStart - .3,
        transitionKey: key,
        fromClipId: from.id,
        toClipId: to.id,
      },
      "transition",
      "转场",
    );
    if (added) {
      seekPreview(Math.max(0, to.timelineStart - .28));
      setToolNotice(`已添加 ${transitions.find((item) => item.key === key)?.name || "转场"}，播放接缝处即可预览。`);
    }
  };

  const addEffect = (key: string) => {
    if (duration <= 0) {
      setToolNotice("时间线上还没有可应用特效的画面。");
      return;
    }
    const start = Math.min(time, Math.max(0, duration - 1));
    const added = addClip(
      "effect",
      {
        timelineStart: start,
        duration: Math.min(4, duration - start),
        effectKey: key,
        values: {},
      },
      "effect",
      "全局特效",
    );
    if (added) {
      seekPreview(start + Math.min(.08, editorClipDuration(added) / 2));
      setToolNotice(`已应用 ${effects.find((item) => item.key === key)?.name || "视觉特效"}，当前画面可直接预览。`);
    }
  };

  const updateSelected = (updates: Record<string, unknown>) => {
    if (!selectedId) return;
    const next = updateEditorClip(projectRef.current, selectedId, updates);
    const runtimeUpdates: Record<string, unknown> = {};
    if (updates.transform) runtimeUpdates.transform = updates.transform;
    if (updates.style && typeof updates.style === "object") {
      const normalizedStyle = findEditorClip(next, selectedId)?.clip.style;
      Object.assign(runtimeUpdates, normalizedStyle || updates.style);
    }
    if (updates.text !== undefined) runtimeUpdates.text = updates.text;
    if (updates.muted !== undefined) runtimeUpdates.volume = updates.muted ? 0 : 1;
    if (Object.keys(runtimeUpdates).length && runtimeRef.current) {
      runtimeMutationRef.current = true;
      void runtimeRef.current.updateClip(selectedId, runtimeUpdates).catch(() => {
        runtimeRef.current?.replaceProject(createStudioProject(next));
      });
    }
    commit(next);
  };

  const runCanvasAction = async (action: CanvasAction) => {
    const found = selectedId ? findEditorClip(projectRef.current, selectedId) : null;
    if (!found) return;
    const canvasWidth = projectRef.current.settings.width;
    const canvasHeight = projectRef.current.settings.height;
    const current = constrainTransformToCanvas(
      found.clip.transform,
      canvasWidth,
      canvasHeight,
    );
    let width = current.width;
    let height = current.height;
    if (found.clip.type === "text") {
      const transform = action === "centerClip"
        ? {
          ...current,
          x: (canvasWidth - width) / 2,
          y: (canvasHeight - height) / 2,
        }
        : action === "fitClip"
        ? {
          ...current,
          x: canvasWidth * .1,
          y: Math.min(current.y, canvasHeight - height),
          width: canvasWidth * .8,
        }
        : {
          ...current,
          x: 0,
          y: Math.max(0, canvasHeight - height - canvasHeight * .06),
          width: canvasWidth,
        };
      updateSelected({ transform });
      return;
    }
    if (action !== "centerClip") {
      const scale = action === "fitClip"
        ? Math.min(canvasWidth / width, canvasHeight / height)
        : Math.max(canvasWidth / width, canvasHeight / height);
      width *= scale;
      height *= scale;
    }
    updateSelected({
      transform: {
        ...current,
        x: (canvasWidth - width) / 2,
        y: (canvasHeight - height) / 2,
        width,
        height,
      },
    });
  };

  const deleteSelected = () => {
    if (!selectedId) return;
    const found = findEditorClip(projectRef.current, selectedId);
    let source = projectRef.current;
    if (found?.track.locked) {
      source = updateEditorTrack(source, found.track.id, { locked: false });
    }
    commit(removeEditorClip(source, selectedId));
    setSelectedId("");
  };

  const deleteAsset = (assetId: string) => {
    const current = projectRef.current;
    const next = clone(current);
    next.assets = next.assets.filter((asset) => asset.id !== assetId);
    next.tracks = next.tracks.map((track) => ({
      ...track,
      clips: track.clips.filter((clip) => clip.assetId !== assetId),
    }));
    const selectedClip = selectedId ? findEditorClip(current, selectedId)?.clip : null;
    if (selectedClip?.assetId === assetId) setSelectedId("");
    commit(next);
  };

  const duplicateSelected = () => {
    if (!selected) return;
    addClip(
      selected.clip.type,
      {
        ...clone(selected.clip),
        id: createId("clip"),
        timelineStart: selected.clip.timelineStart + editorClipDuration(selected.clip),
      },
      selected.track.type,
      selected.track.name,
    );
  };

  const splitSelected = () => {
    if (!selected || !["video", "audio"].includes(selected.clip.type)) return;
    const local = time - selected.clip.timelineStart;
    if (local <= .08 || local >= editorClipDuration(selected.clip) - .08) return;
    const splitSource = Number(selected.clip.trimStart) +
      local * Number(selected.clip.speed);
    let next = updateEditorClip(projectRef.current, selectedId, {
      trimEnd: splitSource,
    });
    next = addEditorClip(next, selected.track.id, {
      ...selected.clip,
      id: createId("clip"),
      timelineStart: time,
      trimStart: splitSource,
    }, createId);
    commit(next);
  };

  return {
    selected,
    addAsset,
    activateAsset,
    addText,
    addTransition,
    addEffect,
    updateSelected,
    runCanvasAction,
    deleteSelected,
    deleteAsset,
    duplicateSelected,
    splitSelected,
  };
}

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const createId = (prefix = "item") =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
