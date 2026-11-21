import { createPrevisActor, createPrevisCamera, createPrevisLight, createPrevisObject, previsActorProfileForArchetype, PREVIS_ACTOR_COLORS } from "@/lib/previs/previs-scene";
import { previsPrimitiveHalfHeight, previsPropScale, type PrevisPropItem } from "@/lib/previs/previs-prop-library";
import type { PrevisActorArchetype, PrevisActorProfile, PrevisCamera, PrevisLight, PrevisObject, PrevisVec3 } from "@/types/previs";

/**
 * 「添加」弹窗的统一目录：角色模板、灯光预设、机位预设。
 * 弹窗预览与真正加入场景都调用这里的 build 函数，保证「预览看到的 = 加进去的」。
 */

export type PrevisActorTemplate = { id: string; label: string; hint: string; archetype: PrevisActorArchetype; profile?: Partial<PrevisActorProfile> };

export const PREVIS_ACTOR_TEMPLATES: PrevisActorTemplate[] = [
    { id: "std-male", label: "标准男性", hint: "1.90m · 宽肩", archetype: "man" },
    { id: "std-female", label: "标准女性", hint: "1.83m · 窄肩", archetype: "woman" },
    { id: "adult", label: "通用成人", hint: "1.83m", archetype: "adult" },
    { id: "muscular", label: "健硕", hint: "宽肩厚躯干", archetype: "man", profile: { shoulderWidth: 1.32, torsoRatio: 1.12, height: 1.06 } },
    { id: "slim", label: "纤细", hint: "窄肩修长", archetype: "woman", profile: { shoulderWidth: 0.78, torsoRatio: 0.88, height: 0.98 } },
    { id: "elderly", label: "老人", hint: "略矮 · 拄拐", archetype: "elderly" },
    { id: "teen", label: "少年", hint: "1.57m", archetype: "child", profile: { height: 0.86, headRatio: 1.12 } },
    { id: "child", label: "儿童", hint: "1.32m · 大头", archetype: "child" },
    { id: "monster", label: "怪物", hint: "高大 · 带角", archetype: "monster" },
];

export function buildPrevisActorFromTemplate(template: PrevisActorTemplate, input: { index: number; color?: string }): PrevisObject {
    const color = input.color ?? PREVIS_ACTOR_COLORS[input.index % PREVIS_ACTOR_COLORS.length];
    const actor = createPrevisActor(`${template.label} ${input.index + 1}`, [0, 0, 0], color, template.archetype);
    return { ...actor, actorProfile: { ...previsActorProfileForArchetype(template.archetype), ...(template.profile || {}) } };
}

export function buildPrevisPropObject(prop: PrevisPropItem, color = "#8795a5"): PrevisObject {
    const scale = previsPropScale(prop);
    const base = createPrevisObject(prop.primitive, prop.name, [0, 0, 0], color);
    const transform = { ...base.transform, scale };
    const y = previsPrimitiveHalfHeight({ kind: "primitive", primitive: prop.primitive, transform }) ?? 0;
    return { ...base, transform: { ...transform, position: [0, y, 0] } };
}

export type PrevisLightPreset = { id: string; label: string; hint: string; type: PrevisLight["type"]; position: PrevisVec3; intensity: number; color?: string };

export const PREVIS_LIGHT_PRESETS: PrevisLightPreset[] = [
    { id: "key", label: "主光（方向光）", hint: "模拟太阳或主灯，产生清晰阴影", type: "directional", position: [4, 6, 4], intensity: 2.4 },
    { id: "point", label: "点光源", hint: "灯泡、台灯，向四周发光", type: "point", position: [2, 3, 2], intensity: 1.5 },
    { id: "spot", label: "聚光灯", hint: "舞台追光，锥形照射", type: "spot", position: [2, 4, 2], intensity: 2 },
    { id: "warm", label: "暖色补光", hint: "侧面暖光，柔化阴影", type: "point", position: [-3, 2.2, 1.5], intensity: 1.2, color: "#ffc58a" },
    { id: "rim", label: "冷色轮廓光", hint: "从背后勾出人物轮廓", type: "spot", position: [0, 3.2, -3.5], intensity: 2.2, color: "#9cc7ff" },
    { id: "ambient", label: "环境光", hint: "整体提亮，没有方向和阴影", type: "ambient", position: [0, 0, 0], intensity: 0.65 },
];

export function buildPrevisLightFromPreset(preset: PrevisLightPreset, index: number): PrevisLight {
    const light = createPrevisLight(preset.type, `${preset.label.replace(/（.*）/, "")} ${index + 1}`, preset.position, preset.intensity);
    return preset.color ? { ...light, color: preset.color } : light;
}

export type PrevisCameraPreset = { id: string; label: string; hint: string; position: PrevisVec3; target: PrevisVec3; focalLength: number; fromCurrentView?: boolean };

export const PREVIS_CAMERA_PRESETS: PrevisCameraPreset[] = [
    { id: "current", label: "当前视角", hint: "用视口此刻的角度建机位", position: [4.8, 2.7, 6.8], target: [0, 1, 0], focalLength: 35, fromCurrentView: true },
    { id: "front-medium", label: "正面中景", hint: "腰部以上，最常用", position: [0, 1.4, 4], target: [0, 1.2, 0], focalLength: 35 },
    { id: "front-cu", label: "正面特写", hint: "面部表情", position: [0, 1.62, 1.6], target: [0, 1.6, 0], focalLength: 50 },
    { id: "front-wide", label: "正面全景", hint: "交代全身与环境", position: [0, 2, 7.5], target: [0, 1, 0], focalLength: 24 },
    { id: "side", label: "侧面跟拍", hint: "侧向运动", position: [3.8, 1.4, 0], target: [0, 1, 0], focalLength: 35 },
    { id: "ots", label: "过肩镜头", hint: "对话正反打", position: [-1.1, 1.75, 2.2], target: [0.6, 1.6, 0], focalLength: 40 },
    { id: "high-45", label: "45° 俯拍", hint: "压迫感、交代站位", position: [3, 4.5, 4.5], target: [0, 0.8, 0], focalLength: 28 },
    { id: "low", label: "低角度仰拍", hint: "人物显得高大", position: [0, 0.35, 3.5], target: [0, 1.8, 0], focalLength: 28 },
    { id: "bird", label: "鸟瞰", hint: "正上方俯视", position: [0, 9, 0.1], target: [0, 0, 0], focalLength: 20 },
];

/** 预设焦段换算水平视场角，与检查器焦距输入同一公式。 */
export function previsFovFromFocalLength(focalLength: number) {
    return (2 * Math.atan(36 / (2 * focalLength)) * 180) / Math.PI;
}

export function buildPrevisCameraFromPreset(preset: PrevisCameraPreset, index: number, currentView?: { position: PrevisVec3; rotation: PrevisVec3 } | null): PrevisCamera {
    const camera = createPrevisCamera(`${preset.label} ${index + 1}`);
    const position = preset.fromCurrentView && currentView ? currentView.position : preset.position;
    const rotation = preset.fromCurrentView && currentView ? currentView.rotation : ([0, 0, 0] as PrevisVec3);
    return { ...camera, transform: { position, rotation, scale: [1, 1, 1] }, target: preset.target, focalLength: preset.focalLength, fov: previsFovFromFocalLength(preset.focalLength) };
}
