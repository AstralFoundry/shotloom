import { cloneProjectData } from './resources/model-data.ts';
import { findAsset, isAnimalAsset, assetJoints } from './asset-catalog.ts';
import { JOINT_LABELS, type JointName, type JointRotation } from './assets/joint-schema.ts';
import { validatePropParameters, type PropParameters } from './parametric-props.ts';
import { validateAssetParameters } from './assets/parameters.ts';
import {
    assertModelResources,
    assertExternalModel,
    type ModelResource,
    type ExternalModel,
} from './resources/project-resources.ts';
import { assertNativeClip, type NativeAnimation } from './resources/native-animation.ts';
import { assertRetargetClip, type RetargetAnimation } from './resources/retarget-animation.ts';
import { builtinMotionName } from './animation/motion-catalog.ts';
import { assertContactAnchors, type ContactAnchor } from './assets/contact-anchors.ts';
import { assertHandBinding, type HandBinding } from './animation/hand-binding.ts';
import { assertInitialPose, type InitialPose } from './scenes/initial-pose.ts';
import { assertCameraLookPath, type CameraLookPath } from './animation/camera-look.ts';
import { assertAnimated, assertEasing, type Easing, type NumberKey } from './animation/channels.ts';
import { assertPathInterpolation } from './animation/continuous-path.ts';
import { assertLightEntity, assertLighting, type LightConfig, type LightingConfig } from './lighting/model.ts';
import { assertMemberPaths } from './navigation/member-paths.ts';
export type Vec3 = [number, number, number];
export type Kind = 'actor' | 'prop' | 'camera' | 'crowd';
export type Action =
    | 'idle'
    | 'walk'
    | 'run'
    | 'sit'
    | 'standup'
    | 'crouch'
    | 'crawl'
    | 'jump'
    | 'lie'
    | 'fall'
    | 'wave'
    | 'point'
    | 'turn'
    | 'guard'
    | 'punch'
    | 'kick'
    | 'roundhouse'
    | 'flying-kick'
    | 'dodge'
    | 'throw'
    | 'push'
    | 'stumble'
    | 'roll';
