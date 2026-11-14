import * as THREE from 'three';
import { assertEasing } from '@/core/animation/channels.ts';
import { alignSurface, placeOnSurface } from '@/core/editor/directing-geometry.ts';
import { findAsset } from '@/core/asset-catalog.ts';
import { removeCameraVisibilityReference } from '@/core/scenes/camera-visibility.ts';
import {
    ACTIONS, ASPECTS, BUILDS, COLORS, FRAME_RATES, GENDERS, clip, entity,
    type CameraConfig, type Clip, type Entity, type Project, type Vec3,
} from '@/core/model.ts';
import { actionDuration } from '@/core/animation/action-timing.ts';
import { nextFreeStart } from '@/core/clip-editing.ts';
import { addCut, shiftPath } from '@/core/timeline.ts';
import { defaultLighting } from '@/core/lighting/model.ts';
import { patchFieldCatalog } from '@/core/editor/patch-fields.ts';
import { validateAssetParameters } from '@/core/assets/parameters.ts';

export type BatchEdit = {
    ref?: string;
    startSec?: number;
    endSec?: number;
    speed?: number;
    blendIn?: number;
    loop?: boolean;
    subjectIds?: string[];
    operation: 'add_shot' | 'set_entity' | 'set_camera' | 'set_light' | 'set_lighting' | 'set_room' | 'set_project' | 'add_action' | 'set_clip' | 'remove_clip'
        | 'align_surface' | 'place_on_surface' | 'seat_on_surface' | 'align_facing' | 'set_path' | 'set_rotation_animation' | 'add_asset' | 'add_wall' | 'add_room' | 'add_prop' | 'add_camera' | 'add_cut' | 'delete_entity' | 'duplicate_entity';
    entityId?: string;
    targetEntityId?: string;
    anchorId?: string;
    clipId?: string;
    action?: string;
    atSec?: number;
    patch?: Record<string, unknown>;
    /** set_path: 关键时点；timeSec 严格递增。 */
    points?: { position: unknown; timeSec: unknown }[];
    smooth?: boolean;
    /** set_rotation_animation: local pivot and additive Euler angles in degrees. */
    pivot?: unknown;
    keys?: unknown;
    /** add_asset / add_camera */
    assetId?: string;
    name?: string;
    position?: unknown;
    rotationDegrees?: unknown;
    scale?: unknown;
    /** 素材参数（米制宽高深、墙洞等），键名取自 catalog.assets[].params。 */
    parameters?: unknown;
    /** add_wall：俯视平面上的墙体线段 [x, z]，及墙高、墙厚、居中洞口、底面高度。 */
    from?: unknown;
    to?: unknown;
    height?: unknown;
    thickness?: unknown;
    opening?: unknown;
    y?: unknown;
    /** add_room：矩形房间范围与各侧门窗。 */
    minX?: unknown;
    maxX?: unknown;
    minZ?: unknown;
    maxZ?: unknown;
    openings?: unknown;
    floor?: unknown;
    /** add_prop：用形状素材拼出的组合体部件。 */
    parts?: unknown;
    color?: unknown;
    /** add_cut */
    timeSec?: unknown;
    cameraId?: string;
};

const entityFields = ['name', 'color', 'position', 'rotationDegrees', 'scale', 'parameters', 'visible', 'height', 'build', 'gender'] as const;
const clipFields = ['start', 'end', 'speed', 'blendIn', 'loop'] as const;
const operationFields: Record<BatchEdit['operation'], readonly string[]> = {
    add_shot: ['operation', 'timeSec', 'cameraId', 'name', 'subjectIds', 'patch', 'points', 'smooth'],
    align_surface: ['operation', 'entityId', 'targetEntityId', 'anchorId'],
    place_on_surface: ['operation', 'entityId', 'targetEntityId', 'anchorId'],
    seat_on_surface: ['operation', 'entityId', 'targetEntityId', 'anchorId'],
    align_facing: ['operation', 'entityId', 'targetEntityId'],
    set_entity: ['operation', 'entityId', 'patch'],
    set_camera: ['operation', 'entityId', 'patch'],
    set_light: ['operation', 'entityId', 'patch'],
    set_lighting: ['operation', 'patch'],
    set_room: ['operation', 'patch'],
    set_project: ['operation', 'patch'],
    add_action: ['operation', 'entityId', 'action', 'atSec', 'startSec', 'endSec', 'speed', 'blendIn', 'loop'],
    set_clip: ['operation', 'entityId', 'clipId', 'patch'],
    remove_clip: ['operation', 'entityId', 'clipId'],
    set_path: ['operation', 'entityId', 'points', 'smooth'],
    set_rotation_animation: ['operation', 'entityId', 'pivot', 'keys'],
    add_asset: ['operation', 'assetId', 'name', 'position', 'rotationDegrees', 'scale', 'parameters'],
    add_wall: ['operation', 'from', 'to', 'height', 'thickness', 'opening', 'y', 'name'],
    add_room: ['operation', 'minX', 'maxX', 'minZ', 'maxZ', 'height', 'thickness', 'y', 'openings', 'name', 'floor'],
    add_prop: ['operation', 'parts', 'name', 'position', 'rotationDegrees', 'color', 'scale'],
    add_camera: ['operation', 'name', 'position', 'rotationDegrees'],
    add_cut: ['operation', 'timeSec', 'cameraId'],
    delete_entity: ['operation', 'entityId'],
    duplicate_entity: ['operation', 'entityId', 'name', 'position', 'rotationDegrees'],
};
/** Catalogue props sit on the centre of their base; catalog conventions and the floating check rely on it. */
export const ASSET_ORIGIN = 'base-center';
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const vec3 = (value: unknown, name: string): Vec3 => {
    if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'number' && Number.isFinite(v)))
        throw Error(`${name} 必须是三个有限数值`);
    return value as Vec3;
};
const vec2 = (value: unknown, name: string): [number, number] => {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(v => typeof v === 'number' && Number.isFinite(v)))
        throw Error(`${name} 必须是俯视平面上的 [x, z] 两个有限数值`);
    return value as [number, number];
};
const finite = (value: unknown, name: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw Error(`${name} 必须是有限数值`);
    return value;
};
const degreesToRadians = (value: unknown): Vec3 => vec3(value, 'rotationDegrees').map(v => THREE.MathUtils.degToRad(v)) as Vec3;
const patchFor = (edit: BatchEdit, fields: readonly string[]): Record<string, unknown> => {
    const patch = edit.patch;
    if (!isRecord(patch) || !Object.keys(patch).length)
        throw Error('patch 需要至少一个字段');
    const unknown = Object.keys(patch).find(key => !fields.includes(key));
    if (unknown) throw Error(`不支持字段 ${unknown}；可用字段：${fields.join(', ')}`);
    return patch;
};
const target = (project: Project, id: unknown): Entity => {
    const entity = project.entities.find(e => e.id === id);
    if (!entity) throw Error(`实体不存在：${String(id)}`);
    if (entity.locked) throw Error(`「${entity.name}」已锁定`);
    return entity;
};

