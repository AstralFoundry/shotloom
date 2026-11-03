import { editorMessage } from "../../shotloom-mode";
import type { JSX } from "react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  Box,
  Camera,
  Check,
  CheckCircle2,
  Clapperboard,
  Eye,
  GitBranch,
  Layers3,
  Link2,
  Move3D,
  PackageOpen,
  Palette,
  Play,
  RefreshCw,
  RotateCcw,
  type LucideIcon,
} from "@/icons/lucide-compat";
import { executeTool, type ToolResult } from "@openreel/agent";
import {
  ToolcraftSwitchControl,
  ToolcraftText,
  ToolcraftTextInputControl,
} from "@openreel/ui";
import { useProjectStore } from "../../stores/project-store";
import { getLiveEditorHost, runExclusive } from "../../services/agent/host-singleton";
import { useMotionStore } from "../stores/motion-store";
import type { CreationCameraEditPatch } from "../creation-camera-editing";
import type { CreationObjectEditPatch } from "../creation-object-editing";
import {
  summarizeCreationWorkspace,
  type CreationRenderStatus,
  type CreationWorkspaceAnimationSummary,
  type CreationWorkspaceObjectSummary,
  type CreationWorkspaceRigSummary,
  type CreationWorkspaceSceneSummary,
} from "../creation-workspace";
import type { RecoverableScene3DLayerSummary } from "../creation-recovery";
import { Button, ColorInput, EmptyState, IconButton, PanelHeader } from "./primitives";

const STATUS_META: Record<
  CreationRenderStatus,
  { readonly labelKey: Parameters<typeof editorMessage>[0]; readonly className: string }