export type Joint = JointName;
export type Pose = Partial<Record<Joint, JointRotation>>;
export interface Waypoint {
    /** Actor/crowd yaw offset from rotation[1], in radians; all points or none. */
    heading?: number;
    stop?: boolean;
    easing?: Easing;
    time: number;
    position: Vec3;
}
export interface MotionPath {
    interpolation?: 'continuous';
    smooth: boolean;
    points: Waypoint[];
    sections?: { start: number; end: number; from: number; to: number }[];
}
export interface Clip {
    id: string;
    name?: string;
    start: number;
    end: number;
    action: Action | 'native' | 'retarget';
    native?: NativeAnimation;
    retarget?: RetargetAnimation;
    speed: number;
    offset?: number;
    progressOffset?: number;
    sourceDuration?: number;
    blendIn?: number;
    loop?: boolean;
    turnAmount?: number;
}
export interface PoseKey {
    time: number;
    pose: Pose;
}
/** Local pivot and additive Euler rotation, sampled independently of the entity's position path. */
export interface RotationAnimation {
    pivot: Vec3;
    keys: { time: number; degrees: Vec3; easing?: Easing }[];
}
export interface CameraConfig {
    targetPath?: CameraLookPath | null;
    focalKeys?: NumberKey[];
    aim: 'target' | 'manual';
    focal: number;
    target: Vec3;
    targetId: string;
    targetHeight: number;
    mode: 'free' | 'follow' | 'pov';
    offset: Vec3;
    inheritRotation: boolean;
    hideWalls: string[];
    hiddenEntityIds?: string[];
}
/** 组合体的一个部件：一个形状素材 + 在组合体内的相对位置、尺寸、朝向与颜色。 */
export interface PropPart {
    /** 形状素材 id，必须是 shape-* 家族。 */
    shape: string;
    /** 相对组合体基座的位置（米）。 */
    at: Vec3;
    /** 部件的实际尺寸（米），省略按 1×1×1。 */
    size?: Vec3;
    rotationDegrees?: Vec3;
    color?: string;
}
export interface Entity {
    memberPaths?: MotionPath[] | null;
    light?: LightConfig;
    initialPose?: InitialPose;
    handBinding?: HandBinding | null;
    contactAnchors?: ContactAnchor[];
    external?: ExternalModel;
    id: string;
    kind: Kind;
    name: string;
    asset: string;
    color: string;
    position: Vec3;
    rotation: Vec3;
    rotationAnimation?: RotationAnimation;
    scale: Vec3;
    visible: boolean;
    locked: boolean;
    height: number;
    build: (typeof BUILDS)[number];
    gender: (typeof GENDERS)[number];
    path: MotionPath | null;
    face: 'path' | 'fixed' | 'target';
    faceTarget: string;
    clips: Clip[];
    pose: Pose;
    poseKeys: PoseKey[];
    camera: CameraConfig | null;
    count: number;
    spacing: number;
    seed: number;
    reference: string;
    parameters?: Partial<PropParameters>;
    assetParameters?: Record<string, number>;
    /** 声明式组合体：用基本体拼出目录里没有的物体（篝火、吉他、特定家具）。 */
    parts?: PropPart[];
    actionBlend?: number;
    footContact?: boolean;
}
export interface Cut {
    name?: string;
    subjectIds?: string[];
    time: number;
    cameraId: string;
}
export interface ReferenceImage {
    id: string;
    name: string;
    data: string;
}
export interface Project {
    lighting?: LightingConfig;
    format: 'director-desk';
    version: 1 | 2;
    resources?: ModelResource[];
    name: string;
    duration: number;
    fps: number;
    aspect: string;
    room: {
        enabled: boolean;
        width: number;
        depth: number;
        height: number;
    };
    entities: Entity[];
    cuts: Cut[];
    references: ReferenceImage[];
}
export const ASPECTS = ['9:16', '16:9', '21:9', '3:4', '4:3', '1:1'];
export const FRAME_RATES = [24, 30, 50, 59, 60, 90, 120];
/** Person build and gender are closed sets; catalogue reads them so the Agent can pick valid values. */
export const BUILDS = ['slim', 'normal', 'broad'] as const;
export const GENDERS = ['male', 'female'] as const;
export const ACTIONS: Record<Action, string> = {
    idle: '站立 / 待机',
    walk: '走路',
    run: '跑步',
    sit: '坐姿',
    standup: '起身',
    crouch: '蹲下',
    crawl: '爬行',
    jump: '跳跃',
    lie: '躺下',
    fall: '倒地',
    wave: '挥手',
    point: '指向',
    turn: '转身',
    guard: '防御',
    punch: '出拳',
    kick: '踢腿',
    roundhouse: '回旋踢',
    'flying-kick': '飞身踢',
    dodge: '闪避',
    throw: '抛掷',
    push: '推物',
    stumble: '踉跄',
    roll: '翻滚',
};
export const clipLabel = (c: Clip) =>
    c.name ??
    (c.action === 'retarget'
        ? (builtinMotionName(c) ?? `适配动作 ${c.retarget!.index + 1}`)
        : c.action === 'native'
          ? `原生动画 ${c.native!.index + 1}`
          : ACTIONS[c.action]);
