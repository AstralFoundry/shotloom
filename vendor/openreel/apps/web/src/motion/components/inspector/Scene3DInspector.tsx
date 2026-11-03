import { editorMessage } from "../../../shotloom-mode";
import type { JSX } from "react";
import { useEffect, useState } from "react";
import {
  MOTION_OBJECT_3D_KINDS,
  type MotionObject3DKind,
  type MotionScene3DLayer,
  type MotionSceneObject3D,
  type MotionSceneVector3,
} from "@openreel/core";
import { Plus, Trash2 } from "@/icons/lucide-compat";
import {
  ColorInput,
  Field,
  NumberInput,
  Section,
  SelectInput,
  Slider,
  TextInput,
} from "../primitives";

interface Scene3DInspectorProps {
  readonly layer: MotionScene3DLayer;
  readonly replaceLayer: (layer: MotionScene3DLayer) => void;
}

const ZERO_VECTOR: MotionSceneVector3 = { x: 0, y: 0, z: 0 };

function Vector3Row({
  label,
  value,
  onChange,
  step = 0.1,
}: {
  readonly label: string;
  readonly value: MotionSceneVector3 | undefined;
  readonly onChange: (next: MotionSceneVector3) => void;
  readonly step?: number;
}): JSX.Element {
  const vec = value ?? ZERO_VECTOR;
  return (
    <Field label={label}>
      <div className="grid grid-cols-3 gap-1.5">
        {(["x", "y", "z"] as const).map((axis) => (
          <NumberInput
            key={axis}
            value={vec[axis]}
            step={step}
            onChange={(next) => onChange({ ...vec, [axis]: next })}
          />
        ))}
      </div>
    </Field>
  );
}

const KIND_LABEL_KEYS = {
  "box": "editor.motion.sceneInspector.kind.box",
  "rounded-box": "editor.motion.sceneInspector.kind.rounded-box",
  "sphere": "editor.motion.sceneInspector.kind.sphere",
  "cylinder": "editor.motion.sceneInspector.kind.cylinder",
  "cone": "editor.motion.sceneInspector.kind.cone",
  "torus": "editor.motion.sceneInspector.kind.torus",
  "icosahedron": "editor.motion.sceneInspector.kind.icosahedron",
  "plane": "editor.motion.sceneInspector.kind.plane",
  "phone": "editor.motion.sceneInspector.kind.phone",
  "model": "editor.motion.sceneInspector.kind.model",
  "text3d": "editor.motion.sceneInspector.kind.text3d",
  "soccer-ball": "editor.motion.sceneInspector.kind.soccer-ball",
  "open-box": "editor.motion.sceneInspector.kind.open-box",
  "room": "editor.motion.sceneInspector.kind.room",
} as const satisfies Record<MotionObject3DKind, Parameters<typeof editorMessage>[0]>;

function kindLabel(kind: MotionObject3DKind): string {
  return Object.hasOwn(KIND_LABEL_KEYS, kind) ? editorMessage(KIND_LABEL_KEYS[kind]) : kind;
}

