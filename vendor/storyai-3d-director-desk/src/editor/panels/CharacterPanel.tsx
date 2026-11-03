import { t } from '../../i18n';
import { useMemo, useState } from "react";
import {
  InspectorAxisGroup,
  InspectorColorField,
  InspectorPanel,
  InspectorRangeNumberField,
  InspectorTextField,
  InspectorSection,
} from "./InspectorControls";
import { MANNEQUIN_POSE_PRESETS } from "../presets/mannequinPosePresets";
import { getCrowdAnchorTransform, useDirectorStore } from "../store/directorStore";

function replaceAxis(tuple: [number, number, number], axis: 0 | 1 | 2, value: number): [number, number, number] {
  return tuple.map((item, index) => (index === axis ? value : item)) as [number, number, number];
}

export function CharacterPanel() {
  const [activeTab, setActiveTab] = useState<"properties" | "pose">("properties");
  const selectedCrowdId = useDirectorStore((state) => state.selectedCrowdId);
  const selectedObjectId = useDirectorStore((state) => state.selectedObjectId);
  const objects = useDirectorStore((state) => state.project.objects);
  const updateObjectName = useDirectorStore((state) => state.updateObjectName);
  const updateCrowdLabel = useDirectorStore((state) => state.updateCrowdLabel);
  const updateObjectTransform = useDirectorStore((state) => state.updateObjectTransform);
  const updateCrowdTransform = useDirectorStore((state) => state.updateCrowdTransform);
  const updateUniformScale = useDirectorStore((state) => state.updateUniformScale);
  const updateCrowdUniformScale = useDirectorStore((state) => state.updateCrowdUniformScale);
  const updateObjectColor = useDirectorStore((state) => state.updateObjectColor);
  const updateCrowdColor = useDirectorStore((state) => state.updateCrowdColor);
  const applyPosePreset = useDirectorStore((state) => state.applyPosePreset);
  const applyCrowdPosePreset = useDirectorStore((state) => state.applyCrowdPosePreset);
  const updatePoseControl = useDirectorStore((state) => state.updatePoseControl);
  const updateCrowdPoseControl = useDirectorStore((state) => state.updateCrowdPoseControl);

  const selection = useMemo(() => {
    const role = objects.find((item) => item.id === selectedObjectId && item.kind === "character");

    if (selectedCrowdId) {
      const crowdMembers = objects.filter((item) => item.kind === "character" && item.crowdId === selectedCrowdId);
      const crowdAnchor = getCrowdAnchorTransform(objects, selectedCrowdId);
      const primaryRole = crowdMembers[crowdMembers.length - 1] ?? crowdMembers[0];

      if (primaryRole && crowdAnchor) {
        return {
          mode: "crowd" as const,
          crowdId: selectedCrowdId,
          crowdMembers,
          crowdAnchor,
          role: primaryRole,
          name: crowdMembers[0]?.crowdLabel ?? t("ui.CharacterPanel.text.a30c0bdb"),
          color: crowdMembers[0]?.color ?? "#4F8EF7",
        };
      }
    }

    if (!role) return null;

    return {
      mode: "single" as const,
      crowdId: null,
      crowdMembers: [role],
      crowdAnchor: role.transform,
      role,
      name: role.name,
      color: role.color ?? "#4F8EF7",
    };
  }, [objects, selectedCrowdId, selectedObjectId]);

  if (!selection) return null;

  const role = selection.role;
  const roleColor = selection.color;
  const transform = selection.crowdAnchor;
  const isCrowd = selection.mode === "crowd";
  const poseGroups = [
    {
      title: t("ui.CharacterPanel.title.720c230f"),
      controls: [
        { key: "body.pitch", label: t("ui.CharacterPanel.label.4d8778f8") },
        { key: "body.yaw", label: t("ui.CharacterPanel.label.823733fd") },
        { key: "body.roll", label: t("ui.CharacterPanel.label.225c3931") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.31080ed2"),
      controls: [
        { key: "torso.pitch", label: t("ui.CharacterPanel.label.4d8778f8") },
        { key: "torso.yaw", label: t("ui.CharacterPanel.label.bc65e1db") },
        { key: "torso.roll", label: t("ui.CharacterPanel.label.225c3931") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.60c0c884"),
      controls: [
        { key: "head.pitch", label: t("ui.CharacterPanel.label.0ab2eded") },
        { key: "head.yaw", label: t("ui.CharacterPanel.label.0ec976e2") },
        { key: "head.roll", label: t("ui.CharacterPanel.label.e8ba5b22") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.e4303cc3"),
      controls: [
        { key: "leftShoulder.pitch", label: t("ui.CharacterPanel.label.ba35c4d9") },
        { key: "leftShoulder.spread", label: t("ui.CharacterPanel.label.fba6115f") },
        { key: "leftShoulder.twist", label: t("ui.CharacterPanel.label.bc65e1db") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.dbe3dbc0"),
      controls: [
        { key: "rightShoulder.pitch", label: t("ui.CharacterPanel.label.ba35c4d9") },
        { key: "rightShoulder.spread", label: t("ui.CharacterPanel.label.fba6115f") },
        { key: "rightShoulder.twist", label: t("ui.CharacterPanel.label.bc65e1db") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.f7367acd"),
      controls: [{ key: "leftElbow.bend", label: t("ui.CharacterPanel.label.a284cb04") }],
    },
    {
      title: t("ui.CharacterPanel.title.5cfc578a"),
      controls: [{ key: "rightElbow.bend", label: t("ui.CharacterPanel.label.a284cb04") }],
    },
    {
      title: t("ui.CharacterPanel.title.ffe5545d"),
      controls: [
        { key: "leftHip.pitch", label: t("ui.CharacterPanel.label.8bc725e1") },
        { key: "leftHip.spread", label: t("ui.CharacterPanel.label.fba6115f") },
        { key: "leftHip.twist", label: t("ui.CharacterPanel.label.bc65e1db") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.58cbedb1"),
      controls: [
        { key: "rightHip.pitch", label: t("ui.CharacterPanel.label.8bc725e1") },
        { key: "rightHip.spread", label: t("ui.CharacterPanel.label.fba6115f") },
        { key: "rightHip.twist", label: t("ui.CharacterPanel.label.bc65e1db") },
      ],
    },
    {
      title: t("ui.CharacterPanel.title.6770be38"),
      controls: [{ key: "leftKnee.bend", label: t("ui.CharacterPanel.label.a284cb04") }],
    },
    {
      title: t("ui.CharacterPanel.title.2988fcfc"),
      controls: [{ key: "rightKnee.bend", label: t("ui.CharacterPanel.label.a284cb04") }],
    },
  ] as const;

  return (
    <InspectorPanel
      title={t("ui.CanvasNodeToolbar.character.6b26695e")}
      ariaLabel={t("ui.CharacterPanel.ariaLabel.a24122b4")}
      className="character-inspector"
      tabs={[
        { label: t("ui.CameraPanel.label.7d3c35c2"), active: activeTab === "properties", onClick: () => setActiveTab("properties") },
        { label: t("ui.CharacterPanel.label.a9605fdd"), active: activeTab === "pose", onClick: () => setActiveTab("pose") },
      ]}
    >
      {activeTab === "properties" ? (
        <>
          <InspectorTextField
            label={t("ui.CatalogEditorDialogs.text.1be7ae4f")}
            ariaLabel={t("ui.CharacterPanel.ariaLabel.3aa1f085")}
            value={selection.name}
            onChange={(value) => {
              if (isCrowd && selection.crowdId) {
                updateCrowdLabel(selection.crowdId, value);
                return;
              }

              updateObjectName(role.id, value);
            }}
          />
          <InspectorAxisGroup
            label={t("ui.PropPanel.label.88c34452")}
            axes={[
              {
                axis: "X",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.598270bc"),
                value: transform.position[0],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        position: replaceAxis(transform.position, 0, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        position: replaceAxis(transform.position, 0, Number(value)),
                      }),
              },
              {
                axis: "Y",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.0e06f92d"),
                value: transform.position[1],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        position: replaceAxis(transform.position, 1, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        position: replaceAxis(transform.position, 1, Number(value)),
                      }),
              },
              {
                axis: "Z",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.da0e9008"),
                value: transform.position[2],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        position: replaceAxis(transform.position, 2, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        position: replaceAxis(transform.position, 2, Number(value)),
                      }),
              },
            ]}
          />
          <InspectorAxisGroup
            label={t("ui.ImageWatermarkEditor.label.a69e51e5")}
            axes={[
              {
                axis: "X",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.38bf25cc"),
                value: transform.rotation[0],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        rotation: replaceAxis(transform.rotation, 0, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        rotation: replaceAxis(transform.rotation, 0, Number(value)),
                      }),
              },
              {
                axis: "Y",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.2e0c3550"),
                value: transform.rotation[1],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        rotation: replaceAxis(transform.rotation, 1, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        rotation: replaceAxis(transform.rotation, 1, Number(value)),
                      }),
              },
              {
                axis: "Z",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.e9d65b53"),
                value: transform.rotation[2],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        rotation: replaceAxis(transform.rotation, 2, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        rotation: replaceAxis(transform.rotation, 2, Number(value)),
                      }),
              },
            ]}
          />
          <InspectorAxisGroup
            label={t("ui.ViewportToolbar.label.12e2ed4d")}
            axes={[
              {
                axis: "X",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.73de2c1f"),
                step: "0.01",
                value: transform.scale[0],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        scale: replaceAxis(transform.scale, 0, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        scale: replaceAxis(transform.scale, 0, Number(value)),
                      }),
              },
              {
                axis: "Y",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.12d52d51"),
                step: "0.01",
                value: transform.scale[1],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        scale: replaceAxis(transform.scale, 1, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        scale: replaceAxis(transform.scale, 1, Number(value)),
                      }),
              },
              {
                axis: "Z",
                ariaLabel: t("ui.CharacterPanel.ariaLabel.12d7678d"),
                step: "0.01",
                value: transform.scale[2],
                onChange: (value) =>
                  isCrowd && selection.crowdId
                    ? updateCrowdTransform(selection.crowdId, {
                        scale: replaceAxis(transform.scale, 2, Number(value)),
                      })
                    : updateObjectTransform(role.id, {
                        scale: replaceAxis(transform.scale, 2, Number(value)),
                      }),
              },
            ]}
          />
          <InspectorRangeNumberField
            label={t("ui.PropPanel.label.e1c2fa74")}
            rangeAriaLabel={t("ui.CharacterPanel.rangeAriaLabel.69f279a0")}
            numberAriaLabel={t("ui.CharacterPanel.numberAriaLabel.dc383dbd")}
            max="3"
            min="0.2"
            step="0.01"
            value={transform.scale[0]}
            onValueChange={(value) =>
              isCrowd && selection.crowdId
                ? updateCrowdUniformScale(selection.crowdId, Number(value))
                : updateUniformScale(role.id, Number(value))
            }
          />
          <InspectorColorField
            label={t("ui.ImageWatermarkEditor.text.8ef48860")}
            colorAriaLabel={t("ui.CharacterPanel.colorAriaLabel.3f5e2db3")}
            hexAriaLabel={t("ui.CharacterPanel.hexAriaLabel.5e5b7c2d")}
            value={roleColor}
            onColorChange={(value) =>
              isCrowd && selection.crowdId ? updateCrowdColor(selection.crowdId, value) : updateObjectColor(role.id, value)
            }
            onHexChange={(value) =>
              isCrowd && selection.crowdId ? updateCrowdColor(selection.crowdId, value) : updateObjectColor(role.id, value)
            }
          />
        </>
      ) : (
        <InspectorSection title={t("ui.CharacterPanel.title.5f50f78f")} className="pose-preset-section">
          {role.characterRig ? (
            <>
              <div className="preset-grid">
                {MANNEQUIN_POSE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    className={role.characterRig?.posePresetId === preset.id ? "is-active" : undefined}
                    type="button"
                    onClick={() =>
                      isCrowd && selection.crowdId
                        ? applyCrowdPosePreset(selection.crowdId, preset.id)
                        : applyPosePreset(role.id, preset.id)
                    }
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <InspectorSection title={t("ui.CharacterPanel.title.20dfe16a")} className="pose-adjust-section">
                <div className="pose-groups">
                  {poseGroups.map((group) => (
                    <section key={group.title} className="pose-group">
                      <h4>{group.title}</h4>
                      {group.controls.map((control) => (
                        <InspectorRangeNumberField
                          key={control.key}
                          label={control.label}
                          rangeAriaLabel={t("ui.CharacterPanel.text.8d71f4d9", { value0: group.title, value1: control.label })}
                          numberAriaLabel={`${group.title} · ${control.label}`}
                          max="90"
                          min="-90"
                          step="1"
                          value={role.characterRig?.controls[control.key] ?? 0}
                          onValueChange={(value) =>
                            isCrowd && selection.crowdId
                              ? updateCrowdPoseControl(selection.crowdId, control.key, Number(value))
                              : updatePoseControl(role.id, control.key, Number(value))
                          }
                        />
                      ))}
                    </section>
                  ))}
                </div>
              </InspectorSection>
            </>
          ) : (
            <p>{t("ui.CharacterPanel.text.38825c2b")}</p>
          )}
        </InspectorSection>
      )}
    </InspectorPanel>
  );
}