export const JOINTS = JOINT_LABELS;
export const COLORS = ['#a7bdd7', '#b8c7b3', '#d1bfa0', '#c5b3c9', '#d0d2d0', '#bdaca4'];
export const uid = () => crypto.randomUUID();
/** Editable metadata stays isolated; immutable model/media strings need no duplicate buffers. */
export const clone = cloneProjectData;
export function entity(kind: Kind, asset: string, name: string, position: Vec3 = [0, 0, 0]): Entity {
    return {
        id: uid(),
        kind,
        asset,
        name,
        color: kind === 'actor' ? COLORS[0] : '#d5d5d0',
        position,
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        visible: true,
        locked: false,
        height: 1.75,
        build: 'normal',
        gender: 'male',
        path: null,
        face: 'path',
        faceTarget: '',
        clips: [],
        pose: {},
        poseKeys: [],
        camera:
            kind === 'camera'
                ? {
                      aim: 'target',
                      focal: 28,
                      target: [0, 1, 0],
                      targetId: '',
                      targetHeight: 1.2,
                      mode: 'free',
                      offset: [0, 1.6, -1.8],
                      inheritRotation: true,
                      hideWalls: [],
                  }
                : null,
        count: 12,
        spacing: 0.75,
        seed: 42,
        reference: '',
        ...(asset === 'woman' ? { gender: 'female' as const, height: 1.65 } : {}),
        ...structuredClone(findAsset(asset)?.defaults ?? {}),
    };
}
export function clip(action: Action, start: number, end: number): Clip {
    return { id: uid(), action, start, end, speed: 1 };
}
export function demoProject(): Project {
    const a = entity('actor', 'person', '人物 A · 床边', [-0.5, 0, -0.75]);
    a.color = COLORS[1];
    a.rotation[1] = Math.PI / 2;
    a.clips = [clip('sit', 0, 7), clip('standup', 7, 9), clip('idle', 9, 15)];
    const b = entity('actor', 'person', '人物 B · 走向衣柜', [0.55, 0, 1.4]);
    b.color = COLORS[0];
    b.clips = [clip('idle', 0, 2), clip('walk', 2, 6), clip('turn', 6, 8), clip('idle', 8, 15)];
    b.path = {
        smooth: true,
        points: [
            { time: 2, position: [0.55, 0, 1.4] },
            { time: 4, position: [0.9, 0, 0.05] },
            { time: 6, position: [1.15, 0, -0.95] },
        ],
    };
    const c = entity('actor', 'person', '人物 C · 书桌', [-1.65, 0, 1.05]);
    c.color = COLORS[2];
    c.gender = 'female';
    c.height = 1.65;
    c.rotation[1] = -Math.PI / 2;
    c.clips = [clip('sit', 0, 15)];
    c.poseKeys = [
        { time: 0, pose: { head: 8 } },
        { time: 9, pose: { head: -12, headYaw: 30 } },
        { time: 12, pose: { head: 0, headYaw: 0 } },
    ];
    const d = entity('actor', 'person', '人物 D · 进门', [1.55, 0, 1.75]);
    d.color = COLORS[3];
    d.height = 1.8;
    d.clips = [clip('idle', 0, 3), clip('walk', 3, 6), clip('idle', 6, 9), clip('walk', 9, 13), clip('idle', 13, 15)];
    d.path = {
        smooth: false,
        points: [
            { time: 3, position: [1.55, 0, 1.75] },
            { time: 6, position: [1.3, 0, 0.65] },
            { time: 9, position: [1.3, 0, 0.65] },
            { time: 13, position: [0.1, 0, 0.6] },
        ],
    };
    const props = [
        entity('prop', 'bed', '双人床', [-1.25, 0, -0.9]),
        entity('prop', 'nightstand', '床头柜', [-2.08, 0, -1.66]),
        entity('prop', 'wardrobe', '衣柜', [1.35, 0, -1.78]),
        entity('prop', 'desk', '书桌', [-2.02, 0, 1.05]),
        entity('prop', 'chair', '座椅', [-1.65, 0, 1.05]),
        entity('prop', 'lamp', '台灯', [-2.08, 0.58, -1.66]),
        entity('prop', 'laptop', '电脑', [-2.02, 0.75, 1.05]),
    ];
    props.find((p) => p.asset === 'desk')!.rotation[1] = Math.PI / 2;
    props.find((p) => p.asset === 'chair')!.rotation[1] = -Math.PI / 2;
    props.find((p) => p.asset === 'laptop')!.rotation[1] = Math.PI / 2;
    const ca = entity('camera', 'camera', 'A · 室内全景', [2.15, 1.65, 1]);
    ca.camera!.focal = 20;
    ca.camera!.target = [-0.8, 1, -0.6];
    ca.path = {
        smooth: false,
        points: [
            { time: 0, position: [2.15, 1.65, 1] },
            { time: 15, position: [2.05, 1.6, 0.8] },
        ],
    };
    const cb = entity('camera', 'camera', 'B · 人物跟拍', [2.2, 1.5, 0.6]);
    cb.camera!.focal = 28;
    cb.camera!.targetHeight = 1.3;
    cb.camera!.targetId = b.id;
    cb.path = {
        smooth: true,
        points: [
            { time: 3, position: [2.2, 1.5, 0.6] },
            { time: 10, position: [2.2, 1.5, 0.15] },
        ],
    };
    const cc = entity('camera', 'camera', 'C · 主观视角', [0, 1.65, 0]);
    cc.camera!.mode = 'pov';
    cc.camera!.targetId = d.id;
    cc.camera!.offset = [0, 1.67, 0.13];
    cc.camera!.focal = 24;
    return {
        format: 'director-desk',
        version: 1,
        name: '卧室 · 四人调度',
        duration: 15,
        fps: 24,
        aspect: '16:9',
        room: { enabled: true, width: 4.8, depth: 4.2, height: 2.8 },
        entities: [a, b, c, d, ca, cb, cc, ...props],
        cuts: [
            { time: 0, cameraId: ca.id },
            { time: 5, cameraId: cb.id },
            { time: 10, cameraId: ca.id },
        ],
        references: [],
    };
}
export const aspectNumber = (a: string) => {
    const [w, h] = a.split(':').map(Number);
    return w / h;
};
export function outputSize(aspect: string, longEdge: number): [number, number] {
    const [w, h] = aspect.split(':').map(Number);
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    const divisor = gcd(w, h),
        a = w / divisor,
        b = h / divisor;
    const scale = Math.max(2, Math.floor(longEdge / Math.max(a, b) / 2) * 2);
    return [a * scale, b * scale];
}
export function getFrameCount(start: number, end: number, fps: number) {
    return Math.max(0, Math.ceil((end - start) * fps - 1e-8));
}
export function assertProject(input: unknown): asserts input is Project {
    const p = input as Project;
    const fail = (message: string): never => {
        throw new Error(`项目文件无效：${message}`);
    };
    const n = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    const v3 = (v: unknown) => Array.isArray(v) && v.length === 3 && v.every(n);
    if (!p || p.format !== 'director-desk' || ![1, 2].includes(p.version)) fail('不支持的文件格式或版本');
    if (
        typeof p.name !== 'string' ||
        p.name.length > 200 ||
        !n(p.duration) ||
        p.duration <= 0 ||
        !FRAME_RATES.includes(p.fps) ||
        !ASPECTS.includes(p.aspect)
    )
        fail('名称、时长、画幅或帧率错误');
    if (
        !p.room ||
        typeof p.room.enabled !== 'boolean' ||
        ![p.room.width, p.room.depth, p.room.height].every((x) => n(x) && x >= 2.3 && x <= 10000)
    )
        fail('房间各尺寸需在 2.3 至 10000 米之间');
    if (!Array.isArray(p.entities) || !Array.isArray(p.cuts) || !Array.isArray(p.references)) fail('缺少场景数据');
    assertModelResources(p);
    assertLighting(p.lighting);
    const safeId = (id: unknown) => typeof id === 'string' && /^[\p{L}\p{N}_:.-]{1,200}$/u.test(id);
    const ids = new Set<string>();
    for (const e of p.entities) {
        if (!e || !safeId(e.id) || ids.has(e.id) || !['actor', 'prop', 'camera', 'crowd'].includes(e.kind))
            fail('对象标识或类型错误');
        ids.add(e.id);
        if (
            e.kind === 'camera'
                ? e.asset !== 'camera'
                : !['external-model', 'composite'].includes(e.asset) && findAsset(e.asset)?.kind !== e.kind
        )
            fail('白模资产不存在或类型不匹配');
        if (e.kind !== 'camera' && e.camera !== null) fail('非摄影机对象不应包含摄影机配置');
        if (e.path !== null && (!e.path || typeof e.path !== 'object' || Array.isArray(e.path))) fail('路径数据错误');
        if (
            typeof e.name !== 'string' ||
            e.name.length > 200 ||
            typeof e.asset !== 'string' ||
            !/^#[0-9a-f]{6}$/i.test(e.color)
        )
            fail('对象名称或颜色错误');
        if (!v3(e.position) || !v3(e.rotation) || !v3(e.scale) || e.scale.some((x) => x <= 0)) fail('对象坐标错误');
        if (e.rotationAnimation !== undefined) {
            const animation = e.rotationAnimation;
            if (!animation || !v3(animation.pivot) || !Array.isArray(animation.keys) || animation.keys.length < 2)
                fail('旋转动画需要局部轴心和至少两个关键帧');
            animation.keys.forEach((key, index) => {
                if (!key || !n(key.time) || key.time < 0 || !v3(key.degrees) ||
                    (index > 0 && key.time <= animation.keys[index - 1].time))
                    fail('旋转关键帧需要递增时间和三个角度');
                assertEasing(key.easing);
            });
        }
        if (
            typeof e.visible !== 'boolean' ||
            typeof e.locked !== 'boolean' ||
            !(BUILDS as readonly string[]).includes(e.build) ||
            !(GENDERS as readonly string[]).includes(e.gender) ||
            !n(e.height) ||
            e.height < (isAnimalAsset(e.asset) ? 0.03 : 0.2) ||
            e.height > 10
        )
            fail('人物参数错误');
        if (
            !['path', 'fixed', 'target'].includes(e.face) ||
            typeof e.faceTarget !== 'string' ||
            typeof e.reference !== 'string'
        )
            fail('朝向或参考图错误');
        if (
            !Number.isInteger(e.count) ||
            e.count < 1 ||
            e.count > 1000 ||
            !n(e.spacing) ||
            e.spacing <= 0 ||
            !n(e.seed)
        )
            fail('群演参数错误');
        assertMemberPaths(e);
        const poseValid = (q: Pose) =>
            q &&
            typeof q === 'object' &&
            !Array.isArray(q) &&
            Object.entries(q).every(
                ([k, v]) =>
                    Object.hasOwn(assetJoints(e.asset), k) &&
                    (Array.isArray(v)
                        ? !isAnimalAsset(e.asset) &&
                          v.length === 3 &&
                          v.every((angle) => n(angle) && Math.abs(angle) <= 360)
                        : n(v) && Math.abs(v) <= 360),
            );
        if (
            !poseValid(e.pose) ||
            !Array.isArray(e.poseKeys) ||
            e.poseKeys.some((k) => !k || !n(k.time) || k.time < 0 || !poseValid(k.pose))
        )
            fail('姿态数据错误');
        if (new Set(e.poseKeys.map((k) => k.time)).size !== e.poseKeys.length) fail('姿态关键帧时间重复');
        if (!Array.isArray(e.clips)) fail('动作数据错误');
        const capabilities = findAsset(e.asset)?.capabilities;
        if (
            capabilities &&
            e.clips.some(
                (c) =>
                    c && c.action !== 'retarget' && (c.action === 'native' || !capabilities.actions.includes(c.action)),
            )
        )
            fail('该白模尚不支持此动作，请查询资产能力');
        if (capabilities && !capabilities.pose && (Object.keys(e.pose).length || e.poseKeys.length))
            fail('该白模不支持关节姿态');
        if (isAnimalAsset(e.asset) && e.footContact) fail('该动物尚不支持自动脚底贴合');
        if (e.clips.some((c) => !c)) fail('动作片段不能为空');
        if (new Set(e.clips.map((c) => c.id)).size !== e.clips.length) fail('动作片段标识重复');
        const clips = [...e.clips].sort((a, b) => a.start - b.start);
        for (let i = 0; i < clips.length; i++) {
            const c = clips[i];
            if (c.loop !== undefined && typeof c.loop !== 'boolean') fail('动作循环标记无效');
            assertNativeClip(c, !!e.external);
            assertRetargetClip(c, e, p);
            if (
                [c.offset, c.progressOffset, c.sourceDuration, c.turnAmount].some(
                    (v) => v !== undefined && (!n(v) || v < 0),
                ) ||
                (c.sourceDuration !== undefined && c.sourceDuration <= 0)
            )
                fail('动作分割参数错误');
            if (c.name !== undefined && (typeof c.name !== 'string' || !c.name.trim() || c.name.length > 100))
                fail('动作片段名称无效');
            if (
                !safeId(c.id) ||
                (!['native', 'retarget'].includes(c.action) && !Object.hasOwn(ACTIONS, c.action)) ||
                ![c.start, c.end, c.speed].every(n) ||
                c.start < 0 ||
                c.end <= c.start ||
                c.speed <= 0 ||
                (i > 0 && c.start < clips[i - 1].end)
            )
                fail('动作时间重叠或范围错误');
        }
        validatePropParameters(e);
        assertLightEntity(e);
        assertInitialPose(e.initialPose);
        if (e.kind === 'camera' && e.initialPose) fail('摄影机使用位置与朝向继承，不使用模型姿态');
        validateAssetParameters(e);
        if (e.parts !== undefined) {
            if (!Array.isArray(e.parts) || e.parts.length < 1 || e.parts.length > 32)
                fail('组合体需要 1 至 32 个部件');
            e.parts.forEach((part, index) => {
                const label = `组合体第 ${index + 1} 个部件`;
                if (!part || typeof part !== 'object' || Array.isArray(part)) fail(`${label}格式错误`);
                if (typeof part.shape !== 'string' || findAsset(part.shape)?.family !== 'shape-v1')
                    fail(`${label}的形状必须是形状素材（shape-*）`);
                if (!v3(part.at)) fail(`${label}的位置需要三个有限数值`);
                if (part.size !== undefined && (!v3(part.size) || part.size.some((x) => x <= 0)))
                    fail(`${label}的尺寸需要三个正数`);
                if (part.rotationDegrees !== undefined && !v3(part.rotationDegrees)) fail(`${label}的旋转需要三个有限数值`);
                if (part.color !== undefined && !/^#[0-9a-f]{6}$/i.test(String(part.color))) fail(`${label}的颜色格式错误`);
            });
        }
        assertContactAnchors(e);
        assertHandBinding(e, p);
        if (e.footContact !== undefined && typeof e.footContact !== 'boolean') fail('脚底贴合设置错误');
        for (const c of e.clips) if (c.blendIn !== undefined && (!n(c.blendIn) || c.blendIn < 0 || c.blendIn > 2)) throw Error('动作过渡时长无效');
        if (e.actionBlend !== undefined && (!n(e.actionBlend) || e.actionBlend < 0 || e.actionBlend > 2))
            fail('动作过渡时长错误');
        if (e.path) {
            if (typeof e.path.smooth !== 'boolean' || !Array.isArray(e.path.points) || e.path.points.length < 1)
                fail('路径至少需要一个位置点');
            const headings = e.path.points.some((w) => w?.heading !== undefined);
            if (headings && ((e.kind !== 'actor' && e.kind !== 'crowd') || e.path.points.some((w) => !n(w?.heading))))
                fail('路径 heading 仅支持人物／群演，且每个途经点都需设置有限弧度');
            e.path.points.forEach((w, i) => {
                if (
                    !w ||
                    !v3(w.position) ||
                    !n(w.time) ||
                    w.time < 0 ||
                    (i > 0 && w.time <= e.path!.points[i - 1].time)
                )
                    fail('路径时间必须递增');
                assertEasing(w.easing);
            });
            assertPathInterpolation(e.path);
            if (e.path.sections !== undefined) {
                if (!Array.isArray(e.path.sections) || !e.path.sections.length || e.path.sections.some((s) => !s))
                    fail('路径片段不能为空');
                const parts = [...e.path.sections].sort((a, b) => a.start - b.start);
                parts.forEach((s, i) => {
                    if (
                        !s ||
                        ![s.start, s.end, s.from, s.to].every(n) ||
                        s.start < 0 ||
                        s.end <= s.start ||
                        s.to <= s.from ||
                        s.from < e.path!.points[0].time - 1e-7 ||
                        s.to > e.path!.points.at(-1)!.time + 1e-7 ||
                        (i > 0 && s.start < parts[i - 1].end - 1e-7)
                    )
                        fail('路径片段重叠或范围错误');
                });
            }
        }
        if (e.kind === 'camera') {
            const c = e.camera;
            if (
                !c ||
                !['target', 'manual'].includes(c.aim) ||
                !n(c.focal) ||
                c.focal < 8 ||
                c.focal > 300 ||
                !v3(c.target) ||
                !v3(c.offset) ||
                !n(c.targetHeight) ||
                typeof c.targetId !== 'string' ||
                !['free', 'follow', 'pov'].includes(c.mode) ||
                typeof c.inheritRotation !== 'boolean' ||
                !Array.isArray(c.hideWalls) ||
                c.hideWalls.some((w) => !['north', 'south', 'east', 'west', 'ceiling'].includes(w))
            )
                fail('摄影机参数错误');
            assertCameraLookPath(c!.targetPath);
            if (c!.focalKeys !== undefined) assertAnimated({ keys: c!.focalKeys }, 8, 300, '摄影机焦距');
        }
    }
    const cameras = p.entities.filter((e) => e.kind === 'camera');
    for (const e of p.entities) assertExternalModel(e, p);
    if (!cameras.length) fail('至少需要一台摄影机');
    for (const e of p.entities) {
        const hidden = e.camera?.hiddenEntityIds;
        if (
            hidden !== undefined &&
            (!Array.isArray(hidden) ||
                new Set(hidden).size !== hidden.length ||
                hidden.some((id) => !p.entities.some((t) => t.id === id && t.kind !== 'camera')))
        )
            fail('摄影机隐藏对象重复、不存在或为摄影机');
        if (e.camera?.targetId) {
            const target = p.entities.find((t) => t.id === e.camera!.targetId);
            if (!target || target.kind === 'camera') fail('摄影机绑定目标不存在或为摄影机');
        }
        if (e.faceTarget && !ids.has(e.faceTarget)) fail('朝向目标不存在');
    }
    if (!p.cuts.length || p.cuts[0]?.time !== 0) fail('切镜必须从零秒开始');
    p.cuts.forEach((c, i) => {
        if (c.subjectIds !== undefined && (!Array.isArray(c.subjectIds) || c.subjectIds.some(id => !p.entities.some(e => e.id === id && (e.kind === 'actor' || e.kind === 'crowd'))))) fail('镜头主体不存在');
        if (c.name !== undefined && typeof c.name !== 'string') fail('镜头名称无效');
        if (
            !c ||
            !n(c.time) ||
            c.time < 0 ||
            c.time >= p.duration ||
            (i > 0 && c.time <= p.cuts[i - 1].time) ||
            !cameras.some((e) => e.id === c.cameraId)
        )
            fail('切镜时间或机位错误');
    });
    const referenceIds = new Set<string>();
    for (const r of p.references) {
        if (
            !r ||
            !safeId(r.id) ||
            referenceIds.has(r.id) ||
            typeof r.name !== 'string' ||
            typeof r.data !== 'string' ||
            !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(r.data)
        )
            fail('参考图标识重复或内容不是内嵌 PNG、JPEG、WebP');
        referenceIds.add(r.id);
    }
    for (const e of p.entities) if (e.reference && !referenceIds.has(e.reference)) fail('对象关联的参考图不存在');
}
/** File boundaries return an owned copy; in-memory edits only need assertProject. */
export function validateProject(input: unknown): Project {
    assertProject(input);
    return clone(input);
}
