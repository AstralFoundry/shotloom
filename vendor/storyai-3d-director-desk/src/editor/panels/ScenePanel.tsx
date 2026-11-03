import { t } from '../../i18n';
import { useEffect, useState } from "react";
import { ImageOff } from "lucide-react";
import { Trash2 } from "lucide-react";
import {
  InspectorAxisGroup,
  InspectorColorField,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorSection,
} from "./InspectorControls";
import { useDirectorStore } from "../store/directorStore";

const PANORAMA_RADIUS_MIN = 10;
const PANORAMA_RADIUS_MAX = 300;
const PANORAMA_YAW_MIN = -180;
const PANORAMA_YAW_MAX = 180;
const SCENE_SCALE_MIN = 0.1;
const SCENE_SCALE_MAX = 3;
const GROUND_HEIGHT_MIN = -5;
const GROUND_HEIGHT_MAX = 5;

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function ScenePanel() {
  const scene = useDirectorStore((state) => state.project.scene);
  const assets = useDirectorStore((state) => state.project.assets);
  const panoramaAssetId = useDirectorStore((state) => state.project.panoramaAssetId);
  const updateScene = useDirectorStore((state) => state.updateScene);
  const removePanoramaAsset = useDirectorStore((state) => state.removePanoramaAsset);
  const [sceneScaleDraft, setSceneScaleDraft] = useState(String(scene.scale));
  const [panoramaYawDraft, setPanoramaYawDraft] = useState(String(scene.panoramaYaw));
  const [panoramaRadiusDraft, setPanoramaRadiusDraft] = useState(String(scene.panoramaRadius));
  const [groundHeightDraft, setGroundHeightDraft] = useState(String(scene.groundHeight));
  const panoramaAsset = assets.find((item) => item.id === panoramaAssetId);

  useEffect(() => {
    setSceneScaleDraft(String(scene.scale));
  }, [scene.scale]);

  useEffect(() => {
    setPanoramaRadiusDraft(String(scene.panoramaRadius));
  }, [scene.panoramaRadius]);

  useEffect(() => {
    setPanoramaYawDraft(String(scene.panoramaYaw));
  }, [scene.panoramaYaw]);

  useEffect(() => {
    setGroundHeightDraft(String(scene.groundHeight));
  }, [scene.groundHeight]);

  function commitSceneScale(value: string) {
    const parsed = Number(value);
    const nextScale = Number.isFinite(parsed) ? clampNumber(parsed, SCENE_SCALE_MIN, SCENE_SCALE_MAX) : scene.scale;
    updateScene({ scale: nextScale });
    setSceneScaleDraft(String(nextScale));
  }

  function commitPanoramaYaw(value: string) {
    const parsed = Number(value);
    const nextYaw = Number.isFinite(parsed) ? clampNumber(parsed, PANORAMA_YAW_MIN, PANORAMA_YAW_MAX) : scene.panoramaYaw;
    updateScene({ panoramaYaw: nextYaw });
    setPanoramaYawDraft(String(nextYaw));
  }

  function commitPanoramaRadius(value: string) {
    const parsed = Number(value);
    const nextRadius = Number.isFinite(parsed)
      ? clampNumber(parsed, PANORAMA_RADIUS_MIN, PANORAMA_RADIUS_MAX)
      : scene.panoramaRadius;
    updateScene({ panoramaRadius: nextRadius });
    setPanoramaRadiusDraft(String(nextRadius));
  }

  function commitGroundHeight(value: string) {
    const parsed = Number(value);
    const nextHeight = Number.isFinite(parsed) ? clampNumber(parsed, GROUND_HEIGHT_MIN, GROUND_HEIGHT_MAX) : scene.groundHeight;
    updateScene({ groundHeight: nextHeight });
    setGroundHeightDraft(String(nextHeight));
  }

  return (
    <InspectorPanel title={t("ui.ScenePanel.title.f842bf09")} ariaLabel={t("ui.ScenePanel.ariaLabel.34876bc3")} className="scene-inspector">
      <InspectorRangeNumberField
        label={t("ui.ScenePanel.label.7be2f77a")}
        rangeAriaLabel={t("ui.ScenePanel.rangeAriaLabel.a403fef6")}
        numberAriaLabel={t("ui.ScenePanel.label.7be2f77a")}
        max={SCENE_SCALE_MAX}
        min={SCENE_SCALE_MIN}
        step="0.01"
        value={sceneScaleDraft}
        onValueChange={commitSceneScale}
        onRangeChange={commitSceneScale}
        onNumberBlur={commitSceneScale}
        onNumberChange={(value) => {
          setSceneScaleDraft(value);
          if (value !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
              updateScene({ scale: parsed });
            }
          }
        }}
      />
      <InspectorAxisGroup
        label={t("ui.ScenePanel.label.67c8209c")}
        axes={[
          {
            axis: "X",
            ariaLabel: t("ui.ScenePanel.ariaLabel.67889f2c"),
            step: "0.1",
            value: scene.position[0],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: t("ui.ScenePanel.ariaLabel.e1a84cd8"),
            step: "0.1",
            value: scene.position[1],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: t("ui.ScenePanel.ariaLabel.187878e7"),
            step: "0.1",
            value: scene.position[2],
            onChange: (value) => updateScene({ position: replaceAxis(scene.position, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorAxisGroup
        label={t("ui.ScenePanel.label.4321b836")}
        axes={[
          {
            axis: "X",
            ariaLabel: t("ui.ScenePanel.ariaLabel.ea6e3905"),
            step: "1",
            value: scene.rotation[0],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 0, Number(value)) }),
          },
          {
            axis: "Y",
            ariaLabel: t("ui.ScenePanel.ariaLabel.de0776cc"),
            step: "1",
            value: scene.rotation[1],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 1, Number(value)) }),
          },
          {
            axis: "Z",
            ariaLabel: t("ui.ScenePanel.ariaLabel.5d1c8eb7"),
            step: "1",
            value: scene.rotation[2],
            onChange: (value) => updateScene({ rotation: replaceAxis(scene.rotation, 2, Number(value)) }),
          },
        ]}
      />
      <InspectorSection title={t("ui.ScenePanel.title.2fea7acd")}>
        {panoramaAsset ? (
          <div className="panorama-thumbnail-card" aria-label={t("ui.ScenePanel.arialabel.48724246")}>
            <button
              aria-label={t("ui.ScenePanel.arialabel.2462007a")}
              className="panorama-thumbnail-delete"
              type="button"
              onClick={() => removePanoramaAsset()}
            >
              <Trash2 aria-hidden="true" size={14} strokeWidth={1.9} />
            </button>
            <img className="panorama-thumbnail-image" alt={t("ui.ScenePanel.text.ee63660f", { value0: panoramaAsset.fileName })} src={panoramaAsset.url} />
            <span className="panorama-thumbnail-name">{panoramaAsset.fileName}</span>
          </div>
        ) : (
          <div className="panorama-empty-card" aria-label={t("ui.ScenePanel.arialabel.d68a7326")}>
            <span className="panorama-empty-icon" data-testid="panorama-empty-icon">
              <ImageOff aria-hidden="true" size={16} strokeWidth={1.8} />
            </span>
            <span>{t("ui.ScenePanel.text.96a06500")}</span>
          </div>
        )}
        <InspectorColorField
          label={t("ui.ScenePanel.label.ca769ffa")}
          colorAriaLabel={t("ui.ScenePanel.label.ca769ffa")}
          hexAriaLabel={t("ui.ScenePanel.hexAriaLabel.e8103842")}
          value={scene.backgroundColor}
          onColorChange={(value) => updateScene({ backgroundColor: value })}
          onHexChange={(value) => updateScene({ backgroundColor: value })}
        />
      </InspectorSection>
      <InspectorSection title={t("ui.ScenePanel.title.aee6925a")}>
        <InspectorRangeNumberField
          label={t("ui.ScenePanel.label.09d7dd8d")}
          rangeAriaLabel={t("ui.ScenePanel.rangeAriaLabel.35361dc3")}
          numberAriaLabel={t("ui.ScenePanel.numberAriaLabel.734f73a2")}
          max={PANORAMA_YAW_MAX}
          min={PANORAMA_YAW_MIN}
          step="1"
          value={panoramaYawDraft}
          onValueChange={commitPanoramaYaw}
          onRangeChange={commitPanoramaYaw}
          onNumberBlur={commitPanoramaYaw}
          onNumberChange={(value) => {
            setPanoramaYawDraft(value);
            if (value !== "") {
              const parsed = Number(value);
              if (Number.isFinite(parsed)) {
                updateScene({ panoramaYaw: parsed });
              }
            }
          }}
        />
        <InspectorRangeNumberField
          label={t("ui.ScenePanel.label.0ba95cb8")}
          rangeAriaLabel={t("ui.ScenePanel.rangeAriaLabel.a72c2364")}
          numberAriaLabel={t("ui.ScenePanel.numberAriaLabel.d8ea954c")}
          max={PANORAMA_RADIUS_MAX}
          min={PANORAMA_RADIUS_MIN}
          step="1"
          value={panoramaRadiusDraft}
          onValueChange={commitPanoramaRadius}
          onRangeChange={commitPanoramaRadius}
          onNumberBlur={commitPanoramaRadius}
          onNumberChange={(value) => {
            setPanoramaRadiusDraft(value);
            if (value !== "") {
              const parsed = Number(value);
              if (Number.isFinite(parsed)) {
                updateScene({ panoramaRadius: parsed });
              }
            }
          }}
        />
      </InspectorSection>
      <InspectorSection title={t("ui.ScenePanel.title.c8de4663")}>
        <div className="scene-switch-row" role="group" aria-label={t("ui.ScenePanel.arialabel.b05f458a")}>
          <div className="inspector-toggle-row">
            <input
              aria-label={t("ui.ScenePanel.arialabel.f6bae6b5")}
              checked={scene.showLabels}
              type="checkbox"
              onChange={(event) => updateScene({ showLabels: event.target.checked })}
            />
            <span>{t("ui.ScenePanel.arialabel.f6bae6b5")}</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label={t("ui.ScenePanel.arialabel.04c1861e")}
              checked={scene.snapToGrid}
              type="checkbox"
              onChange={(event) => updateScene({ snapToGrid: event.target.checked })}
            />
            <span>{t("ui.ScenePanel.arialabel.04c1861e")}</span>
          </div>
          <div className="inspector-toggle-row">
            <input
              aria-label={t("ui.ScenePanel.arialabel.41d50b0d")}
              checked={scene.showGround}
              type="checkbox"
              onChange={(event) => updateScene({ showGround: event.target.checked })}
            />
            <span>{t("ui.ScenePanel.arialabel.41d50b0d")}</span>
          </div>
        </div>
      </InspectorSection>
      {scene.showGround ? (
        <InspectorSection title={t("ui.ScenePanel.arialabel.41d50b0d")}>
          <InspectorRangeNumberField
            label={t("ui.ImageWatermarkEditor.label.61b101b5")}
            rangeAriaLabel={t("ui.ScenePanel.rangeAriaLabel.bdce3493")}
            numberAriaLabel={t("ui.ScenePanel.numberAriaLabel.ee56b77f")}
            max="1"
            min="0"
            step="0.01"
            value={scene.groundOpacity}
            onValueChange={(value) => updateScene({ groundOpacity: Number(value) })}
          />
          <InspectorRangeNumberField
            label={t("ui.ScenePanel.label.eea51aa4")}
            rangeAriaLabel={t("ui.ScenePanel.rangeAriaLabel.48367f31")}
            numberAriaLabel={t("ui.ScenePanel.numberAriaLabel.7fcdee32")}
            max={GROUND_HEIGHT_MAX}
            min={GROUND_HEIGHT_MIN}
            step="0.1"
            value={groundHeightDraft}
            onValueChange={commitGroundHeight}
            onRangeChange={commitGroundHeight}
            onNumberBlur={commitGroundHeight}
            onNumberChange={(value) => {
              setGroundHeightDraft(value);
              if (value !== "") {
                const parsed = Number(value);
                if (Number.isFinite(parsed)) {
                  updateScene({ groundHeight: parsed });
                }
              }
            }}
          />
        </InspectorSection>
      ) : null}
    </InspectorPanel>
  );
}