/**
 * 把 `{ position, timeSec }` 关键时点写成 `MotionPath`。
 *
 * 单条命令的 `add_path_point` 依赖当前选区和播放头，时间由编辑器按默认时长重排，
 * Agent 无法声明"这条路在 0—24 秒之间走完"。这里是纯函数版本：时间点由调用方给出，
 * 校验严格递增，失败时指出第几个点错了。
 */
const motionPath = (points: unknown, smooth: boolean): NonNullable<Entity['path']> => {
    if (!Array.isArray(points) || points.length < 2) throw Error('points 至少需要 2 个关键时点');
    const sorted = points.map((point, index) => {
        if (!isRecord(point)) throw Error(`points[${index}] 必须是对象`);
        const timeSec = point.timeSec;
        if (typeof timeSec !== 'number' || !Number.isFinite(timeSec) || timeSec < 0)
            throw Error(`points[${index}].timeSec 必须是非负有限数值`);
        assertEasing(point.easing);
        return { time: Math.round(timeSec * 1e6) / 1e6, position: vec3(point.position, `points[${index}].position`), ...(point.easing === undefined ? {} : { easing: point.easing }) } as NonNullable<Entity['path']>['points'][number];
    }).sort((a, b) => a.time - b.time);
    for (let index = 1; index < sorted.length; index++) {
        if (sorted[index].time <= sorted[index - 1].time)
            throw Error(`points 的 timeSec 必须严格递增（第 ${index + 1} 个点 ${sorted[index].time}s 未晚于前一点）`);
    }
    return { smooth, points: sorted };
};
/** 新增实体的公共落位约定：素材原点在底面中心，position 的 y 即落地高度。 */
const placeNewEntity = (e: Entity, edit: BatchEdit) => {
    if (edit.position !== undefined) e.position = vec3(edit.position, 'position');
    if (edit.rotationDegrees !== undefined) e.rotation = degreesToRadians(edit.rotationDegrees);
    if (edit.scale !== undefined) e.scale = positiveScale(edit.scale);
};
const positiveScale = (value: unknown): Vec3 => {
    const scale = vec3(value, 'scale');
    if (scale.some(v => v <= 0)) throw Error('scale 的三个分量都必须大于 0');
    return scale;
};

/**
 * Set real-size asset parameters (metres) instead of stretching with `scale`.
 *
 * A wall stretched by scale also stretches its door hole and thickness, and the caller has to turn
 * "3.4 m long" into "scale 0.85" by hand for every wall — most of the arithmetic, and most of the
 * mistakes, in a long layout session. Parameters are what the inspector edits: the value is the size.
 */
const applyParameters = (e: Entity, input: unknown) => {
    if (!isRecord(input) || !Object.keys(input).length) throw Error('parameters 需要至少一个字段');
    const schema = findAsset(e.asset)?.parameters;
    if (!schema) throw Error(`「${e.name}」没有可调的素材参数；只能用 scale 调整尺寸`);
    const next = { ...(e.assetParameters ?? {}) };
    for (const [key, value] of Object.entries(input)) {
        const field = Object.hasOwn(schema, key) ? schema[key] : undefined;
        if (!field) throw Error(`「${e.name}」不支持参数 ${key}；可用参数：${Object.keys(schema).join(', ')}`);
        const number = finite(value, `parameters.${key}`);
        if (number < field.min || number > field.max)
            throw Error(`parameters.${key} 需在 ${field.min}—${field.max}${field.unit ?? ''} 之间`);
        next[key] = field.integer ? Math.round(number) : number;
    }
    e.assetParameters = next;
    // Cross-field rules (a hole must fit inside its wall, and so on) live with the asset definitions.
    validateAssetParameters(e);
};

