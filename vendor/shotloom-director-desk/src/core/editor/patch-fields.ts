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

type FieldDoc = { type: string; note?: string; minimum?: number; maximum?: number; example?: unknown };

export const patchValueTypes = {
    Vec3: { type: '[number,number,number]', example: [0, 0, 0] },
    AnimatedNumber: { type: 'number | { keys: { time:number, value:number, easing?:Easing }[] }',
        note: 'time 为非负秒数且严格递增，keys 至少一个；value 遵循该字段的 minimum/maximum。不能直接传数组。',
        example: { keys: [{ time: 0, value: 1 }, { time: 2, value: 2 }] } },
    scale: { type: '[number,number,number] | number', note: '三个分量必须大于 0；正数 s 等比展开为 [s,s,s] 并返回 warning。', example: [1, 1, 1] },
};

/** Camera fields, keyed by the real `CameraConfig` property names. */
const cameraFields: Record<keyof CameraConfig, FieldDoc> = {
    aim: { type: "'target' | 'manual'", note: 'manual 时可直接旋转机位；target 会锁定目标' },
    focal: { type: 'number', minimum: 8, maximum: 300, note: '毫米；单独设置 focal 会清除旧 focalKeys' },
    focalKeys: { type: 'NumberKey[] | undefined', note: '直接传关键帧数组，value 为 8—300 毫米；存在时优先于 focal', example: [{ time: 0, value: 35 }, { time: 2, value: 50 }] },
    target: { type: 'Vec3', note: '世界坐标目标点' },
    targetId: { type: 'string', note: "'' 表示固定空间目标，否则为看向的实体 ID" },
    targetHeight: { type: 'number', note: '米' },
    targetPath: { type: 'CameraLookPath | null', note: '视线关键帧路径' },
    mode: { type: "'free' | 'follow' | 'pov'" },
    offset: { type: 'Vec3', note: 'follow/pov 相对目标的偏移' },
    inheritRotation: { type: 'boolean' },
    hideWalls: { type: 'string[]', note: "取自 ['north','south','east','west','ceiling']" },
    hiddenEntityIds: { type: 'string[]', note: '本机位隐藏的对象 ID' },
};

const lightFields: Record<keyof LightConfig, FieldDoc> = {
    intensity: { type: 'AnimatedNumber', minimum: 0, maximum: 100000, note: '数值或 {keys:[{time,value}]}；不是直接数组' },
    temperature: { type: 'AnimatedNumber | undefined', minimum: 1000, maximum: 15000, note: '开尔文' },
    range: { type: 'number', minimum: 0.1, maximum: 10000, note: '米' },
    angle: { type: 'number', minimum: 1, maximum: 89, note: '度' },
    penumbra: { type: 'number', minimum: 0, maximum: 1 },
    width: { type: 'number', minimum: 0.01, maximum: 500, note: '米' },
    height: { type: 'number', minimum: 0.01, maximum: 500, note: '米' },
    shadows: { type: 'boolean', note: 'light-area 不支持投影，须为 false' },
    throughWalls: { type: 'boolean | undefined' },
    colorKeys: { type: '{ time, color, easing? }[] | undefined' },
    flicker: { type: '{ strength, frequency, seed, start? } | null | undefined' },
};

const lightingFields: Record<keyof LightingConfig, FieldDoc> = {
    defaultLights: { type: 'boolean', note: '是否使用场景默认灯光' },
    ambient: { type: 'AnimatedNumber', minimum: 0, maximum: 20 },
    exposure: { type: 'AnimatedNumber', minimum: 0.05, maximum: 10 },
    background: { type: 'string', note: '#rrggbb，天空' },
    groundColor: { type: 'string', note: '#rrggbb，地面' },
    quality: { type: "'off' | 'low' | 'medium' | 'high'", note: '阴影质量' },
    sunColor: { type: 'string | undefined', note: '#rrggbb' },
    sunIntensity: { type: 'AnimatedNumber | undefined', minimum: 0, maximum: 100, example: { keys: [{ time: 0, value: 1.4 }, { time: 2, value: 2 }] } },
    sunDirection: { type: '[number, number, number] | undefined', note: '向量长度至少 0.01' },
    fog: { type: '{ color, density } | null | undefined', note: 'color 为 #rrggbb；density 为 AnimatedNumber，范围 0—0.5' },
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
