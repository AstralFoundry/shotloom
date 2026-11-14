import type { CameraConfig, Clip } from '@/core/model.ts';
import type { LightConfig, LightingConfig } from '@/core/lighting/model.ts';

/**
 * Field catalogue for the `patch`-style commands.
 *
 * `set_camera_field`, `set_light_field`, `set_lighting_field`, `update_room`,
 * `update_project_settings` and `set_clip_field` used to describe their argument as "keys as in
 * snapshot.document". That only worked when the selected object happened to already carry the
 * field the caller wanted — a fresh camera has no `focalKeys`, a scene with daylight has no
 * `fog` — so the Agent could not discover the key and had to guess. These lists are typed against
 * the real interfaces, so adding a field to the model fails the type check here instead of
 * silently dropping out of the catalogue.
 */

type FieldDoc = { type: string; note?: string };

/** Camera fields, keyed by the real `CameraConfig` property names. */
const cameraFields: Record<keyof CameraConfig, FieldDoc> = {
    aim: { type: "'target' | 'manual'", note: 'manual 时可直接旋转机位；target 会锁定目标' },
    focal: { type: 'number', note: '毫米焦距，8—300' },
    focalKeys: { type: 'NumberKey[] | undefined', note: '焦距关键帧；≥2 个才生效，否则用 focal' },
    target: { type: 'Vec3', note: '世界坐标目标点' },
    targetId: { type: 'string', note: "'' 表示固定空间目标，否则为看向的实体 ID" },
    targetHeight: { type: 'number', note: '米' },
    targetPath: { type: 'CameraLookPath | null', note: '视线关键帧路径' },
    mode: { type: "'free' | 'follow' | 'pov'" },
    offset: { type: 'Vec3', note: 'follow/pov 相对目标的偏移' },
    inheritRotation: { type: 'boolean' },
    hideWalls: { type: 'string[]', note: "取自 ['north','south','east','west']" },
    hiddenEntityIds: { type: 'string[]', note: '本机位隐藏的对象 ID' },
};

const lightFields: Record<keyof LightConfig, FieldDoc> = {
    intensity: { type: 'AnimatedNumber', note: 'number 或关键帧数组' },
    temperature: { type: 'AnimatedNumber | undefined', note: '开尔文 2000—12000' },
    range: { type: 'number', note: '米，0.5—200' },
    angle: { type: 'number', note: '度，1—179' },
    penumbra: { type: 'number', note: '0—1' },
    width: { type: 'number' },
    height: { type: 'number' },
    shadows: { type: 'boolean' },
    throughWalls: { type: 'boolean | undefined' },
    colorKeys: { type: '{ time, color, easing? }[] | undefined' },
    flicker: { type: '{ strength, frequency, seed, start? } | null | undefined' },
};

const lightingFields: Record<keyof LightingConfig, FieldDoc> = {
    defaultLights: { type: 'boolean', note: '是否使用场景默认灯光' },
    ambient: { type: 'AnimatedNumber' },
    exposure: { type: 'AnimatedNumber', note: '0.05—10' },
    background: { type: 'string', note: 'CSS 颜色，天空' },
    groundColor: { type: 'string', note: 'CSS 颜色，地面' },
    quality: { type: "'off' | 'low' | 'medium' | 'high'", note: '阴影质量' },
    sunColor: { type: 'string | undefined' },
    sunIntensity: { type: 'AnimatedNumber | undefined' },
    sunDirection: { type: '[number, number, number] | undefined' },
    fog: { type: '{ color, density } | null | undefined' },
};

const roomFields = {
    enabled: { type: 'boolean', note: '是否显示房间墙体与地板' },
    width: { type: 'number', note: '米，≥2.3' },
    depth: { type: 'number', note: '米，≥2.3' },
    height: { type: 'number', note: '米，净高' },
};

const projectFields = {
    name: { type: 'string', note: '工程名，≤80 字' },
    aspect: { type: 'string', note: '取自 catalog.aspects' },
    fps: { type: 'number', note: '取自 catalog.frameRates；改画幅或帧率会重建取景，时间与关键帧保持不变' },
};

const clipFields: Record<keyof Clip, FieldDoc> = {
    id: { type: 'string', note: '只读，不要通过 patch 修改' },
    name: { type: 'string | undefined' },
    start: { type: 'number', note: '秒' },
    end: { type: 'number', note: '秒，须大于 start' },
    action: { type: 'string', note: '取自 catalog.actions' },
    native: { type: 'NativeAnimation | undefined' },
    retarget: { type: 'RetargetAnimation | undefined' },
    speed: { type: 'number', note: '0.1—5' },
    offset: { type: 'number | undefined' },
    progressOffset: { type: 'number | undefined' },
    sourceDuration: { type: 'number | undefined' },
    loop: { type: 'boolean | undefined', note: '显式循环或在单次动作结束后保持姿态' },
    blendIn: { type: 'number | undefined', note: '片段入场过渡秒数，0—2' },
    turnAmount: { type: 'number | undefined' },
};

export const patchFieldCatalog = {
    set_camera_field: cameraFields,
    set_light_field: lightFields,
    set_lighting_field: lightingFields,
    update_room: roomFields,
    update_project_settings: projectFields,
    set_clip_field: clipFields,
} as const;