export type BatchReceipt = {
    index: number;
    ref?: string;
    operation: string;
    entityId?: string;
    targetEntityId?: string;
    anchorId?: string;
    clipId?: string;
    name?: string;
    points?: number;
    /** add_prop 拼了几个部件。 */
    parts?: number;
    sourceEntityId?: string;
    /** add_room 一次建了多面墙（含地板时在末尾）。 */
    entities?: string[];
    timeSec?: number;
    cameraId?: string;
};

/**
 * Let a later edit address something an earlier edit created, as `$1` / `$2` (1-based index).
 *
 * Ids are generated inside the batch, so without this "add a wall, then set its parameters" is two
 * round trips — the agent had to say so itself: "set_entity requires entityId which is returned by
 * add_asset, but within a batch I don't know the ID in advance". A reference must point backwards,
 * because the id it names has to exist by the time the edit runs.
 */
function resolveReferences(edit: BatchEdit, receipts: BatchReceipt[]): BatchEdit {
    if (!isRecord(edit)) return edit;
    const resolve = (value: unknown, field: string, pick: 'entityId' | 'clipId'): unknown => {
        if (typeof value !== 'string' || !value.startsWith('$')) return value;
        const match = /^\$(\d+)$/.exec(value);
        const target = match ? receipts[Number(match[1]) - 1] : receipts.find(receipt => receipt.ref === value.slice(1));
        const id = target?.[pick];
        if (!id)
            throw Error(`${field} 引用的 ${value} 不存在：$N 只能指向本批前面某一项新建的 id（第 N 项必须已创建实体${pick === 'clipId' ? '或片段' : ''}）`);
        return id;
    };
    const next: BatchEdit = { ...edit };
    if (edit.targetEntityId !== undefined) next.targetEntityId = resolve(edit.targetEntityId, 'targetEntityId', 'entityId') as string;
    if (edit.entityId !== undefined) next.entityId = resolve(edit.entityId, 'entityId', 'entityId') as string;
    if (edit.clipId !== undefined) next.clipId = resolve(edit.clipId, 'clipId', 'clipId') as string;
    if (edit.subjectIds !== undefined) next.subjectIds = edit.subjectIds.map(id => resolve(id, 'subjectIds', 'entityId') as string);
    if (edit.cameraId !== undefined) next.cameraId = resolve(edit.cameraId, 'cameraId', 'entityId') as string;
    if (isRecord(edit.patch)) {
        const patch = { ...edit.patch };
        if (patch.targetId !== undefined) patch.targetId = resolve(patch.targetId, 'patch.targetId', 'entityId');
        if (Array.isArray(patch.hiddenEntityIds)) patch.hiddenEntityIds = patch.hiddenEntityIds.map(id => resolve(id, 'patch.hiddenEntityIds', 'entityId'));
        next.patch = patch;
    }
    return next;
}