> = {
  ready: { labelKey: "editor.creation.status.ready", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  partial: { labelKey: "editor.creation.status.partial", className: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  unbound: { labelKey: "editor.creation.status.unbound", className: "border-slate-500/30 bg-white/5 text-fg-3" },
  "missing-composition": { labelKey: "editor.creation.status.missing-composition", className: "border-red-500/30 bg-red-500/10 text-red-300" },
  "missing-layer": { labelKey: "editor.creation.status.missing-layer", className: "border-red-500/30 bg-red-500/10 text-red-300" },
};

function PanelCopy({
  children,
  className,
  weight,
}: {
  children: ReactNode;
  className?: string;
  weight?: "medium" | "semibold" | "bold";
}): JSX.Element {
  return (
    <ToolcraftText
      type="supporting"
      color="secondary"
      weight={weight}
      className={["block", className].filter(Boolean).join(" ")}
    >
      {children as any}
    </ToolcraftText>
  );
}

export function CreationWorkspacePanel(): JSX.Element {
  const creation = useProjectStore((state) => state.project.creation);
  const motionCompositions = useProjectStore(
    (state) => state.project.motionCompositions ?? [],
  );
  const updateCreationObject = useProjectStore(
    (state) => state.updateCreationObject,
  );
  const updateCreationCamera = useProjectStore(
    (state) => state.updateCreationCamera,
  );
  const recoverMotionScene3DLayer = useProjectStore(
    (state) => state.recoverMotionScene3DLayer,
  );
  const setActiveCompositionId = useMotionStore(
    (state) => state.setActiveCompositionId,
  );
  const selectLayer = useMotionStore((state) => state.selectLayer);
  const setPlayhead = useMotionStore((state) => state.setPlayhead);
  const setLeftTab = useMotionStore((state) => state.setLeftTab);
  const setRightTab = useMotionStore((state) => state.setRightTab);
  const workspace = useMemo(
    () => summarizeCreationWorkspace(creation, motionCompositions),
    [creation, motionCompositions],
  );
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(
    workspace.activeSceneId ?? workspace.scenes[0]?.sceneId ?? null,
  );
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [savingObjectId, setSavingObjectId] = useState<string | null>(null);
  const [savingCameraId, setSavingCameraId] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [recoveringLayerId, setRecoveringLayerId] = useState<string | null>(null);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [syncingSceneId, setSyncingSceneId] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<{
    readonly sceneId: string;
    readonly message: string;
  } | null>(null);

  useEffect(() => {
    if (selectedSceneId && workspace.scenes.some((scene) => scene.sceneId === selectedSceneId)) {
      return;
    }
    setSelectedSceneId(workspace.activeSceneId ?? workspace.scenes[0]?.sceneId ?? null);
  }, [selectedSceneId, workspace.activeSceneId, workspace.scenes]);

  const selectedScene =
    workspace.scenes.find((scene) => scene.sceneId === selectedSceneId) ??
    workspace.scenes[0];

  useEffect(() => {
    if (!selectedScene) {
      setSelectedObjectId(null);
      return;
    }
    if (selectedObjectId && selectedScene.objects.some((object) => object.objectId === selectedObjectId)) {
      return;
    }
    setSelectedObjectId(selectedScene.objects[0]?.objectId ?? null);
  }, [selectedObjectId, selectedScene]);

  const openRenderScene = (scene: CreationWorkspaceSceneSummary) => {
    if (!scene.compositionId || !scene.layerId) return;
    setActiveCompositionId(scene.compositionId);
    selectLayer(scene.layerId);
    setLeftTab("layers");
    setRightTab("properties");
  };

  const cueRenderScene = (scene: CreationWorkspaceSceneSummary, time: number) => {
    openRenderScene(scene);
    setPlayhead(time);
  };

  const recoverSceneLayer = async (layer: RecoverableScene3DLayerSummary) => {
    setRecoveringLayerId(layer.layerId);
    setRecoverError(null);
    try {
      const result = await recoverMotionScene3DLayer(layer.compositionId, layer.layerId);
      if (!result.success) {
        setRecoverError(result.error?.message ?? editorMessage("editor.creation.recoverFailed"));
      }
    } finally {
      setRecoveringLayerId(null);
    }
  };

  const syncSceneToMotion = async (scene: CreationWorkspaceSceneSummary) => {
    setSyncingSceneId(scene.sceneId);
    setSyncError(null);
    try {
      const result = await runExclusive(() =>
        executeTool(
          "sync_creation_scene_to_motion",
          {
            sceneId: scene.sceneId,
            ...(scene.compositionId ? { compositionId: scene.compositionId } : {}),
            ...(scene.layerId ? { layerId: scene.layerId } : {}),
          },
          getLiveEditorHost(),
        ),
      );
      if (!result.ok) {
        setSyncError({
          sceneId: scene.sceneId,
          message: result.error?.message ?? result.summary,
        });
        return;
      }

      const data = resultDataRecord(result);
      const compositionId = optionalString(data?.compositionId) ?? scene.compositionId;
      const layerId = optionalString(data?.layerId) ?? scene.layerId;
      if (compositionId) setActiveCompositionId(compositionId);
      if (layerId) selectLayer(layerId);
      setLeftTab("layers");
      setRightTab("properties");
    } catch (error) {
      setSyncError({
        sceneId: scene.sceneId,
        message: error instanceof Error ? error.message : editorMessage("editor.creation.syncFailed"),
      });
    } finally {
      setSyncingSceneId(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader title={editorMessage("editor.creation.title")} icon={Layers3} />
      <div className="min-h-0 flex-1 space-y-3 overflow-auto p-3">
        {!workspace.available || workspace.sceneCount === 0 ? (
          workspace.recoverableScene3DLayers.length > 0 ? (
            <RecoveryCandidates
              layers={workspace.recoverableScene3DLayers}
              recoveringLayerId={recoveringLayerId}
              error={recoverError}
              onRecover={(layer) => void recoverSceneLayer(layer)}
            />
          ) : (
            <EmptyState
              icon={PackageOpen}
              title={editorMessage("editor.creation.empty")}
              description={editorMessage("editor.creation.emptyHint")}
            />
          )
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <MetricCard label={editorMessage("editor.creation.scenes")} value={workspace.sceneCount} />
              <MetricCard label={editorMessage("editor.creation.assets")} value={workspace.assetCount} />
              <MetricCard
                label={editorMessage("editor.creation.ready")}
                value={workspace.scenes.filter((scene) => scene.renderStatus === "ready").length}
              />
            </div>

            <section className="space-y-2">
              <SectionLabel label={editorMessage("editor.creation.agentScenes")} count={workspace.scenes.length} />
              <div className="space-y-2">
                {workspace.scenes.map((scene) => (
                  <SceneButton
                    key={scene.sceneId}
                    scene={scene}
                    selected={scene.sceneId === selectedScene?.sceneId}
                    onSelect={() => setSelectedSceneId(scene.sceneId)}
                    onOpen={() => openRenderScene(scene)}
                  />
                ))}
              </div>
            </section>

            {workspace.recoverableScene3DLayers.length > 0 ? (
              <RecoveryCandidates
                compact
                layers={workspace.recoverableScene3DLayers}
                recoveringLayerId={recoveringLayerId}
                error={recoverError}
                onRecover={(layer) => void recoverSceneLayer(layer)}
              />
            ) : null}

            {selectedScene ? (
              <section className="space-y-2">
                <SectionLabel label={editorMessage("editor.creation.detail")} count={selectedScene.objectCount} />
                <SceneDetail
                  scene={selectedScene}
                  selectedObjectId={selectedObjectId}
                  savingObjectId={savingObjectId}
                  savingCameraId={savingCameraId}
                  cameraError={cameraError}
                  editError={editError}
                  syncError={
                    syncError?.sceneId === selectedScene.sceneId
                      ? syncError.message
                      : null
                  }
                  syncing={syncingSceneId === selectedScene.sceneId}
                  onOpen={() => openRenderScene(selectedScene)}
                  onSync={() => syncSceneToMotion(selectedScene)}
                  onCueTime={(time) => cueRenderScene(selectedScene, time)}
                  onSelectObject={setSelectedObjectId}
                  onApplyCamera={async (cameraId, patch) => {
                    setSavingCameraId(cameraId);
                    setCameraError(null);
                    try {
                      const result = await updateCreationCamera(selectedScene.sceneId, cameraId, patch);
                      if (!result.success) {
                        setCameraError(result.error?.message ?? editorMessage("editor.creation.updateCameraFailed"));
                      }
                    } finally {
                      setSavingCameraId(null);
                    }
                  }}
                  onApplyObject={async (objectId, patch) => {
                    setSavingObjectId(objectId);
                    setEditError(null);
                    try {
                      const result = await updateCreationObject(selectedScene.sceneId, objectId, patch);
                      if (!result.success) {
                        setEditError(result.error?.message ?? editorMessage("editor.creation.updateObjectFailed"));
                      }
                    } finally {
                      setSavingObjectId(null);
                    }
                  }}
                />
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number;
}): JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-bg-2 px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-fg-muted">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-fg">{value}</div>
    </div>
  );
}

function SceneButton({
  scene,
  selected,
  onSelect,
  onOpen,
}: {
  scene: CreationWorkspaceSceneSummary;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}): JSX.Element {
  const status = STATUS_META[scene.renderStatus];
  const errorCount = scene.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = scene.issues.filter((issue) => issue.severity === "warning").length;
  const canOpen = scene.renderStatus === "ready" || scene.renderStatus === "partial";
  return (
    <div
      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
        selected ? "border-accent bg-accent-soft/70" : "border-border bg-bg-2 hover:bg-hover"
      }`}
    >
      <div className="flex items-start gap-2">
        <Button
          label={scene.name}
          variant="ghost"
          size="sm"
          onClick={onSelect}
          className="flex min-w-0 flex-1 items-start justify-start gap-2 text-left"
        >
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-1 text-fg-3">
            <Box size={15} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[13px] font-semibold text-fg"><span data-shotloom-user-content>{scene.name}</span></span>
              {scene.active ? <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.06em] text-accent">{editorMessage("editor.creation.active")}</span> : null}
            </div>
            <div className="mt-1 text-[10.5px] tabular-nums text-fg-muted">
              {editorMessage("editor.creation.sceneCounts", { objects: scene.objectCount, cameras: scene.cameraCount, animations: scene.animationCount })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusPill label={editorMessage(status.labelKey)} className={status.className} />
              {errorCount > 0 ? <StatusPill label={editorMessage("editor.creation.errorCount", { count: errorCount })} className="border-red-500/30 bg-red-500/10 text-red-300" /> : null}
              {warningCount > 0 ? <StatusPill label={editorMessage("editor.creation.warningCount", { count: warningCount })} className="border-amber-500/30 bg-amber-500/10 text-amber-300" /> : null}
            </div>
          </div>
        </Button>
        <IconButton
          label={canOpen ? editorMessage("editor.creation.openBound") : editorMessage("editor.creation.notBound")}
          icon={<Clapperboard size={15} aria-hidden />}
          size="md"
          variant="ghost"
          isDisabled={!canOpen}
          onClick={onOpen}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-bg-1 hover:text-fg disabled:pointer-events-none disabled:opacity-30"
        />
      </div>
    </div>
  );
}

function RecoveryCandidates({
  layers,
  recoveringLayerId,
  error,
  compact = false,
  onRecover,
}: {
  layers: readonly RecoverableScene3DLayerSummary[];
  recoveringLayerId: string | null;
  error: string | null;
  compact?: boolean;
  onRecover: (layer: RecoverableScene3DLayerSummary) => void;
}): JSX.Element {
  return (
    <section className="space-y-2">
      <SectionLabel
        label={compact ? editorMessage("editor.creation.recoverable") : editorMessage("editor.creation.renderedScenes")}
        count={layers.length}
      />
      {error ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
          {error}
        </div>
      ) : null}
      <div className="space-y-2">
        {layers.map((layer) => {
          const recovering = recoveringLayerId === layer.layerId;
          return (
            <div
              key={`${layer.compositionId}-${layer.layerId}`}
              className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-2.5"
            >
              <div className="flex items-start gap-2">
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-bg-1 text-amber-300">
                  <RotateCcw size={15} />
                </div>
                <div className="min-w-0 flex-1">
                  <PanelCopy className="truncate text-[13px] text-fg" weight="semibold">
                    <span data-shotloom-user-content>{layer.layerName}</span>
                  </PanelCopy>
                  <PanelCopy className="mt-1 truncate text-[10.5px] text-fg-muted">
                    {editorMessage("editor.creation.recoverSummary", { name: layer.compositionName, count: layer.objectCount })}
                  </PanelCopy>
                </div>
                <Button
                  label={recovering ? "..." : editorMessage("editor.creation.recover")}
                  variant="outline"
                  size="sm"
                  disabled={recovering}
                  onClick={() => onRecover(layer)}
                  className="flex h-8 shrink-0 items-center justify-center rounded-md border border-amber-400/30 bg-amber-400/15 px-2.5 text-[11px] font-semibold text-amber-100 transition-colors hover:bg-amber-400/25 disabled:opacity-50"
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SceneDetail({
  scene,
  selectedObjectId,
  savingObjectId,
  savingCameraId,
  cameraError,
  editError,
  syncError,
  syncing,
  onOpen,
  onSync,
  onCueTime,
  onSelectObject,
  onApplyCamera,
  onApplyObject,
}: {
  scene: CreationWorkspaceSceneSummary;
  selectedObjectId: string | null;
  savingObjectId: string | null;
  savingCameraId: string | null;
  cameraError: string | null;
  editError: string | null;
  syncError: string | null;
  syncing: boolean;
  onOpen: () => void;
  onSync: () => Promise<void>;
  onCueTime: (time: number) => void;
  onSelectObject: (objectId: string) => void;
  onApplyCamera: (
    cameraId: string,
    patch: CreationCameraEditPatch,
  ) => Promise<void>;
  onApplyObject: (
    objectId: string,
    patch: CreationObjectEditPatch,
  ) => Promise<void>;
}): JSX.Element {
  const status = STATUS_META[scene.renderStatus];
  const canOpen = scene.renderStatus === "ready" || scene.renderStatus === "partial";
  const camera = scene.cameras.find((candidate) => candidate.active) ?? scene.cameras[0];
  const selectedObject =
    scene.objects.find((object) => object.objectId === selectedObjectId) ??
    scene.objects[0];
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-bg-2">
      <div className="border-b border-border p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <PanelCopy className="truncate text-[13px] text-fg" weight="semibold"><span data-shotloom-user-content>{scene.name}</span></PanelCopy>
            <PanelCopy className="mt-1 text-[10.5px] text-fg-muted">
              {editorMessage("editor.creation.boundSummary", { bound: scene.boundObjectCount, total: scene.objectCount })}
            </PanelCopy>
          </div>
          <StatusPill label={editorMessage(status.labelKey)} className={status.className} />
        </div>
        <Button
          label={editorMessage("editor.creation.openRender")}
          icon={Eye}
          variant="solid"
          size="md"
          disabled={!canOpen}
          onClick={onOpen}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-accent-soft bg-accent-soft px-2.5 py-2 text-[12px] font-semibold text-accent transition-colors hover:bg-accent hover:text-accent-fg disabled:pointer-events-none disabled:border-border disabled:bg-bg-1 disabled:text-fg-muted"
        />
        <Button
          label={
            syncing
              ? editorMessage("editor.creation.syncing")
              : scene.renderStatus === "ready"
                ? editorMessage("editor.creation.refreshRender")
                : editorMessage("editor.creation.syncRender")
          }
          icon={RefreshCw}
          variant="outline"
          size="md"
          disabled={syncing || scene.objectCount === 0}
          onClick={() => void onSync()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md border border-border bg-bg-1 px-2.5 py-2 text-[12px] font-semibold text-fg-2 transition-colors hover:border-accent-soft hover:bg-hover hover:text-fg disabled:pointer-events-none disabled:opacity-45"
        />
        {syncError ? (
          <div className="mt-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
            {syncError}
          </div>
        ) : null}
      </div>

      {scene.issues.length > 0 ? (
        <div className="space-y-1.5 border-b border-border p-3">
          {scene.issues.map((issue) => (
            <div key={`${issue.code}-${issue.message}`} className="flex items-start gap-2 text-[11px] leading-relaxed text-fg-2">
              {issue.severity === "error" ? (
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-red-300" />
              ) : issue.severity === "warning" ? (
                <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-300" />
              ) : (
                <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-sky-300" />
              )}
              <span>{issue.message}</span>
            </div>
          ))}
        </div>
      ) : null}

      {scene.rigs.length > 0 || scene.animations.length > 0 ? (
        <AnimationRigInspector
          animations={scene.animations}
          rigs={scene.rigs}
          onCueTime={onCueTime}
        />
      ) : null}

      {camera ? (
        <CameraEditor
          camera={camera}
          saving={savingCameraId === camera.cameraId}
          error={cameraError}
          onApply={(patch) => onApplyCamera(camera.cameraId, patch)}
        />
      ) : null}

      <div className="max-h-72 overflow-auto p-2">
        {scene.objects.slice(0, 24).map((object) => (
          <ObjectRow
            key={object.objectId}
            object={object}
            selected={object.objectId === selectedObject?.objectId}
            onSelect={() => onSelectObject(object.objectId)}
          />
        ))}
        {scene.objects.length > 24 ? (
          <PanelCopy className="px-2 py-2 text-[11px] text-fg-muted">
            {editorMessage("editor.creation.moreObjects", { count: scene.objects.length - 24 })}
          </PanelCopy>
        ) : null}
      </div>

      {selectedObject ? (
        <ObjectEditor
          key={selectedObject.objectId}
          object={selectedObject}
          saving={savingObjectId === selectedObject.objectId}
          error={editError}
          onApply={(patch) => onApplyObject(selectedObject.objectId, patch)}
        />
      ) : null}
    </div>
  );
}

function AnimationRigInspector({
  animations,
  rigs,
  onCueTime,
}: {
  animations: readonly CreationWorkspaceAnimationSummary[];
  rigs: readonly CreationWorkspaceRigSummary[];
  onCueTime: (time: number) => void;
}): JSX.Element {
  return (
    <div className="space-y-3 border-b border-border p-3">
      {rigs.length > 0 ? (
        <EditorGroup icon={GitBranch} label={editorMessage("editor.creation.rigs")}>
          <div className="space-y-1.5">
            {rigs.map((rig) => (
              <RigRow key={rig.rigId} rig={rig} />
            ))}
          </div>
        </EditorGroup>
      ) : null}

      {animations.length > 0 ? (
        <EditorGroup icon={Activity} label={editorMessage("editor.creation.animation")}>
          <div className="space-y-2">
            {animations.map((clip) => (
              <AnimationClipCard
                key={clip.clipId}
                clip={clip}
                onCueTime={onCueTime}
              />
            ))}
          </div>
        </EditorGroup>
      ) : null}
    </div>
  );
}

function RigRow({ rig }: { rig: CreationWorkspaceRigSummary }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-bg-1 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <PanelCopy className="truncate text-[11.5px] text-fg" weight="semibold"><span data-shotloom-user-content>{rig.name}</span></PanelCopy>
          <PanelCopy className="mt-0.5 truncate text-[10px] text-fg-muted">{rig.rigId}</PanelCopy>
        </div>
        <StatusPill
          label={`${rig.renderedPartCount}/${rig.partCount}`}
          className={
            rig.renderedPartCount === rig.partCount
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusPill
          label={editorMessage("editor.creation.tracks", { count: rig.animatedTrackCount })}
          className="border-sky-500/30 bg-sky-500/10 text-sky-300"
        />
        {rig.bones.slice(0, 5).map((bone) => (
          <span
            key={bone}
            className="rounded bg-bg-2 px-1.5 py-0.5 text-[9.5px] text-fg-muted"
          >
            {bone}
          </span>
        ))}
        {rig.bones.length > 5 ? (
          <span className="rounded bg-bg-2 px-1.5 py-0.5 text-[9.5px] text-fg-muted">
            +{rig.bones.length - 5}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function AnimationClipCard({
  clip,
  onCueTime,
}: {
  clip: CreationWorkspaceAnimationSummary;
  onCueTime: (time: number) => void;
}): JSX.Element {
  const cueTime = clip.firstTime ?? 0;
  const visibleTracks = clip.tracks.slice(0, 6);
  return (
    <div className="rounded-md border border-border bg-bg-1 px-2.5 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <PanelCopy className="truncate text-[11.5px] text-fg" weight="semibold"><span data-shotloom-user-content>{clip.name}</span></PanelCopy>
          <PanelCopy className="mt-0.5 text-[10px] tabular-nums text-fg-muted">
            {editorMessage("editor.creation.clipSummary", { start: formatSeconds(cueTime), end: formatSeconds(clip.lastTime ?? clip.duration), tracks: clip.trackCount, keys: clip.keyframeCount })}
          </PanelCopy>
        </div>
        <IconButton
          label={editorMessage("editor.creation.cue", { name: clip.name })}
          icon={<Play size={13} aria-hidden />}
          size="sm"
          variant="ghost"
          onClick={() => onCueTime(cueTime)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-fg-3 transition-colors hover:bg-hover hover:text-fg"
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <StatusPill
          label={editorMessage("editor.creation.syncedCount", { synced: clip.renderedTrackCount, total: clip.trackCount })}
          className={
            clip.renderedTrackCount === clip.trackCount
              ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
              : "border-amber-500/30 bg-amber-500/10 text-amber-300"
          }
        />
        <StatusPill
          label={editorMessage("editor.creation.objectTracks", { count: clip.objectTrackCount })}
          className="border-slate-500/30 bg-white/5 text-fg-3"
        />
        <StatusPill
          label={editorMessage("editor.creation.cameraTracks", { count: clip.cameraTrackCount })}
          className="border-slate-500/30 bg-white/5 text-fg-3"
        />
      </div>
      <div className="mt-2 space-y-1">
        {visibleTracks.map((track) => (
          <div
            key={track.trackId}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded bg-bg-2 px-2 py-1.5 text-[10px]"
          >
            <div className="min-w-0">
              <PanelCopy className="truncate text-fg-2" weight="medium">
                <span data-shotloom-user-content>{track.targetName ?? track.targetId}</span>
              </PanelCopy>
              <PanelCopy className="mt-0.5 truncate tabular-nums text-fg-muted">
                {editorMessage("editor.creation.trackSummary", { channel: track.channel, count: track.keyframeCount, range: formatTrackRange(track.firstTime, track.lastTime) })}
              </PanelCopy>
            </div>
            <span
              className={`mt-0.5 h-2 w-2 rounded-full ${
                track.rendered
                  ? "bg-emerald-400"
                  : track.targetKind === "missing"
                    ? "bg-red-400"
                    : "bg-amber-300"
              }`}
              title={
                track.rendered
                  ? editorMessage("editor.creation.synced")
                  : track.targetKind === "missing"
                    ? editorMessage("editor.creation.missingTarget")
                    : editorMessage("editor.creation.notRenderBound")
              }
            />
          </div>
        ))}
        {clip.tracks.length > visibleTracks.length ? (
          <PanelCopy className="px-1 py-0.5 text-[10px] text-fg-muted">
            {editorMessage("editor.creation.moreTracks", { count: clip.tracks.length - visibleTracks.length })}
          </PanelCopy>
        ) : null}
      </div>
    </div>
  );
}

function CameraEditor({
  camera,
  saving,
  error,
  onApply,
}: {
  camera: CreationWorkspaceSceneSummary["cameras"][number];
  saving: boolean;
  error: string | null;
  onApply: (patch: CreationCameraEditPatch) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState(() => cameraToDraft(camera));

  useEffect(() => {
    setDraft(cameraToDraft(camera));
  }, [camera]);

  const setField = (field: keyof CameraEditorDraft, value: string | boolean) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const apply = async () => {
    await onApply({
      name: draft.name,
      position: cameraVectorPatch(draft, "position"),
      target: cameraVectorPatch(draft, "target"),
      fov: numberOrUndefined(draft.fov),
      focusDistance: numberOrUndefined(draft.focusDistance),
      depthOfField: draft.depthOfField,
      active: camera.active,
    });
  };

  return (
    <div className="border-b border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <PanelCopy className="truncate text-[12px] text-fg" weight="semibold"><span data-shotloom-user-content>{camera.name}</span></PanelCopy>
          <PanelCopy className="mt-0.5 truncate text-[10px] text-fg-muted">{camera.cameraId}</PanelCopy>
        </div>
        <IconButton
          label={editorMessage("editor.creation.applyCamera")}
          icon={<Check size={15} aria-hidden />}
          size="md"
          variant="primary"
          onClick={() => void apply()}
          isDisabled={saving}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-50"
        />
      </div>

      <div className="mt-3 space-y-3">
        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
            {error}
          </div>
        ) : null}

        <ToolcraftTextInputControl
          label={editorMessage("editor.creation.camera")}
          value={draft.name}
          onChange={(value) => setField("name", value)}
        />

        <EditorGroup icon={Camera} label={editorMessage("editor.creation.lens")}>
          <CameraVectorInputs
            label={editorMessage("editor.creation.position")}
            values={[draft.positionX, draft.positionY, draft.positionZ]}
            fields={["positionX", "positionY", "positionZ"]}
            onChange={setField}
          />
          <CameraVectorInputs
            label={editorMessage("editor.creation.target")}
            values={[draft.targetX, draft.targetY, draft.targetZ]}
            fields={["targetX", "targetY", "targetZ"]}
            onChange={setField}
          />
          <div className="grid grid-cols-3 gap-1.5">
            <ToolcraftTextInputControl
              label={editorMessage("editor.creation.fov")}
              value={draft.fov}
              inputClassName="tabular-nums"
              onChange={(value) => setField("fov", value)}
            />
            <ToolcraftTextInputControl
              label={editorMessage("editor.creation.focus")}
              value={draft.focusDistance}
              inputClassName="tabular-nums"
              onChange={(value) => setField("focusDistance", value)}
            />
            <ToolcraftSwitchControl
              checked={draft.depthOfField}
              label={editorMessage("editor.creation.dof")}
              onCheckedChange={(checked) => setField("depthOfField", checked)}
            />
          </div>
        </EditorGroup>
      </div>
    </div>
  );
}

function ObjectRow({
  object,
  selected,
  onSelect,
}: {
  object: CreationWorkspaceObjectSummary;
  selected: boolean;
  onSelect: () => void;
}): JSX.Element {
  return (
    <Button
      label={object.name}
      variant={selected ? "secondary" : "ghost"}
      size="sm"
      onClick={onSelect}
      className={`flex w-full items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left text-[11.5px] transition-colors ${
        selected ? "bg-accent-soft text-accent" : "hover:bg-hover"
      }`}
    >
      <span className={`h-2 w-2 shrink-0 rounded-full ${object.rendered ? "bg-emerald-400" : "bg-fg-muted"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium text-fg-2"><span data-shotloom-user-content>{object.name}</span></span>
          {object.partId ? <span className="shrink-0 rounded bg-bg-1 px-1.5 py-0.5 text-[9px] text-fg-muted">{object.partId}</span> : null}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-fg-muted">
          {object.missingAsset ? editorMessage("editor.creation.missingAsset") : object.assetId}
          {object.materialId ? ` · ${object.materialId}` : editorMessage("editor.creation.noMaterial")}
        </div>
      </div>
      {object.rendered ? <Link2 size={12} className="shrink-0 text-emerald-300" /> : null}
    </Button>
  );
}

function ObjectEditor({
  object,
  saving,
  error,
  onApply,
}: {
  object: CreationWorkspaceObjectSummary;
  saving: boolean;
  error: string | null;
  onApply: (patch: CreationObjectEditPatch) => Promise<void>;
}): JSX.Element {
  const [draft, setDraft] = useState(() => objectToDraft(object));

  useEffect(() => {
    setDraft(objectToDraft(object));
  }, [object]);

  const setField = (field: keyof ObjectEditorDraft, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const apply = async () => {
    await onApply({
      name: draft.name,
      position: vectorPatch(draft, "position"),
      rotation: vectorPatch(draft, "rotation"),
      scale: vectorPatch(draft, "scale"),
      material: {
        baseColor: draft.baseColor,
        metallic: numberOrUndefined(draft.metallic),
        roughness: numberOrUndefined(draft.roughness),
        opacity: numberOrUndefined(draft.opacity),
      },
    });
  };

  return (
    <div className="border-t border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <PanelCopy className="truncate text-[12px] text-fg" weight="semibold"><span data-shotloom-user-content>{object.name}</span></PanelCopy>
          <PanelCopy className="mt-0.5 truncate text-[10px] text-fg-muted">{object.objectId}</PanelCopy>
        </div>
        <IconButton
          label={editorMessage("editor.creation.applyObject")}
          icon={<Check size={15} aria-hidden />}
          size="md"
          variant="primary"
          onClick={() => void apply()}
          isDisabled={saving}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-fg transition-colors hover:bg-accent/90 disabled:opacity-50"
        />
      </div>

      <div className="mt-3 space-y-3">
        {error ? (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] leading-relaxed text-red-200">
            {error}
          </div>
        ) : null}

        <ToolcraftTextInputControl
          label={editorMessage("editor.creation.name")}
          value={draft.name}
          onChange={(value) => setField("name", value)}
        />

        <EditorGroup icon={Move3D} label={editorMessage("editor.creation.transform")}>
          <VectorInputs
            label={editorMessage("editor.creation.position")}
            values={[draft.positionX, draft.positionY, draft.positionZ]}
            fields={["positionX", "positionY", "positionZ"]}
            onChange={setField}
          />
          <VectorInputs
            label={editorMessage("editor.creation.rotation")}
            values={[draft.rotationX, draft.rotationY, draft.rotationZ]}
            fields={["rotationX", "rotationY", "rotationZ"]}
            onChange={setField}
          />
          <VectorInputs
            label={editorMessage("editor.creation.scale")}
            values={[draft.scaleX, draft.scaleY, draft.scaleZ]}
            fields={["scaleX", "scaleY", "scaleZ"]}
            onChange={setField}
          />
        </EditorGroup>

        <EditorGroup icon={Palette} label={editorMessage("editor.creation.material")}>
          <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
            <span className="text-[10px] font-medium text-fg-muted">{editorMessage("editor.creation.color")}</span>
            <ColorInput
              value={normalizeColorInput(draft.baseColor)}
              onChange={(value) => setField("baseColor", value)}
            />
          </div>
          <ScalarInputs
            values={[draft.metallic, draft.roughness, draft.opacity]}
            fields={["metallic", "roughness", "opacity"]}
            labels={[editorMessage("editor.creation.metallic"), editorMessage("editor.creation.roughness"), editorMessage("editor.creation.opacity")]}
            onChange={setField}
          />
        </EditorGroup>
      </div>
    </div>
  );
}

interface ObjectEditorDraft {
  readonly name: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly rotationX: string;
  readonly rotationY: string;
  readonly rotationZ: string;
  readonly scaleX: string;
  readonly scaleY: string;
  readonly scaleZ: string;
  readonly baseColor: string;
  readonly metallic: string;
  readonly roughness: string;
  readonly opacity: string;
}

interface CameraEditorDraft {
  readonly name: string;
  readonly positionX: string;
  readonly positionY: string;
  readonly positionZ: string;
  readonly targetX: string;
  readonly targetY: string;
  readonly targetZ: string;
  readonly fov: string;
  readonly focusDistance: string;
  readonly depthOfField: boolean;
}

function objectToDraft(object: CreationWorkspaceObjectSummary): ObjectEditorDraft {
  return {
    name: object.name,
    positionX: formatNumber(object.transform.position.x),
    positionY: formatNumber(object.transform.position.y),
    positionZ: formatNumber(object.transform.position.z),
    rotationX: formatNumber(object.transform.rotation.x),
    rotationY: formatNumber(object.transform.rotation.y),
    rotationZ: formatNumber(object.transform.rotation.z),
    scaleX: formatNumber(object.transform.scale.x),
    scaleY: formatNumber(object.transform.scale.y),
    scaleZ: formatNumber(object.transform.scale.z),
    baseColor: object.material?.baseColor ?? "#cbd5e1",
    metallic: formatNumber(object.material?.metallic ?? 0),
    roughness: formatNumber(object.material?.roughness ?? 0.65),
    opacity: formatNumber(object.material?.opacity ?? 1),
  };
}

function cameraToDraft(
  camera: CreationWorkspaceSceneSummary["cameras"][number],
): CameraEditorDraft {
  return {
    name: camera.name,
    positionX: formatNumber(camera.position.x),
    positionY: formatNumber(camera.position.y),
    positionZ: formatNumber(camera.position.z),
    targetX: formatNumber(camera.target.x),
    targetY: formatNumber(camera.target.y),
    targetZ: formatNumber(camera.target.z),
    fov: formatNumber(camera.fov),
    focusDistance:
      camera.focusDistance === undefined ? "" : formatNumber(camera.focusDistance),
    depthOfField: camera.depthOfField === true,
  };
}

function EditorGroup({
  icon: Icon,
  label,
  children,
}: {
  icon: LucideIcon;
  label: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
        <Icon size={12} />
        <span>{label}</span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function VectorInputs({
  label,
  values,
  fields,
  onChange,
}: {
  label: string;
  values: readonly [string, string, string];
  fields: readonly [keyof ObjectEditorDraft, keyof ObjectEditorDraft, keyof ObjectEditorDraft];
  onChange: (field: keyof ObjectEditorDraft, value: string) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
      <span className="text-[10px] font-medium text-fg-muted">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {values.map((value, index) => (
          <ToolcraftTextInputControl
            key={fields[index]}
            ariaLabel={editorMessage("editor.creation.vectorAxis", { label, axis: index + 1 })}
            value={value}
            onChange={(nextValue) => onChange(fields[index], nextValue)}
            inputClassName="h-8 min-w-0 rounded-md border border-border bg-bg-1 px-1.5 text-[11px] tabular-nums text-fg outline-none focus:border-accent"
          />
        ))}
      </div>
    </div>
  );
}

function CameraVectorInputs({
  label,
  values,
  fields,
  onChange,
}: {
  label: string;
  values: readonly [string, string, string];
  fields: readonly [keyof CameraEditorDraft, keyof CameraEditorDraft, keyof CameraEditorDraft];
  onChange: (field: keyof CameraEditorDraft, value: string | boolean) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[2.5rem_1fr] items-center gap-2">
      <span className="text-[10px] font-medium text-fg-muted">{label}</span>
      <div className="grid grid-cols-3 gap-1.5">
        {values.map((value, index) => (
          <ToolcraftTextInputControl
            key={fields[index]}
            ariaLabel={editorMessage("editor.creation.vectorAxis", { label, axis: index + 1 })}
            value={value}
            onChange={(nextValue) => onChange(fields[index], nextValue)}
            inputClassName="h-8 min-w-0 rounded-md border border-border bg-bg-1 px-1.5 text-[11px] tabular-nums text-fg outline-none focus:border-accent"
          />
        ))}
      </div>
    </div>
  );
}

function ScalarInputs({
  labels,
  values,
  fields,
  onChange,
}: {
  labels: readonly [string, string, string];
  values: readonly [string, string, string];
  fields: readonly [keyof ObjectEditorDraft, keyof ObjectEditorDraft, keyof ObjectEditorDraft];
  onChange: (field: keyof ObjectEditorDraft, value: string) => void;
}): JSX.Element {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {values.map((value, index) => (
        <div key={fields[index]} className="min-w-0">
          <ToolcraftTextInputControl
            label={labels[index]}
            value={value}
            onChange={(nextValue) => onChange(fields[index], nextValue)}
            inputClassName="h-8 w-full min-w-0 rounded-md border border-border bg-bg-1 px-1.5 text-[11px] tabular-nums text-fg outline-none focus:border-accent"
          />
        </div>
      ))}
    </div>
  );
}

function vectorPatch(draft: ObjectEditorDraft, prefix: "position" | "rotation" | "scale") {
  return {
    x: numberOrUndefined(draft[`${prefix}X` as keyof ObjectEditorDraft]),
    y: numberOrUndefined(draft[`${prefix}Y` as keyof ObjectEditorDraft]),
    z: numberOrUndefined(draft[`${prefix}Z` as keyof ObjectEditorDraft]),
  };
}

function cameraVectorPatch(draft: CameraEditorDraft, prefix: "position" | "target") {
  return {
    x: numberOrUndefined(String(draft[`${prefix}X` as keyof CameraEditorDraft])),
    y: numberOrUndefined(String(draft[`${prefix}Y` as keyof CameraEditorDraft])),
    z: numberOrUndefined(String(draft[`${prefix}Z` as keyof CameraEditorDraft])),
  };
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3)));
}

function formatSeconds(value: number): string {
  return editorMessage("editor.creation.seconds", { seconds: formatNumber(value) });
}

function formatTrackRange(
  firstTime: number | undefined,
  lastTime: number | undefined,
): string {
  if (firstTime === undefined && lastTime === undefined) return editorMessage("editor.creation.noTime");
  if (firstTime === undefined) return `-${formatSeconds(lastTime ?? 0)}`;
  if (lastTime === undefined || firstTime === lastTime) return formatSeconds(firstTime);
  return `${formatSeconds(firstTime)}-${formatSeconds(lastTime)}`;
}

function resultDataRecord(result: ToolResult): Record<string, unknown> | null {
  return result.data && typeof result.data === "object" && !Array.isArray(result.data)
    ? (result.data as Record<string, unknown>)
    : null;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeColorInput(value: string): string {
  return /^#[0-9a-f]{6}$/i.test(value) ? value : "#cbd5e1";
}

function StatusPill({
  label,
  className,
}: {
  label: string;
  className: string;
}): JSX.Element {
  return (
    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${className}`}>
      {label}
    </span>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }): JSX.Element {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-fg-muted">
        {label}
      </span>
      <span className="rounded-full bg-bg-2 px-2 py-0.5 text-[10px] tabular-nums text-fg-muted">
        {count}
      </span>
    </div>
  );
}