const makeObjectId = (): string =>
  `scene-obj-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

export function Scene3DInspector({
  layer,
  replaceLayer,
}: Scene3DInspectorProps): JSX.Element {
  const objects = layer.objects ?? [];
  const [activeId, setActiveId] = useState<string>(objects[0]?.id ?? "");

  useEffect(() => {
    if (!objects.some((object) => object.id === activeId)) {
      setActiveId(objects[0]?.id ?? "");
    }
  }, [activeId, objects]);

  const active = objects.find((object) => object.id === activeId) ?? null;

  const updateObjects = (next: readonly MotionSceneObject3D[]): void => {
    replaceLayer({ ...layer, objects: next });
  };

  const patchActive = (patch: Partial<MotionSceneObject3D>): void => {
    if (!active) return;
    updateObjects(
      objects.map((object) =>
        object.id === active.id ? { ...object, ...patch } : object,
      ),
    );
  };

  const patchActiveObject = (
    patch: Partial<MotionSceneObject3D["object"]>,
  ): void => {
    if (!active) return;
    patchActive({ object: { ...active.object, ...patch } });
  };

  const addObject = (): void => {
    const id = makeObjectId();
    updateObjects([
      ...objects,
      {
        id,
        name: editorMessage("editor.motion.sceneInspector.newObject", { count: objects.length + 1 }),
        object: { kind: "rounded-box", size: 0.5 },
        material: {
          kind: "physical",
          color: "#10b981",
          metalness: 0.1,
          roughness: 0.4,
        },
        transform3d: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      },
    ]);
    setActiveId(id);
  };

  const removeObject = (id: string): void => {
    if (objects.length <= 1) return;
    updateObjects(objects.filter((object) => object.id !== id));
  };

  return (
    <>
      <Section title={editorMessage("editor.motion.sceneInspector.objects")} keepOpenInAccordion>
        <div className="space-y-1">
          {objects.map((object) => (
            <div
              key={object.id}
              className={`flex items-center gap-2 rounded-[7px] border px-2 py-1.5 ${
                object.id === activeId
                  ? "border-accent bg-selected"
                  : "border-border bg-bg-1 hover:bg-bg-2"
              }`}
            >
              <button
                type="button"
                onClick={() => setActiveId(object.id)}
                data-shotloom-user-content=""
                className="min-w-0 flex-1 truncate text-left text-[12px] font-medium text-fg-2"
              >
                {object.name ?? kindLabel(object.object.kind)}
              </button>
              {objects.length > 1 ? (
                <button
                  type="button"
                  aria-label={editorMessage("editor.motion.sceneInspector.removeObject", { name: object.name ?? editorMessage("editor.motion.sceneInspector.object") })}
                  onClick={() => removeObject(object.id)}
                  className="shrink-0 text-fg-muted hover:text-status-error"
                >
                  <Trash2 size={13} aria-hidden />
                </button>
              ) : null}
            </div>
          ))}
        </div>
        <button
          type="button"
          aria-label={editorMessage("editor.motion.sceneInspector.addObject")}
          onClick={addObject}
          className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-[7px] border border-dashed border-border-strong py-2 text-[12px] font-medium text-fg-2 hover:text-accent hover:border-accent"
        >
          <Plus size={13} aria-hidden /> {editorMessage("editor.motion.sceneInspector.addObject")}
        </button>
      </Section>

      {active ? (
        <>
        <Section title={editorMessage("editor.motion.sceneInspector.geometry")} keepOpenInAccordion>
          <Field label={editorMessage("editor.motion.sceneInspector.kind")}>
            <SelectInput
              value={active.object.kind}
              options={MOTION_OBJECT_3D_KINDS.map(kind => ({ value: kind, label: kindLabel(kind) }))}
              placeholder={editorMessage("editor.motion.sceneInspector.geometryKind")}
              onChange={(value) =>
                value
                  ? patchActiveObject({ kind: value as MotionObject3DKind })
                  : undefined
              }
            />
          </Field>
          <Field label={editorMessage("editor.motion.properties.size")}>
            <NumberInput
              value={active.object.size ?? 0.5}
              min={0.05}
              max={2}
              step={0.05}
              onChange={(value) => patchActiveObject({ size: value })}
            />
          </Field>
          {active.object.kind === "model" ? (
            <Field label={editorMessage("editor.motion.sceneInspector.modelUrl")}>
              <TextInput
                value={active.object.modelUrl ?? ""}
                onChange={(value) => patchActiveObject({ modelUrl: value })}
                placeholder="https://…/model.glb"
              />
            </Field>
          ) : null}
          {active.object.kind === "text3d" ? (
            <Field label={editorMessage("editor.motion.properties.text")}>
              <TextInput
                value={active.object.text ?? ""}
                onChange={(value) => patchActiveObject({ text: value })}
                placeholder="3D"
              />
            </Field>
          ) : null}
        </Section>

        <Section title={editorMessage("editor.motion.sceneInspector.material")}>
          <Field label={editorMessage("editor.motion.properties.color")}>
            <div role="group" aria-label={editorMessage("editor.motion.sceneInspector.materialColor")}>
              <ColorInput
                value={active.material?.color ?? "#10b981"}
                onChange={(value) =>
                  patchActive({
                    material: { ...active.material, color: value },
                  })
                }
              />
            </div>
          </Field>
          <Field label={editorMessage("editor.motion.sceneInspector.metalness")}>
            <Slider
              value={active.material?.metalness ?? 0.1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({
                  material: { ...active.material, metalness: value },
                })
              }
            />
          </Field>
          <Field label={editorMessage("editor.motion.sceneInspector.roughness")}>
            <Slider
              value={active.material?.roughness ?? 0.4}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({
                  material: { ...active.material, roughness: value },
                })
              }
            />
          </Field>
          <Field label={editorMessage("editor.motion.properties.opacity")}>
            <Slider
              value={active.material?.opacity ?? 1}
              min={0}
              max={1}
              step={0.01}
              onChange={(value) =>
                patchActive({
                  material: { ...active.material, opacity: value },
                })
              }
            />
          </Field>
        </Section>

        <Section title={editorMessage("editor.motion.properties.transform")}>
          <Vector3Row
            label={editorMessage("editor.motion.properties.position")}
            value={active.transform3d?.position}
            onChange={(next) =>
              patchActive({
                transform3d: { ...active.transform3d, position: next },
              })
            }
          />
          <Vector3Row
            label={editorMessage("editor.motion.properties.rotation")}
            value={active.transform3d?.rotation}
            step={1}
            onChange={(next) =>
              patchActive({
                transform3d: { ...active.transform3d, rotation: next },
              })
            }
          />
          <Vector3Row
            label={editorMessage("editor.motion.properties.scale")}
            value={active.transform3d?.scale}
            step={0.05}
            onChange={(next) =>
              patchActive({
                transform3d: { ...active.transform3d, scale: next },
              })
            }
          />
        </Section>
        </>
      ) : null}

      <Section title={editorMessage("editor.motion.properties.camera")}>
        <Field label={editorMessage("editor.motion.sceneInspector.fov")}>
          <div role="group" aria-label={editorMessage("editor.motion.sceneInspector.cameraFov")}>
            <NumberInput
              value={layer.camera?.fov ?? 35}
              min={10}
              max={120}
              step={1}
              onChange={(value) =>
                replaceLayer({
                  ...layer,
                  camera: { ...layer.camera, fov: value },
                })
              }
            />
          </div>
        </Field>
        <Vector3Row
          label={editorMessage("editor.motion.properties.position")}
          value={layer.camera?.position}
          onChange={(next) =>
            replaceLayer({
              ...layer,
              camera: { ...layer.camera, position: next },
            })
          }
        />
        <Vector3Row
          label={editorMessage("editor.motion.sceneInspector.target")}
          value={layer.camera?.target}
          onChange={(next) =>
            replaceLayer({
              ...layer,
              camera: { ...layer.camera, target: next },
            })
          }
        />
      </Section>
    </>
  );
}