/** Pure project mutation; EditorSession validates a clone before committing one undo step. */
export function applyBatchEdits(project: Project, edits: BatchEdit[]): BatchReceipt[] {
    if (!Array.isArray(edits) || edits.length < 1) throw Error('一次批量设置需要至少一项');
    const receipts: BatchReceipt[] = [];
    for (const [index, raw] of edits.entries()) {
        // 解析后的条目要留给 catch 报告"第几项什么操作"，所以在外层声明。
        let edit: BatchEdit = raw;
        try {
            // 引用解析也算这一项的一部分：指向不存在的 $N 要与其它参数错误一样标明"第几项"。
            edit = resolveReferences(raw, receipts);
            if (!isRecord(edit)) throw Error('每项必须是对象');
            const allowed = operationFields[edit.operation];
            if (!allowed) throw Error(`不支持操作：${String(edit.operation)}`);
            const extra = Object.keys(edit).find(key => key !== 'ref' && !allowed.includes(key));
            if (extra) throw Error(`操作 ${edit.operation} 不接受字段 ${extra}`);
            if (edit.ref !== undefined && (typeof edit.ref !== 'string' || !edit.ref.trim() || /^\d+$/.test(edit.ref) || receipts.some(r => r.ref === edit.ref))) throw Error('ref 需要唯一的非数字名称');
            const receipt: BatchReceipt = { index, operation: edit.operation, ...(edit.ref ? { ref: edit.ref } : {}) };
            if (edit.operation === 'set_entity') {
                const e = target(project, edit.entityId);
                const patch = patchFor(edit, entityFields);
                if (patch.name !== undefined) {
                    if (typeof patch.name !== 'string' || !patch.name.trim()) throw Error('名称不能为空');
                    e.name = patch.name.trim();
                }
                if (patch.color !== undefined) {
                    if (typeof patch.color !== 'string') throw Error('color 必须是颜色字符串');
                    e.color = patch.color;
                }
                if (patch.position !== undefined) {
                    if (e.handBinding) throw Error('手持道具不能直接设置位置');
                    if (e.camera && e.camera.mode !== 'free') throw Error('跟随机位需先设为 free 模式');
                    const position = vec3(patch.position, 'position');
                    shiftPath(e, new THREE.Vector3(...position).sub(new THREE.Vector3(...e.position)));
                }
                if (patch.rotationDegrees !== undefined) {
                    if (e.camera && e.camera.mode !== 'free') throw Error('跟随机位需先设为 free 模式');
                    e.rotation = vec3(patch.rotationDegrees, 'rotationDegrees').map(v => THREE.MathUtils.degToRad(v)) as Vec3;
                    if (e.camera) e.camera.aim = 'manual';
                }
                if (patch.scale !== undefined) e.scale = positiveScale(patch.scale);
                if (patch.parameters !== undefined) applyParameters(e, patch.parameters);
                if (patch.visible !== undefined) {
                    if (typeof patch.visible !== 'boolean') throw Error('visible 必须是布尔值');
                    e.visible = patch.visible;
                }
                if (patch.height !== undefined) {
                    if (typeof patch.height !== 'number' || !Number.isFinite(patch.height)) throw Error('height 必须是有限数值');
                    e.height = patch.height;
                }
                if (patch.build !== undefined) {
                    if (!BUILDS.includes(patch.build as Entity['build'])) throw Error('build 必须取自 catalog.entityOptions.build');
                    e.build = patch.build as Entity['build'];
                }
                if (patch.gender !== undefined) {
                    if (!GENDERS.includes(patch.gender as Entity['gender'])) throw Error('gender 必须取自 catalog.entityOptions.gender');
                    e.gender = patch.gender as Entity['gender'];
                }
                receipt.entityId = e.id;
            } else if (edit.operation === 'set_camera' || edit.operation === 'set_light') {
                const e = target(project, edit.entityId);
                const field = edit.operation === 'set_camera' ? 'camera' : 'light';
                if (!e[field]) throw Error(`实体没有 ${field} 配置`);
                const patch = patchFor(edit, Object.keys(patchFieldCatalog[edit.operation === 'set_camera' ? 'set_camera_field' : 'set_light_field']));
                if (field === 'camera') {
                    e.camera = { ...e.camera!, ...patch } as CameraConfig;
                    if (patch.focal !== undefined && patch.focalKeys === undefined) delete e.camera.focalKeys;
                } else e.light = { ...e.light!, ...patch };
                receipt.entityId = e.id;
            } else if (edit.operation === 'set_lighting') {
                const patch = patchFor(edit, Object.keys(patchFieldCatalog.set_lighting_field));
                project.lighting = { ...(project.lighting ?? defaultLighting()), ...patch };
            } else if (edit.operation === 'set_room') {
                const patch = patchFor(edit, Object.keys(patchFieldCatalog.update_room));
                project.room = { ...project.room, ...patch } as Project['room'];
            } else if (edit.operation === 'set_project') {
                const patch = patchFor(edit, Object.keys(patchFieldCatalog.update_project_settings));
                if (patch.name !== undefined) {
                    if (typeof patch.name !== 'string' || !patch.name.trim() || patch.name.length > 80) throw Error('工程名需要 1 至 80 字');
                    project.name = patch.name.trim();
                }
                if (patch.aspect !== undefined) {
                    if (!ASPECTS.includes(patch.aspect as string)) throw Error('aspect 必须取自 catalog.aspects');
                    project.aspect = patch.aspect as string;
                }
                if (patch.fps !== undefined) {
                    if (!FRAME_RATES.includes(patch.fps as number)) throw Error('fps 必须取自 catalog.frameRates');
                    project.fps = patch.fps as number;
                }
            } else if (edit.operation === 'add_action') {
                const e = target(project, edit.entityId);
                if (e.kind !== 'actor' && e.kind !== 'crowd') throw Error('动作只能添加到角色或群演');
                if (typeof edit.action !== 'string' || !Object.hasOwn(ACTIONS, edit.action)) throw Error('action 必须取自 catalog.actions');
                const capabilities = findAsset(e.asset)?.capabilities;
                if (capabilities && !capabilities.actions.includes(edit.action as keyof typeof ACTIONS)) throw Error('该实体不支持此动作');
                const at = edit.startSec ?? edit.atSec ?? 0;
                if (edit.startSec !== undefined && edit.atSec !== undefined && edit.startSec !== edit.atSec) throw Error('startSec 与 atSec 不一致');
                if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) throw Error('atSec 必须是非负秒数');
                const duration = edit.endSec === undefined ? Math.ceil(actionDuration(edit.action) * project.fps - 1e-8) / project.fps : finite(edit.endSec, 'endSec') - at;
                if (!(duration > 0)) throw Error('endSec 必须晚于 startSec');
                const explicit = edit.startSec !== undefined || edit.endSec !== undefined;
                const start = explicit ? at : nextFreeStart(e.clips, at, duration);
                if (explicit && e.clips.some(c => c.start < start + duration && c.end > start)) throw Error('指定动作时段与已有片段重叠；请先修改或移除已有片段');
                const speed = edit.speed === undefined ? 1 : finite(edit.speed, 'speed');
                const blendIn = edit.blendIn === undefined ? 0.2 : finite(edit.blendIn, 'blendIn');
                if (speed < 0.1 || speed > 5 || blendIn < 0 || blendIn > 2) throw Error('speed 需在 0.1—5，blendIn 需在 0—2');
                if (edit.loop !== undefined && typeof edit.loop !== 'boolean') throw Error('loop 必须是布尔值');
                const clip: Clip = { id: crypto.randomUUID(), action: edit.action as keyof typeof ACTIONS, start, end: start + duration, speed, blendIn, ...(edit.loop === undefined ? {} : { loop: edit.loop }) };
                e.clips.push(clip);
                e.clips.sort((a, b) => a.start - b.start);
                project.duration = Math.max(project.duration, clip.end);
                receipt.entityId = e.id;
                receipt.clipId = clip.id;
            } else if (edit.operation === 'set_clip' || edit.operation === 'remove_clip') {
                const e = target(project, edit.entityId);
                const clip = e.clips.find(c => c.id === edit.clipId);
                if (!clip) throw Error(`动作片段不存在：${String(edit.clipId)}`);
                if (edit.operation === 'remove_clip') e.clips = e.clips.filter(c => c.id !== clip.id);
                else {
                    const patch = patchFor(edit, clipFields);
                    const start = patch.start ?? clip.start;
                    const end = patch.end ?? clip.end;
                    const speed = patch.speed ?? clip.speed;
                    if (typeof start !== 'number' || !Number.isFinite(start) || start < 0 ||
                        typeof end !== 'number' || !Number.isFinite(end) || end - start < 1 / project.fps)
                        throw Error('片段结束时间必须至少晚于开始时间一帧');
                    if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0.1 || speed > 5)
                        throw Error('动作速度需在 0.1—5 之间');
                    if (patch.loop !== undefined && typeof patch.loop !== 'boolean') throw Error('loop 必须是布尔值');
                    if (patch.blendIn !== undefined && (typeof patch.blendIn !== 'number' || !Number.isFinite(patch.blendIn) || patch.blendIn < 0 || patch.blendIn > 2)) throw Error('blendIn 需在 0—2');
                    Object.assign(clip, patch);
                    e.clips.sort((a, b) => a.start - b.start);
                    project.duration = Math.max(project.duration, clip.end);
                }
                receipt.entityId = e.id;
                receipt.clipId = clip.id;
            } else if (edit.operation === 'align_surface') {
                Object.assign(receipt, alignSurface(project, String(edit.entityId), String(edit.targetEntityId), edit.anchorId));
            } else if (edit.operation === 'place_on_surface' || edit.operation === 'seat_on_surface') {
                Object.assign(receipt, placeOnSurface(project, String(edit.entityId), String(edit.targetEntityId), edit.anchorId, edit.operation === 'seat_on_surface'));
            } else if (edit.operation === 'align_facing') {
                const e = target(project, edit.entityId), other = target(project, edit.targetEntityId);
                if (e.id === other.id || e.camera || e.handBinding) throw Error('朝向对齐需要不同实体；机位请使用 set_camera.targetId');
                const dx = other.position[0] - e.position[0], dz = other.position[2] - e.position[2];
                if (Math.hypot(dx, dz) < 1e-8) throw Error('两个实体水平位置相同，无法确定朝向');
                e.rotation[1] = Math.atan2(dx, dz);
                e.face = 'fixed';
                receipt.entityId = e.id;
            } else if (edit.operation === 'set_path') {
                const e = target(project, edit.entityId);
                const path = motionPath(edit.points, edit.smooth !== false);
                if (e.camera && e.camera.mode !== 'free') throw Error('跟随机位需先设为 free 模式，再写入路径');
                if (e.handBinding) throw Error('手持道具不能写入运动路径');
                e.path = path;
                // 路径首点即基座位置，否则 0 秒处会从旧位置瞬移过来。
                e.position = [...path.points[0].position] as Vec3;
                project.duration = Math.max(project.duration, path.points[path.points.length - 1].time);
                receipt.entityId = e.id;
                receipt.points = path.points.length;
            } else if (edit.operation === 'set_rotation_animation') {
                const e = target(project, edit.entityId);
                if (edit.keys === null) {
                    delete e.rotationAnimation;
                } else {
                    const pivot = vec3(edit.pivot, 'pivot');
                    if (!Array.isArray(edit.keys) || edit.keys.length < 2) throw Error('keys 需要至少两个旋转关键帧');
                    let previousTime = -1;
                    const keys = edit.keys.map((value, index) => {
                        if (!isRecord(value) || Object.keys(value).some(key => !['timeSec', 'rotationDegrees', 'easing'].includes(key)))
                            throw Error(`第 ${index + 1} 个旋转关键帧字段无效`);
                        const time = finite(value.timeSec, 'timeSec');
                        if (time < 0 || time <= previousTime)
                            throw Error('旋转关键帧时间需要非负且严格递增');
                        previousTime = time;
                        const degrees = vec3(value.rotationDegrees, 'rotationDegrees');
                        return { time, degrees, ...(value.easing === undefined ? {} : { easing: value.easing }) };
                    });
                    e.rotationAnimation = { pivot, keys } as Entity['rotationAnimation'];
                    project.duration = Math.max(project.duration, keys[keys.length - 1].time);
                }
                receipt.entityId = e.id;
            } else if (edit.operation === 'add_asset') {
                const asset = findAsset(String(edit.assetId ?? ''));
                if (!asset) throw Error(`素材不存在：${String(edit.assetId)}；取自 catalog.assets[].id`);
                const e = entity(asset.kind, asset.id, String(edit.name ?? asset.name).trim() || asset.name, [0, 0, 0]);
                // The editor lifts and tilts a new light because the user drops it on the floor.
                // Here the caller usually states the exact spot, so the defaults come first and
                // anything given explicitly wins; adding the lift afterwards put a light meant
                // for 3.2 m at 6.2 m.
                if (e.light) {
                    e.position[1] = 3;
                    e.rotation[0] = -Math.PI / 4;
                }
                placeNewEntity(e, edit);
                if (edit.parameters !== undefined) applyParameters(e, edit.parameters);
                if (asset.kind === 'actor' || asset.kind === 'crowd') {
                    const actors = project.entities.filter(item => item.kind === 'actor').length;
                    e.color = COLORS[actors % COLORS.length];
                    e.clips = [clip('idle', 0, project.duration)];
                }
                project.entities.push(e);
                receipt.entityId = e.id;
                receipt.name = e.name;
            } else if (edit.operation === 'add_room') {
                // 整间房一次建好：布局表里"入口间 x −5.5…−2.5, z 11…15"对应一条，不必展开成
                // 六面墙再算长度与中心——那正是布局会话反复返工的算术来源。
                const minX = finite(edit.minX, 'minX'), maxX = finite(edit.maxX, 'maxX');
                const minZ = finite(edit.minZ, 'minZ'), maxZ = finite(edit.maxZ, 'maxZ');
                if (maxX - minX < 0.2 || maxZ - minZ < 0.2) throw Error('房间范围太小：X 与 Z 方向都要至少 0.2 米');
                const sides = { west: maxX - minX, east: maxX - minX, north: maxZ - minZ, south: maxZ - minZ } as const;
                const entries = edit.openings === undefined ? [] : edit.openings;
                if (!Array.isArray(entries)) throw Error('openings 必须是数组：[{ side, width, height?, sill?, offset? }]');
                const bySide = new Map<string, { width: unknown; height?: unknown; sill?: unknown; offset?: unknown }[]>();
                for (const [index, opening] of entries.entries()) {
                    if (!isRecord(opening)) throw Error(`openings[${index}] 必须是对象`);
                    const unknown = Object.keys(opening).find(key => !['side', 'width', 'height', 'sill', 'offset'].includes(key));
                    if (unknown) throw Error(`openings[${index}] 不支持字段 ${unknown}；可用字段：side, width, height, sill, offset`);
                    const side = String(opening.side ?? '');
                    if (!Object.hasOwn(sides, side)) throw Error(`openings[${index}].side 只能是 west / east / north / south`);
                    const span = sides[side as keyof typeof sides];
                    const width = finite(opening.width, `openings[${index}].width`);
                    if (width <= 0 || width >= span) throw Error(`openings[${index}].width 需在 0 与墙面长度 ${span.toFixed(2)} 米之间`);
                    const offset = opening.offset === undefined ? 0 : finite(opening.offset, `openings[${index}].offset`);
                    if (Math.abs(offset) > (span - width) / 2 + 1e-6)
                        throw Error(`openings[${index}].offset 超出墙面范围：洞宽的一半加偏移不能超过墙面长度的一半`);
                    const list = bySide.get(side) ?? [];
                    list.push({ width, ...(opening.height === undefined ? {} : { height: opening.height }), ...(opening.sill === undefined ? {} : { sill: opening.sill }), offset });
                    bySide.set(side, list);
                }
                const wallName = (suffix: string) => `${String(edit.name ?? '房间').trim() || '房间'}-${suffix}`;
                // 相邻两面墙各让半个墙厚，四角才不会叠在一起。
                const thickness = edit.thickness === undefined ? undefined : finite(edit.thickness, 'thickness');
                const half = (thickness ?? 0.18) / 2;
                const makeWall = (suffix: string, from: [number, number], to: [number, number], opts: { width: unknown; height?: unknown; sill?: unknown; offset?: unknown }[] | undefined) => {
                    const dx = to[0] - from[0], dz = to[1] - from[1];
                    const span = Math.hypot(dx, dz);
                    if (span < 0.05) throw Error(`房间的 ${suffix} 墙太短（${span.toFixed(2)} 米）`);
                    const wall = entity('prop', 'structure-wall', wallName(suffix), [(from[0] + to[0]) / 2, base, (from[1] + to[1]) / 2]);
                    wall.rotation = [0, Math.atan2(-dz, dx), 0];
                    const parameters: Record<string, unknown> = { width: Number(span.toFixed(4)) };
                    if (edit.height !== undefined) parameters.height = edit.height;
                    if (thickness !== undefined) parameters.depth = thickness;
                    // 一面墙目前只支持一个洞；同一侧要多个洞口时，只有第一个生效，其余明确报错。
                    const opening = opts?.[0];
                    if (opening) {
                        parameters.openingWidth = opening.width;
                        if (opening.height !== undefined) parameters.openingHeight = opening.height;
                        if (opening.sill !== undefined) parameters.sill = opening.sill;
                        if (opening.offset !== undefined) parameters.openingOffset = opening.offset;
                    }
                    applyParameters(wall, parameters);
                    project.entities.push(wall);
                    return wall;
                };
                if (entries.length && bySide.size && [...bySide.values()].some(list => list.length > 1))
                    throw Error('同一面墙只能开一个洞；需要多个洞口请用 add_wall 把该侧拆成多段');
                const base = edit.y === undefined ? 0 : finite(edit.y, 'y');
                // 南北墙铺满整个宽度，东西墙缩进半个墙厚贴到它们之间：四面各让半厚会在四个角
                // 各留一个 10 厘米的缺口，而南北满铺、东西内缩只会把角留在室外一侧，室内仍是闭合的。
                const walls = [
                    makeWall('南墙', [minX, maxZ], [maxX, maxZ], bySide.get('south')),
                    makeWall('北墙', [minX, minZ], [maxX, minZ], bySide.get('north')),
                    makeWall('西墙', [minX, minZ + half], [minX, maxZ - half], bySide.get('west')),
                    makeWall('东墙', [maxX, minZ + half], [maxX, maxZ - half], bySide.get('east')),
                ];
                receipt.entityId = walls[0].id;
                receipt.name = String(edit.name ?? '房间');
                receipt.entities = walls.map(wall => wall.id);
                if (edit.floor === true) {
                    const floor = entity('prop', 'structure-slab', wallName('地板'), [(minX + maxX) / 2, base, (minZ + maxZ) / 2]);
                    floor.assetParameters = { width: Number((maxX - minX).toFixed(4)), depth: Number((maxZ - minZ).toFixed(4)) };
                    applyParameters(floor, floor.assetParameters);
                    project.entities.push(floor);
                    receipt.entities = [...receipt.entities, floor.id];
                }
            } else if (edit.operation === 'add_wall') {
                // A floor plan is a list of wall segments. Taking the segment directly removes the
                // per-wall centre / angle / scale arithmetic that layout sessions kept getting wrong.
                const from = vec2(edit.from, 'from');
                const to = vec2(edit.to, 'to');
                const dx = to[0] - from[0], dz = to[1] - from[1];
                const length = Math.hypot(dx, dz);
                if (length < 0.05) throw Error('墙体线段太短：from 与 to 至少相距 0.05 米');
                const base = edit.y === undefined ? 0 : finite(edit.y, 'y');
                const e = entity('prop', 'structure-wall', String(edit.name ?? '墙').trim() || '墙',
                    [(from[0] + to[0]) / 2, base, (from[1] + to[1]) / 2]);
                // The wall's width runs along its local +x; a yaw of atan2(-dz, dx) turns +x onto the segment.
                e.rotation = [0, Math.atan2(-dz, dx), 0];
                const parameters: Record<string, unknown> = { width: Number(length.toFixed(4)) };
                if (edit.height !== undefined) parameters.height = edit.height;
                if (edit.thickness !== undefined) parameters.depth = edit.thickness;
                if (edit.opening !== undefined) {
                    if (!isRecord(edit.opening)) throw Error('opening 必须是 { width, height?, sill?, offset? } 对象');
                    const unknown = Object.keys(edit.opening).find(key => !['width', 'height', 'sill', 'offset'].includes(key));
                    if (unknown) throw Error(`opening 不支持字段 ${unknown}；可用字段：width, height, sill, offset`);
                    parameters.openingWidth = edit.opening.width;
                    if (edit.opening.height !== undefined) parameters.openingHeight = edit.opening.height;
                    if (edit.opening.sill !== undefined) parameters.sill = edit.opening.sill;
                    if (edit.opening.offset !== undefined) parameters.openingOffset = edit.opening.offset;
                }
                applyParameters(e, parameters);
                project.entities.push(e);
                receipt.entityId = e.id;
                receipt.name = e.name;
            } else if (edit.operation === 'add_prop') {
                // 目录里没有的物体用形状拼，而不是拿外形无关的道具改名冒充。产物是普通实体：
                // 可选中、可撤销、存进工程文档、inspect_model 能查，且没有代码执行面。
                const parts = edit.parts;
                if (!Array.isArray(parts) || parts.length < 1 || parts.length > 32)
                    throw Error('parts 需要 1 至 32 个部件：[{ shape, at:[x,y,z], size?:[w,h,d], rotationDegrees?, color? }]；at 是部件底面中心，y 填 0 该部件就贴地');
                const color = edit.color === undefined ? '#d5d5d0' : String(edit.color);
                if (!/^#[0-9a-f]{6}$/i.test(color)) throw Error('color 必须是 #rrggbb');
                const e = entity('prop', 'composite', String(edit.name ?? '组合体').trim() || '组合体',
                    edit.position === undefined ? [0, 0, 0] : vec3(edit.position, 'position'));
                e.color = color;
                e.parts = parts.map((part, index) => {
                    const label = `parts[${index}]`;
                    if (!isRecord(part)) throw Error(`${label} 必须是对象`);
                    const unknown = Object.keys(part).find(key => !['shape', 'at', 'size', 'rotationDegrees', 'color'].includes(key));
                    if (unknown) throw Error(`${label} 不支持字段 ${unknown}；可用字段：shape, at, size, rotationDegrees, color`);
                    const shape = String(part.shape ?? '');
                    if (findAsset(shape)?.family !== 'shape-v1')
                        throw Error(`${label}.shape 必须是形状素材（shape-*）；取自 catalog 的 query: "shape" 或 group: "基础形状"`);
                    const size = part.size === undefined ? undefined : positiveScale(part.size);
                    if (part.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(part.color)))
                        throw Error(`${label}.color 必须是 #rrggbb`);
                    return {
                        shape,
                        at: vec3(part.at, `${label}.at`),
                        ...(size ? { size } : {}),
                        ...(part.rotationDegrees === undefined ? {} : { rotationDegrees: vec3(part.rotationDegrees, `${label}.rotationDegrees`) }),
                        ...(part.color === undefined ? {} : { color: String(part.color) }),
                    };
                });
                if (edit.rotationDegrees !== undefined) e.rotation = degreesToRadians(edit.rotationDegrees);
                if (edit.scale !== undefined) e.scale = positiveScale(edit.scale);
                project.entities.push(e);
                receipt.entityId = e.id;
                receipt.name = e.name;
                receipt.parts = e.parts.length;
            } else if (edit.operation === 'add_camera') {
                const cameras = project.entities.filter(item => item.kind === 'camera').length;
                const e = entity('camera', 'camera', String(edit.name ?? `${String.fromCharCode(65 + cameras)} · 新机位`), [1.8, 1.5, 1.8]);
                placeNewEntity(e, edit);
                project.entities.push(e);
                receipt.entityId = e.id;
                receipt.name = e.name;
            } else if (edit.operation === 'add_shot') {
                const camera = target(project, edit.cameraId);
                if (!camera.camera) throw Error('add_shot.cameraId 必须指向摄影机');
                const time = finite(edit.timeSec, 'timeSec');
                if (time < 0 || time >= project.duration) throw Error('timeSec 需在场景时长内');
                if (edit.patch) applyBatchEdits(project, [{ operation: 'set_camera', entityId: camera.id, patch: edit.patch }]);
                if (edit.points) applyBatchEdits(project, [{ operation: 'set_path', entityId: camera.id, points: edit.points, smooth: edit.smooth }]);
                if (edit.subjectIds !== undefined && (!Array.isArray(edit.subjectIds) || edit.subjectIds.some(id => !project.entities.some(e => e.id === id && (e.kind === 'actor' || e.kind === 'crowd'))))) throw Error('subjectIds 只能引用真实角色或群演');
                addCut(project, time, camera.id);
                const cut = project.cuts.find(c => Math.abs(c.time - Math.round(time * project.fps) / project.fps) < 1e-7)!;
                if (edit.name !== undefined) cut.name = String(edit.name);
                if (edit.subjectIds !== undefined) cut.subjectIds = [...edit.subjectIds];
                receipt.cameraId = camera.id; receipt.timeSec = cut.time;
            } else if (edit.operation === 'add_cut') {
                const timeSec = edit.timeSec;
                if (typeof timeSec !== 'number' || !Number.isFinite(timeSec) || timeSec < 0)
                    throw Error('timeSec 必须是非负有限数值');
                const camera = project.entities.find(item => item.id === edit.cameraId);
                if (!camera || camera.kind !== 'camera') throw Error(`机位不存在：${String(edit.cameraId)}`);
                if (timeSec >= project.duration) throw Error(`timeSec 需小于工程时长 ${project.duration}s`);
                addCut(project, timeSec, camera.id);
                receipt.timeSec = timeSec;
                receipt.cameraId = camera.id;
            } else if (edit.operation === 'delete_entity') {
                const e = target(project, edit.entityId);
                const cutsUseTarget = project.cuts.some(cut => cut.cameraId === e.id);
                const replacement = project.entities.find(item => item.kind === 'camera' && item.id !== e.id)?.id;
                if (cutsUseTarget && !replacement) throw Error('该机位仍被切镜引用，请先添加另一个机位');
                removeCameraVisibilityReference(project, e.id);
                for (const cut of project.cuts) if (cut.subjectIds) cut.subjectIds = cut.subjectIds.filter(id => id !== e.id);
                for (const item of project.entities) {
                    if (item.camera?.targetId === e.id) {
                        item.camera.targetId = '';
                        item.camera.mode = 'free';
                    }
                    if (item.faceTarget === e.id) {
                        item.faceTarget = '';
                        item.face = 'fixed';
                    }
                    if (item.handBinding?.actorId === e.id) item.handBinding = null;
                }
                if (cutsUseTarget) for (const cut of project.cuts) if (cut.cameraId === e.id) cut.cameraId = replacement!;
                project.entities = project.entities.filter(item => item.id !== e.id);
                receipt.entityId = e.id;
                receipt.name = e.name;
            } else if (edit.operation === 'duplicate_entity') {
                const source = target(project, edit.entityId);
                const copy = structuredClone(source);
                copy.id = crypto.randomUUID();
                copy.locked = false;
                copy.name = String(edit.name ?? `${source.name} 副本`).trim() || `${source.name} 副本`;
                copy.clips.forEach(item => (item.id = crypto.randomUUID()));
                if (edit.position !== undefined) {
                    if (copy.handBinding) throw Error('手持道具的副本仍挂在手上，不能直接指定位置');
                    // Move the whole path with the base, as set_entity does; replacing only the
                    // base would leave a copied path behind at the original's spot.
                    shiftPath(copy, new THREE.Vector3(...vec3(edit.position, 'position')).sub(new THREE.Vector3(...copy.position)));
                } else if (copy.handBinding) copy.handBinding.offset[0] += 0.1;
                else shiftPath(copy, new THREE.Vector3(0.4, 0, 0.4));
                if (edit.rotationDegrees !== undefined) copy.rotation = degreesToRadians(edit.rotationDegrees);
                project.entities.push(copy);
                receipt.entityId = copy.id;
                receipt.sourceEntityId = source.id;
                receipt.name = copy.name;
            } else throw Error(`不支持操作：${String(edit.operation)}`);
            receipts.push(receipt);
        } catch (error) {
            throw Error(`第 ${index + 1} 项 ${String(edit?.operation ?? '')} 失败：${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return receipts;
}
