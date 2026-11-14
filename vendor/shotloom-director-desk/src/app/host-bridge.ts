import { ExportArtifacts, type Artifact } from '@/core/exporting/artifacts.ts';
import { packageDelivery, shotTable, deliveryShots } from '@/core/exporting/delivery-package.ts';
import { getFrameCount } from '@/core/model.ts';
import { describeAsset } from '@/core/assets/agent-catalog.ts';
import { ACTION_TIMING } from '@/core/animation/action-timing.ts';
import { directorContext } from '@/core/director-context.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { readSceneDocument } from '@/core/scenes/sequence-project.ts';
import { ACTIONS, ASPECTS, BUILDS, FRAME_RATES, GENDERS, type Joint, type Vec3 } from '@/core/model.ts';
import { assetGroups, searchAssets } from '@/core/asset-catalog.ts';
import { CAMERA_PLACEMENTS } from '@/core/cinematography/camera-placements.ts';
import { CAMERA_PRESETS } from '@/core/cinematography/camera-presets.ts';
import { exportVideo, type ExportOptions } from '@/core/export.ts';
import { outputSize } from '@/core/model.ts';
import { download } from '@/core/storage.ts';
import { videoFilename } from '@/core/exporting/plan.ts';
import { safeFilename } from '@/core/exporting/filename.ts';
import { createScene } from '@/core/scene-templates.ts';
import { FRAMING_NAMES } from '@/state/commands/scene.ts';
import { patchFieldCatalog } from '@/core/editor/patch-fields.ts';
import * as THREE from 'three';
import { setEditorTheme } from '@/core/editor/theme-state.ts';
import { setReferenceBackdrop } from '@/state/reference-backdrop.ts';
import { setLanguage } from '@/shared/i18n/locale.ts';
import type { BatchEdit } from '@/state/batch-edits.ts';
import { ASSET_ORIGIN } from '@/state/batch-edits.ts';
import { DirectorCommandError, classifyDirectorError } from '@/core/errors.ts';
import { isInFrame } from '@/core/spatial/checks.ts';
import { worldContactAnchors } from '@/core/assets/contact-anchors.ts';
import { modelNodeHidden } from '@/core/resources/model-node-visibility.ts';
import { DirectorHostSession } from '@/core/host-session.ts';

type Input = Record<string, unknown>;
/** 一次筛选最多返回的素材条数：够覆盖"建筑构件"这类最大分组，又不至于把回执撑回几十 KB。 */
const CATALOG_MATCH_LIMIT = 40;
const origin = window.location.origin;
const parent = window.parent;
const hostSession = new DirectorHostSession();
let lastRevision = useEditorStore.getState().revision;
let lastSelected = useEditorStore.getState().selected;
let saveTimer = 0;
let coverTimer = 0;
let coveredRevision = -1;
function scheduleCover() {
    window.clearTimeout(coverTimer);
    const revision = useEditorStore.getState().revision;
    coverTimer = window.setTimeout(async () => {
        const state = useEditorStore.getState();
        if (!hostSession.connected || coveredRevision === revision || state.revision !== revision) return;
        if (!state.engineReady || state.busy || state.playing || session.engineOrNull?.exporting) { scheduleCover(); return; }
        try {
            const preview = await session.renderPreview({ seconds: 0, cameraId: 'program', size: 640 });
            if (useEditorStore.getState().revision === revision) {
                send('project-cover', { dataUrl: preview.dataUrl, revision });
                coveredRevision = revision;
            }
        } catch { /* Cover is optional; the next successful scene change schedules a fresh attempt. */ }
    }, 800);
}
let panorama: THREE.Texture | null = null;
let panoramaRequest = 0;
let panoramaEngine: object | null = null;
type ExportJobState = { owner: string; status: 'running' | 'completed' | 'delivery_failed' | 'failed' | 'canceled'; phase: 'encoding' | 'retaining' | 'ingesting' | 'done'; progress: number; filename: string; width: number; height: number; fps: number; frameCount: number; codec: string; artifact?: Artifact; bytes?: number; error?: string; controller: AbortController };
const artifacts = new ExportArtifacts();
let artifactHostScope = 'standalone';
const artifactOwner = () => { const id = session.history.document().projectId; if (!id) throw Error('工程缺少 projectId'); return `${artifactHostScope}:${id}`; };
const exportJobs = new Map<string, ExportJobState>();
const send = (type: string, payload: Input = {}) => parent.postMessage({ type: `storyai:director-desk-${type}`, payload }, origin);
export function requestHostClose() {
    if (parent !== window) send('close');
}
export function requestHostAgentOpen(entityId?: string) {
    if (parent !== window) send('open-agent', entityId ? { entityId } : {});
}
const string = (value: unknown) => String(value ?? '');
const number = (value: unknown) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw Error('需要有限数值');
    return value;
};
const axis = (value: unknown): 0 | 1 | 2 => {
    if (value !== 0 && value !== 1 && value !== 2) throw Error('轴必须为 0、1 或 2');
    return value;
};
const vector = (value: unknown): Vec3 => {
    if (!Array.isArray(value) || value.length !== 3) throw Error('坐标必须为三个数值');
    return [number(value[0]), number(value[1]), number(value[2])];
};

/**
 * 每条命令的参数契约与副作用分级，和 `commands` 一一对应（测试会校验两边不漂移）。
 *
 * `kind` 是给宿主 Agent 用的：view 只改播放头、选区或视口，不影响工程文档；
 * edit 改工程；export 会产出文件或启动导出任务。宿主据此决定要不要收审批，
 * 因此这里必须如实描述，不能为了少收审批把写操作标成 view。
 */
export type CommandKind = 'view' | 'edit' | 'export';

interface CommandSpec {
    kind: CommandKind;
    /** 参数名 → 说明（含类型与可选值）。没有参数时省略。 */
    args?: Record<string, string>;
    /**
     * 编辑器内部命令：不进默认 snapshot，`director_desk_command` 也会拒绝它。
     *
     * 分档不是为了砍能力，而是收口。实测五次会话：batch 上线前模型把 51 次调用撒在细粒度
     * 命令上（24 次逐轴设坐标、15 次先选中再改），上线后细粒度调用降到 0。这些命令仍然
     * 服务界面和 undo 历史，只是不该再作为模型的写入口——一次选错路就是一整轮返工。
     */
    agentHidden?: boolean;
    /** 被隐藏时告诉模型该改用哪条路径；只有 agentHidden 的写命令需要。 */
    prefer?: string;
}

const commandSpecs: Record<string, CommandSpec> = {
    undo: { kind: 'edit' },
    redo: { kind: 'edit' },
    reset_project: { kind: 'edit' },
    // 导出当前画面会渲染全分辨率并写入宿主画布，属于 export 而不是 view。
    export_image: { kind: 'export' },
    render_preview: { kind: 'view', args: {
        seconds: 'number，可选，默认当前播放头；须在场景时长内',
        cameraId: 'string，可选，默认当前预览机位；program 为剪辑合成视角',
        size: '640 | 1280，默认 640',
    } },
    render_preview_sheet: { kind: 'view', args: {
        timesSec: 'number[]，必填，1 至 8 个场景时长内的秒数；返回逐格标秒数的拼图，用于检查时间线连续性',
        cameraId: 'string，可选，默认当前预览机位；program 为剪辑合成视角',
    } },
    // 俯视平面图：与俯视的布局参考图逐区域对比，不改工程。
    render_plan: { kind: 'view', args: {
        cutHeight: 'number，可选，剖切高度（米），默认 1.5；高于它的顶板、横梁、过梁被切掉，门洞显示为缺口',
        area: '{ minX, maxX, minZ, maxZ }，可选，只看这一块（米）；默认框住整套布景、人物路径和机位',
        seconds: 'number，可选，默认当前播放头；决定人物和跟随机位画在哪里',
        size: '640 | 1024 | 1536，可选，长边像素，默认 1024',
    } },
    // 与参考图做确定性比对：给出"哪里像、哪里不像"，不构成画面验收。
    compare_reference: { kind: 'view', args: {
        referenceUrl: 'string，可选，参考图地址；省略时用宿主接入的参考图',
        mode: 'plan | frame，可选，默认 plan：平面图与平面参考比；frame 用指定机位的画面比',
        seconds: 'number，可选，默认当前播放头',
        cameraId: 'string，可选，mode=frame 时的机位，默认当前预览机位；program 为剪辑合成视角',
        size: '640 | 1024 | 1536，可选，默认 1024',
        cutHeight: 'number，可选，mode=plan 时的剖切高度，默认 1.5',
        area: '{ minX, maxX, minZ, maxZ }，可选，mode=plan 时只比这一块（米）',
    } },
    inspect_model: { kind: 'view', args: {
        id: 'string，可选，默认当前选中的建筑或道具 ID；必须来自 snapshot.document.entities',
        views: "string[]，可选，1 至 6 个视角：front、back、left、right、top、three_quarter；默认 front/left/top/three_quarter",
    } },

    // 选择、播放头与视口：不影响工程文档
    select_entity: { kind: 'view', args: { id: 'string，实体 ID' } },
    select_scene: { kind: 'view', agentHidden: true },
    seek: { kind: 'view', args: { seconds: 'number，项目时间（秒）' } },
    toggle_play: { kind: 'view', agentHidden: true },
    step_frame: { kind: 'view', agentHidden: true, args: { direction: '1 或 -1' } },
    set_view: { kind: 'view', agentHidden: true, args: { view: "'stage' | 'pip' | 'split' | 'shot'" } },
    set_preview: { kind: 'view', agentHidden: true, args: { cameraId: 'string，机位 ID' } },
    set_transform_mode: { kind: 'view', agentHidden: true, args: { mode: "'translate' | 'rotate' | 'scale'" } },
    set_inspector_tab: { kind: 'view', agentHidden: true, args: { tab: 'string，检查器页签' } },
    toggle_grid: { kind: 'view', agentHidden: true },
    view_home: { kind: 'view', agentHidden: true },
    view_top: { kind: 'view', agentHidden: true },
    focus_selected: { kind: 'view', agentHidden: true },
    set_loop: { kind: 'view', agentHidden: true, args: { value: 'boolean' } },
    set_joint_nodes_visible: { kind: 'view', agentHidden: true, args: { visible: 'boolean' } },
    select_joint: { kind: 'view', args: { joint: 'string，关节名' } },
    select_clip: { kind: 'view', agentHidden: true, args: { id: 'string；传 null 取消选择' } },
    select_path_section: { kind: 'view', agentHidden: true, args: { entityId: 'string', index: 'number' } },
    select_path_point: { kind: 'view', agentHidden: true, args: { index: 'number' } },

    // 实体与场景编辑
    add_asset: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 add_asset', args: { assetId: 'string，取自 catalog.assets[].id；回执含新实体 entityId、position 与实测 bounds' } },
    add_camera: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 add_camera（可同时指定名称与位置）', args: { fromView: 'boolean，true 表示从当前视角生成机位' } },
    rename_entity: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.name', args: { name: 'string' } },
    duplicate_entity: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 duplicate_entity' },
    delete_entity: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 delete_entity（会一并清理引用）', args: { replacementCamera: 'string，可选；删除机位时的替补机位 ID' } },
    ground_entity: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.position（把 y 设成落地高度）' },
    set_entity_color: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.color', args: { color: 'string，颜色值' } },
    set_entity_flag: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.visible', args: { key: "'visible' | 'locked'", value: 'boolean' } },
    // 逐轴命令只服务编辑器内的拖动手感；Agent 用 batch_edit 的 set_entity 向量补丁（position/rotationDegrees/scale）。
    set_position_axis: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.position（向量）', args: { axis: '0 | 1 | 2（整轴值；Agent 请改用 batch_edit set_entity.position）', value: 'number' } },
    set_rotation_axis: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.rotationDegrees（向量）', args: { axis: '0 | 1 | 2（整轴值；Agent 请改用 batch_edit set_entity.rotationDegrees）', degrees: 'number' } },
    set_scale_axis: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.scale（向量）', args: { axis: '0 | 1 | 2（整轴值；Agent 请改用 batch_edit set_entity.scale）', value: 'number' } },
    set_height: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.height', args: { value: 'number' } },
    set_entity_option: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity.build / gender', args: { key: "'build' | 'gender'", value: 'string' } },
    // patch 类命令的合法键名一律来自 catalog.patchFields，不能从现有对象反推。
    set_camera_field: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_camera', args: { patch: 'object，机位字段补丁；合法键名与类型见 catalog.patchFields.set_camera_field' } },
    set_light_field: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_light', args: { patch: 'object，灯光字段补丁；合法键名见 catalog.patchFields.set_light_field' } },
    set_lighting_field: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_lighting', args: { patch: 'object，环境光字段补丁；合法键名见 catalog.patchFields.set_lighting_field' } },
    update_room: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_room', args: { patch: 'object，房间字段补丁；合法键名见 catalog.patchFields.update_room' } },
    update_project_settings: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_project', args: { patch: 'object，工程设置补丁；合法键名见 catalog.patchFields.update_project_settings' } },
    apply_framing: { kind: 'edit', args: { name: 'string，构图预设名', cameraId: 'string，可选机位 ID；省略则用当前选中的机位' } },
    add_camera_placement: { kind: 'edit', args: { id: 'string，取自 catalog.cameraPlacements[].id；基于当前选中主体添加机位' } },
    apply_camera_preset: { kind: 'edit', args: { id: 'string，取自 catalog.cameraPresets[].id', cameraId: 'string，可选机位 ID；省略则用当前选中的机位', subjectId: 'string，可选跟拍主体 ID', foregroundId: 'string，前景运镜必填的遮挡物 ID' } },

    // 戏段时间线
    add_cut: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 add_cut' },
    remove_cut: { kind: 'edit', args: { index: 'number' } },
    set_duration: { kind: 'edit', args: { seconds: 'number' } },
    // 把时长拉到现有内容末尾：set_duration 缩短后不会自动补回，超出部分会静默不可达。
    extend_duration: { kind: 'edit' },
    add_action: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 add_action', args: { action: 'string，取自 catalog.actions' } },
    // 声明式路径：时间点由调用方给出，不依赖当前选区和播放头。
    set_entity_path: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path', args: {
        entityId: 'string，实体 ID；跟随机位需先把 camera.mode 设为 free',
        points: '[{ position: [x,y,z], timeSec: number }]，必填，至少 2 个；timeSec 严格递增',
        smooth: 'boolean，可选，默认 true',
    } },
    // 声明式运镜：用 dolly / truck / crane / orbit / hold 描述，编译成机位关键帧。
    set_campath: { kind: 'edit', args: {
        source: 'string，必填，campath DSL 文本：首行 campath "名称"，然后 look target "id" | look at x y z | look ahead，from x y z [fov n]，再接若干段 move to / dolly in|out / truck left|right / crane up|down / orbit left|right / hold，每段时长写「3s」',
        cameraId: 'string，可选机位 ID；省略则用当前选中的机位',
        atSec: 'number，可选，起始秒，默认当前播放头',
    } },
    batch_edit: { kind: 'edit', args: {
        expectedSessionId: 'string，必填，取自最新 snapshot.sessionId；iframe 重新打开后需重新读取快照',
        expectedRevision: 'number，必填，取自最新 snapshot.revision；不匹配时整批拒绝，须重新读取受影响实体后再决定如何提交',
        edits: 'BatchEdit[]，必填，非空；建议每批 1–8 项，超过 8 项仍可提交，没有硬性数量上限。支持 set_entity、set_camera、set_light、set_lighting、set_room、set_project、set_path、set_rotation_animation、add_asset、add_wall、add_room、add_prop、add_camera、add_cut、add_action、set_clip、remove_clip、delete_entity、duplicate_entity；具体字段见 director_desk_batch 工具描述',
        validateOnly: 'boolean，可选，默认 false。为 true 时按真实规则预检、不写入任何东西；失败时指出首个问题，修正后可再次预检',
    } },
    set_clip_field: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_clip', args: { id: 'string，片段 ID', patch: 'object，片段字段补丁' } },
    remove_clip: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 remove_clip', args: { id: 'string，片段 ID' } },
    remove_selected_path_section: { kind: 'edit' },
    split_clip: { kind: 'edit' },
    set_action_blend: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity（无直接等价时改用 add_action 重新安排）', args: { value: 'number' } },
    set_foot_contact: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_entity 配合 position', args: { value: 'boolean' } },
    set_joint_angle: { kind: 'edit', args: { joint: 'string，关节名', axis: '0 | 1 | 2', degrees: 'number' } },
    reset_pose: { kind: 'edit' },
    mirror_pose: { kind: 'edit' },
    record_pose_key: { kind: 'edit' },
    seek_pose_key: { kind: 'view', agentHidden: true, args: { index: 'number' } },
    delete_pose_key: { kind: 'edit', args: { index: 'number' } },

    // 路径
    start_path: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path（不依赖选区与播放头）' },
    set_path_draw_mode: { kind: 'view', agentHidden: true, args: { mode: "'points' | 'freehand'" } },
    set_path_surface_mode: { kind: 'view', agentHidden: true, args: { mode: "'surface' | 'ground'" } },
    set_path_draw_duration: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path（时间点由你给出）', args: { seconds: 'number' } },
    add_path_point: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path（一次给出全部关键时点）', args: { position: '[x, y, z] 三个数值' } },
    add_freehand_stroke: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path', args: { points: '[[x, y, z], ...] 坐标数组' } },
    finish_path: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path' },
    cancel_path: { kind: 'edit' },
    clear_path: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path（用新路径覆盖）' },
    append_path_point: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path' },
    remove_path_point: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path', args: { index: 'number' } },
    hold_path_point: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path' },
    set_path_point_time: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path', args: { index: 'number', seconds: 'number' } },
    set_path_point_position: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path', args: { index: 'number', axis: '0 | 1 | 2', value: 'number' } },

    // 关键帧与编辑辅助：只改工程或视口呈现，不产出文件
    record_position_key: { kind: 'edit', agentHidden: true, prefer: 'batch_edit 的 set_path（显式关键时点）' },
    record_focal_key: { kind: 'edit', agentHidden: true, prefer: 'set_campath（按节拍写焦距），或 batch_edit 的 set_camera.focalKeys' },
    remove_focal_key: { kind: 'edit', args: { index: 'number，焦距关键帧序号' } },
    set_placement_snap: { kind: 'view', agentHidden: true, args: { step: 'number，米；0 关闭网格吸附。取自 catalog.snapSteps' } },
    set_object_snap: { kind: 'view', agentHidden: true, args: { enabled: 'boolean，拖动道具时贴合附近表面与边界' } },
    set_preview_quality: { kind: 'view', agentHidden: true, args: { quality: "'full' | 'draft'，取自 catalog.previewQualities" } },
    set_label_mode: { kind: 'view', agentHidden: true, args: { mode: "'off' | 'selected' | 'all'，取自 catalog.labelModes" } },

    // 镜头与空间核验
    export_shot: { kind: 'export', args: { index: 'number，切镜序号，从 0 开始；取自 scene_summary 或 document.cuts' } },
    entity_relations: { kind: 'view', args: { sourceId: 'string，源实体 ID', targetId: 'string，目标实体 ID', seconds: 'number，可选，采样时间', cameraIds: 'string[]，可选，默认所有机位；可见性按中心点视锥和实际网格射线测量' } },
    spatial_check: { kind: 'view', args: {
        subjectIds: 'string[]，可选，显式检查主体；[] 跳过取景/遮挡主体检查但保留碰撞与机位检查；省略时取镜头 subjectIds，再退回机位目标',
        start: 'number，可选，默认 0',
        end: 'number，可选，默认工程时长',
        sampleRate: 'number，可选，每秒采样次数，默认 4',
        cameraId: 'string，可选，默认 program 按切镜',
        includeObstacles: 'boolean，可选，默认 true',
        includeFraming: 'boolean，可选，默认 true（人物是否出画）',
    } },

    // 戏段与查询
    scene_list: { kind: 'view' },
    scene_read: { kind: 'view', args: { id: 'string，可选戏段 ID', options: 'object，可选读取选项' } },
    history_status: { kind: 'view' },
    scene_switch: { kind: 'edit', args: { id: 'string，戏段 ID' } },
    scene_create: { kind: 'edit', args: { name: 'string，戏段名', copyCurrent: 'boolean，true 复制当前戏段' } },
    scene_rename: { kind: 'edit', args: { id: 'string，戏段 ID', name: 'string，新名称' } },
    scene_remove: { kind: 'edit', args: { id: 'string，戏段 ID（不能删最后一个）' } },

    // 导出
    export_project: { kind: 'export', args: { filename: 'string，可选文件名（不含扩展名）' } },
    // 产出完整文档（可能很大）而不是只读视图：归 export，宿主据此决定是否收审批。
    export_scene: { kind: 'export' },
    import_scene: { kind: 'edit', args: { document: 'object，由 export_scene 产出的完整文档', label: 'string，可选操作名' } },
    scene_summary: { kind: 'view' },
    // 只改界面呈现，不动工程文档；与 set_view 同类。
    set_theme: { kind: 'view', agentHidden: true, args: { theme: "'light' | 'dark'" } },
    export_video_start: { kind: 'export', args: {
        size: '640 | 1280 | 1920，默认 1280',
        format: "'mp4' | 'webm'，默认 mp4",
        fps: 'number，须属于 catalog.frameRates',
        start: 'number，起始秒，默认 0',
        end: 'number，结束秒，默认工程时长',
        cameraId: 'string，机位 ID，默认 program',
        filename: 'string，可选文件名',
        monochrome: 'boolean，可选黑白渲染',
    } },
    export_artifact_list: { kind: 'view' },
    export_artifact_read: { kind: 'view', args: { artifactId: 'string，稳定产物 ID；返回当前页面有效的下载 URL' } },
    export_artifact_deliver: { kind: 'export', args: { artifactId: 'string', mode: "'ingest' | 'download'，ingest 重试入库且不重新编码；download 下载真实文件" } },
    export_artifact_remove: { kind: 'export', args: { artifactId: 'string，删除当前工程保留的导出文件' } },
    shot_list: { kind: 'view' },
    export_delivery_package: { kind: 'export', args: { videoArtifactId: 'string，当前场景版本导出的视频产物 ID', filename: 'string，可选交付包名；返回 ZIP 的稳定 artifactId，包含视频、场景、镜头表、预览和 manifest' } },
    export_video_job: { kind: 'view', args: { jobId: 'string，export_video_start 返回的 jobId' } },
    export_video_cancel: { kind: 'export', args: { jobId: 'string' } },
};

const commands: Record<string, (input: Input) => unknown> = {
    undo: () => session.undo(), redo: () => session.redo(),
    record_position_key: () => session.recordPositionKeyAtPlayhead(),
    record_focal_key: () => session.recordFocalKeyAtPlayhead(),
    remove_focal_key: i => session.removeFocalKey(number(i.index)),
    set_placement_snap: i => session.setPlacementSnap(number(i.step)),
    set_object_snap: i => session.setObjectSnap(Boolean(i.enabled)),
    set_preview_quality: i => session.setPreviewQuality(i.quality === 'draft' ? 'draft' : 'full'),
    set_label_mode: i => session.setLabelMode(
        i.mode === 'off' || i.mode === 'all' ? i.mode : 'selected',
    ),
    export_shot: i => {
        const index = number(i.index);
        const cuts = session.project.cuts;
        if (!Number.isInteger(index) || index < 0 || index >= Math.max(cuts.length, 1))
            throw Error(`镜头序号无效：${index}；当前共 ${Math.max(cuts.length, 1)} 个镜头`);
        const start = cuts[index]?.time ?? 0;
        const end = cuts[index + 1]?.time ?? session.project.duration;
        return session.exportShot({ index, cameraId: cuts[index]?.cameraId ?? '', start, end });
    },
    entity_relations: async i => {
        const engine = session.engineOrNull, state = useEditorStore.getState();
        if (!engine || state.busy || engine.exporting) throw Error('导演台未准备好或正在执行其他任务');
        const seconds = i.seconds === undefined ? state.time : number(i.seconds);
        if (seconds < 0 || seconds > session.project.duration) throw Error('采样时间超出场景');
        const source = session.project.entities.find(e => e.id === i.sourceId), target = session.project.entities.find(e => e.id === i.targetId);
        if (!source || !target) throw Error('源实体或目标实体不存在');
        session.beginBusy();
        try {
            await engine.prepareOutput(seconds);
            engine.sample(seconds);
            const sampledTransform = (entity: typeof source) => {
                const root = entity.kind === 'camera' ? engine.cameras.get(entity.id) : engine.models.get(entity.id);
                if (!root) throw Error(`实体尚无可采样模型：${entity.id}`);
                root.updateWorldMatrix(true, false);
                const forward = new THREE.Vector3(0, 0, entity.kind === 'camera' ? -1 : 1).applyQuaternion(root.getWorldQuaternion(new THREE.Quaternion()));
                return { position: root.getWorldPosition(new THREE.Vector3()), yaw: Math.atan2(forward.x, forward.z) };
            };
            const sampledSource = sampledTransform(source), sampledTarget = sampledTransform(target);
            const a = sampledSource.position, b = sampledTarget.position, delta = b.clone().sub(a);
            const yaw = sampledSource.yaw;
            const local = delta.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -yaw);
            const visibility = [];
            for (const [id, camera] of engine.cameras) {
                if (Array.isArray(i.cameraIds) && !i.cameraIds.includes(id)) continue;
                camera.updateWorldMatrix(true, false);
                const root = engine.models.get(target.id);
                const center = root ? new THREE.Box3().setFromObject(root).getCenter(new THREE.Vector3()) : b;
                const origin = camera.getWorldPosition(new THREE.Vector3()), direction = center.clone().sub(origin);
                const distance = direction.length();
                const ray = new THREE.Raycaster(origin, direction.normalize(), 0, Math.max(0, distance - 0.001));
                const blockers = [...engine.models].filter(([entityId, model]) => entityId !== target.id && model.visible && ['prop', 'actor', 'crowd'].includes(session.project.entities.find(e => e.id === entityId)?.kind ?? '')).map(([, model]) => model);
                if (session.project.room.enabled) blockers.push(engine.roomGroup);
                const hit = ray.intersectObjects(blockers, true).find(hit => {
                    for (let node: THREE.Object3D | null = hit.object; node; node = node.parent) if (!node.visible) return false;
                    return !modelNodeHidden(hit.object);
                });
                visibility.push({ cameraId: id, inFrustum: isInFrame(center.toArray(), camera), centerOccluded: Boolean(hit), method: 'center-ray-mesh' });
            }
            const targetRoot = engine.models.get(target.id);
            const bearing = Math.atan2(local.x, local.z);
            const yawDifference = sampledTarget.yaw - yaw;
            const targetBearing = Math.atan2(-delta.x, -delta.z) - sampledTarget.yaw;
            const sourceFacingTargetDegrees = Math.abs(THREE.MathUtils.radToDeg(bearing));
            const targetFacingSourceDegrees = Math.abs(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(targetBearing), Math.cos(targetBearing))));
            return {
                seconds, sourceId: source.id, targetId: target.id,
                distanceMeters: delta.length(), horizontalDistanceMeters: Math.hypot(delta.x, delta.z),
                relativePositionLocal: local.toArray(), bearingDegrees: THREE.MathUtils.radToDeg(bearing),
                relativeDirection: Math.hypot(delta.x, delta.z) < 1e-6 ? 'coincident' : ['front', 'front_right', 'right', 'back_right', 'back', 'back_left', 'left', 'front_left'][(Math.round(bearing / (Math.PI / 4)) + 8) % 8],
                facingAngleDegrees: THREE.MathUtils.radToDeg(Math.atan2(Math.sin(yawDifference), Math.cos(yawDifference))),
                sourceFacingTargetDegrees, targetFacingSourceDegrees, facingToleranceDegrees: 45,
                facingEachOther: Math.hypot(delta.x, delta.z) >= 1e-6 && sourceFacingTargetDegrees <= 45 && targetFacingSourceDegrees <= 45,
                cameraVisibility: visibility,
                inCameraView: target.visible ? visibility.filter(v => v.inFrustum && !v.centerOccluded).map(v => v.cameraId) : [],
                targetAnchors: targetRoot ? worldContactAnchors(target, targetRoot) : [],
            };
        } finally { engine.restorePreview(state.time); session.endBusy(); }
    },
    spatial_check: i => session.runSpatialCheck({
        ...(i.subjectIds === undefined ? {} : { subjectIds: Array.isArray(i.subjectIds) ? i.subjectIds.map(string) : (() => { throw Error('subjectIds 必须是数组'); })() }),
        ...(i.start === undefined ? {} : { start: number(i.start) }),
        ...(i.end === undefined ? {} : { end: number(i.end) }),
        ...(i.sampleRate === undefined ? {} : { sampleRate: number(i.sampleRate) }),
        ...(i.cameraId === undefined ? {} : { cameraId: string(i.cameraId) }),
        ...(i.includeObstacles === undefined ? {} : { includeObstacles: i.includeObstacles !== false }),
        ...(i.includeFraming === undefined ? {} : { includeFraming: i.includeFraming !== false }),
    }),
    reset_project: () => session.resetProject(),
    export_image: () => session.snapshot(),
    render_preview: i => session.renderPreview({
        ...(i.seconds === undefined ? {} : { seconds: number(i.seconds) }),
        ...(i.cameraId === undefined ? {} : { cameraId: string(i.cameraId) }),
        ...(i.size === undefined ? {} : { size: number(i.size) }),
    }),
    render_preview_sheet: i => session.renderPreviewSheet({
        timesSec: Array.isArray(i.timesSec) ? i.timesSec.map(number) : [],
        ...(i.cameraId === undefined ? {} : { cameraId: string(i.cameraId) }),
    }),
    render_plan: i => {
        const area = i.area && typeof i.area === 'object' ? i.area as Input : undefined;
        return session.renderPlan({
            ...(i.cutHeight === undefined ? {} : { cutHeight: number(i.cutHeight) }),
            ...(i.seconds === undefined ? {} : { seconds: number(i.seconds) }),
            ...(i.size === undefined ? {} : { size: number(i.size) }),
            ...(area ? { area: { minX: number(area.minX), maxX: number(area.maxX), minZ: number(area.minZ), maxZ: number(area.maxZ) } } : {}),
        });
    },
    compare_reference: i => {
        const area = i.area && typeof i.area === 'object' ? i.area as Input : undefined;
        return session.compareReference({
            ...(i.referenceUrl === undefined ? {} : { referenceUrl: string(i.referenceUrl) }),
            ...(i.mode === 'frame' ? { mode: 'frame' as const } : {}),
            ...(i.seconds === undefined ? {} : { seconds: number(i.seconds) }),
            ...(i.cameraId === undefined ? {} : { cameraId: string(i.cameraId) }),
            ...(i.size === undefined ? {} : { size: number(i.size) }),
            ...(i.cutHeight === undefined ? {} : { cutHeight: number(i.cutHeight) }),
            ...(area ? { area: { minX: number(area.minX), maxX: number(area.maxX), minZ: number(area.minZ), maxZ: number(area.maxZ) } } : {}),
        });
    },
    inspect_model: i => session.inspectModel({
        ...(i.id === undefined ? {} : { id: string(i.id) }),
        ...(i.views === undefined ? {} : { views: i.views as string[] }),
    }),
    select_entity: i => session.selectEntity(string(i.id)),
    select_scene: () => session.selectScene(),
    seek: i => session.seek(number(i.seconds)),
    toggle_play: () => session.togglePlay(),
    step_frame: i => session.stepFrame(i.direction === -1 ? -1 : 1),
    set_view: i => session.setView(i.view as 'stage' | 'pip' | 'split' | 'shot'),
    set_preview: i => session.setPreview(string(i.cameraId)),
    set_transform_mode: i => session.setTransformMode(i.mode as 'translate' | 'rotate' | 'scale'),
    set_inspector_tab: i => session.setInspectorTab(i.tab as Parameters<typeof session.setInspectorTab>[0]),
    add_asset: i => session.addAsset(string(i.assetId)),
    add_camera: i => session.addCamera(i.fromView === true),
    rename_entity: i => session.renameEntity(string(i.name)),
    duplicate_entity: () => session.duplicateSelected(),
    delete_entity: i => session.deleteSelected(i.replacementCamera ? string(i.replacementCamera) : undefined),
    ground_entity: () => session.groundSelected(),
    set_entity_color: i => session.setEntityColor(string(i.color)),
    set_entity_flag: i => session.setEntityFlag(i.key as 'visible' | 'locked', Boolean(i.value)),
    set_position_axis: i => session.setPositionAxis(axis(i.axis), number(i.value)),
    set_rotation_axis: i => session.setRotationAxis(axis(i.axis), number(i.degrees)),
    set_scale_axis: i => session.setScaleAxis(axis(i.axis), number(i.value)),
    set_height: i => session.setHeight(number(i.value)),
    set_entity_option: i => session.setEntityOption(i.key as 'build' | 'gender', string(i.value)),
    set_camera_field: i => session.setCameraField(i.patch as Parameters<typeof session.setCameraField>[0]),
    set_light_field: i => session.setLightField(i.patch as Parameters<typeof session.setLightField>[0]),
    set_lighting_field: i => session.setLightingField(i.patch as Parameters<typeof session.setLightingField>[0]),
    update_room: i => session.updateRoom(i.patch as Parameters<typeof session.updateRoom>[0]),
    update_project_settings: i => session.updateProjectSettings(i.patch as Parameters<typeof session.updateProjectSettings>[0]),
    apply_framing: i => session.applyFraming(i.name as Parameters<typeof session.applyFraming>[0], i.cameraId ? string(i.cameraId) : undefined),
    add_camera_placement: i => {
        const preset = CAMERA_PLACEMENTS.find(item => item.id === string(i.id));
        if (!preset) throw new DirectorCommandError('未知机位预设', { code: 'INVALID_PARAMS', hint: '从 catalog.cameraPlacements 中选择有效的 id' });
        if (!session.addCameraPlacement(preset.id)) throw Error('机位未创建，请等待场景引擎就绪后重试');
        return { entityId: useEditorStore.getState().selected };
    },
    apply_camera_preset: i => session.applyCameraPreset(i.id as Parameters<typeof session.applyCameraPreset>[0], i.cameraId ? string(i.cameraId) : undefined, { subjectId: i.subjectId ? string(i.subjectId) : undefined, foregroundId: i.foregroundId ? string(i.foregroundId) : undefined }),
    add_cut: () => session.addCutAtPlayhead(),
    remove_cut: i => session.removeCut(number(i.index)),
    set_duration: i => session.setDuration(number(i.seconds)),
    extend_duration: () => session.extendDuration(),
    add_action: i => session.addAction(string(i.action)),
    set_entity_path: i => session.setEntityPath({
        entityId: string(i.entityId),
        points: Array.isArray(i.points) ? i.points as { position: unknown; timeSec: unknown }[] : [],
        ...(i.smooth === undefined ? {} : { smooth: i.smooth === true }),
    }),
    set_campath: i => session.applyCampath(string(i.source), {
        ...(i.cameraId === undefined ? {} : { cameraId: string(i.cameraId) }),
        ...(i.atSec === undefined ? {} : { atSec: number(i.atSec) }),
    }),
    batch_edit: i => {
        hostSession.assertCurrent(i.expectedSessionId, useEditorStore.getState().revision);
        return { ...session.applyBatch(i.edits as BatchEdit[], number(i.expectedRevision), i.validateOnly === true), sessionId: hostSession.id };
    },
    set_clip_field: i => session.setClipField(string(i.id), i.patch as Parameters<typeof session.setClipField>[1]),
    remove_clip: i => session.removeClip(string(i.id)),
    select_clip: i => session.selectClip(i.id == null ? null : string(i.id)),
    select_path_section: i => session.selectPathSection(string(i.entityId), number(i.index)),
    remove_selected_path_section: () => session.removeSelectedPathSection(),
    split_clip: () => session.splitSelectedClip(),
    set_action_blend: i => session.setActionBlend(number(i.value)),
    set_foot_contact: i => session.setFootContact(Boolean(i.value)),
    select_joint: i => session.selectJoint(string(i.joint) as Joint),
    set_joint_nodes_visible: i => session.setJointNodesVisible(Boolean(i.visible)),
    set_joint_angle: i => session.setJointAngle(string(i.joint) as Joint, axis(i.axis), number(i.degrees)),
    reset_pose: () => session.resetPose(), mirror_pose: () => session.mirrorPose(),
    record_pose_key: () => session.recordPoseKey(),
    seek_pose_key: i => session.seekPoseKey(number(i.index)),
    delete_pose_key: i => session.deletePoseKey(number(i.index)),
    start_path: () => session.startPath(),
    set_path_draw_mode: i => session.setPathDrawMode(i.mode as 'points' | 'freehand'),
    set_path_surface_mode: i => session.setPathSurfaceMode(i.mode as 'surface' | 'ground'),
    set_path_draw_duration: i => session.setPathDrawDuration(number(i.seconds)),
    add_path_point: i => session.addGroundPoint(vector(i.position)),
    add_freehand_stroke: i => {
        if (!Array.isArray(i.points)) throw Error('points 必须为坐标数组');
        return session.addFreehandStroke(i.points.map(vector));
    },
    finish_path: () => session.finishPath(), cancel_path: () => session.cancelPath(),
    clear_path: () => session.clearPath(), append_path_point: () => session.appendPathPoint(),
    remove_path_point: i => session.removePathPoint(number(i.index)),
    select_path_point: i => session.selectPathPoint(number(i.index)),
    hold_path_point: () => session.holdPathPoint(),
    set_path_point_time: i => session.setPathPointTime(number(i.index), number(i.seconds)),
    set_path_point_position: i => session.setPathPointPosition(number(i.index), axis(i.axis), number(i.value)),
    set_loop: i => session.setLoop(Boolean(i.value)),
    toggle_grid: () => session.toggleGrid(), view_home: () => session.viewHome(),
    view_top: () => session.viewTop(), focus_selected: () => session.focusSelected(),
    scene_list: () => ({ activeSceneId: session.history.context.sceneId, scenes: session.history.list() }),
    scene_read: i => session.history.readScene(i.id ? string(i.id) : undefined, i.options as Parameters<typeof session.history.readScene>[1]),
    scene_switch: i => editScenes('切换戏段', document => {
        const id = string(i.id);
        if (!document.scenes.some(scene => scene.id === id)) throw Error('戏段不存在');
        document.activeSceneId = id;
    }),
    scene_create: i => {
        const id = `scene-${crypto.randomUUID()}`;
        const changed = editScenes('新建戏段', document => {
            const name = string(i.name || `第 ${document.scenes.length + 1} 场`).trim();
            const state = i.copyCurrent === true
                ? structuredClone(document.scenes.find(scene => scene.id === document.activeSceneId)!.state)
                : readSceneDocument(createScene()).scenes[0].state;
            document.scenes.push({ id, name, state });
            document.activeSceneId = id;
        });
        return changed ? { id, activeSceneId: id } : false;
    },
    scene_rename: i => editScenes('重命名戏段', document => {
        const scene = document.scenes.find(item => item.id === string(i.id));
        if (!scene) throw Error('戏段不存在');
        scene.name = string(i.name).trim();
    }),
    scene_remove: i => editScenes('删除戏段', document => {
        if (document.scenes.length === 1) throw Error('不能删除最后一个戏段');
        const index = document.scenes.findIndex(item => item.id === string(i.id));
        if (index < 0) throw Error('戏段不存在');
        document.scenes.splice(index, 1);
        if (document.activeSceneId === string(i.id)) document.activeSceneId = document.scenes[Math.min(index, document.scenes.length - 1)].id;
    }),
    history_status: () => ({ undo: session.history.undoLabel, redo: session.history.redoLabel }),
    export_scene: () => session.exportSceneDocument(),
    // 导入失败必须说明原因：静默返回 false 会让调用方拿着同一份几十 KB 的文档盲重试。
    import_scene: i => {
        const applied = session.importSceneDocument(i.document, string(i.label) || '载入场景');
        if (!applied) throw session.lastSceneLoadError ?? new DirectorCommandError('无法载入场景', {
            hint: '先用 export_scene 取当前工程的真实结构再对照修改',
        });
        // 整份导入一次摆下几十件物体；把悬空的直接列出来，不等用户在画面里发现。
        const warnings = session.groundingWarnings();
        return { applied: true, ...(warnings.length ? { warnings } : {}) };
    },
    scene_summary: () => session.sceneSummary(),
    set_theme: i => session.setTheme(i.theme === 'light' ? 'light' : 'dark', false),
    export_project: i => {
        const filename = `${safeFilename(string(i.filename || session.history.document().name).trim())}.director.json`;
        const blob = new Blob([JSON.stringify(session.history.document(), null, 2)], { type: 'application/json' });
        download(blob, filename);
        return { filename, bytes: blob.size, downloadTriggered: true };
    },
    shot_list: () => shotTable(session.project),
    export_artifact_list: () => artifacts.list(artifactOwner()),
    export_artifact_read: i => artifacts.read(artifactOwner(), string(i.artifactId)),
    export_artifact_deliver: i => {
        if (i.mode !== 'ingest' && i.mode !== 'download') throw Error('mode 必须为 ingest 或 download');
        return artifacts.deliver(artifactOwner(), string(i.artifactId), i.mode);
    },
    export_artifact_remove: i => artifacts.remove(artifactOwner(), string(i.artifactId)),
    export_delivery_package: async i => {
        const owner = artifactOwner(), id = string(i.videoArtifactId);
        const video = await artifacts.read(owner, id);
        if (video.kind !== 'video') throw Error('请指定视频产物');
        const document = session.history.document();
        if (JSON.stringify(await artifacts.sourceDocument(owner, id)) !== JSON.stringify(document)) throw Error('当前场景已变化；请切回原场景或重新导出视频再制作一致的交付包，已有视频仍可下载');
        const options = video.metadata.options as { start?: number; end?: number; cameraId?: string };
        const times = deliveryShots(session.project, options).map(s => (s.startSec + s.endSec) / 2);
        const previews = [];
        for (let n = 0; n < times.length; n += 8) {
            const timesSec = times.slice(n, n + 8);
            const frame = await session.renderPreviewSheet({ timesSec, cameraId: options.cameraId ?? 'program' });
            previews.push({ filename: `storyboard-${previews.length + 1}.jpg`, blob: await (await fetch(frame.dataUrl)).blob(), timesSec });
        }
        if (JSON.stringify(session.history.document()) !== JSON.stringify(document) || artifactOwner() !== owner) throw Error('场景在取预览时发生变化，请重试交付包');
        const bundle = await packageDelivery({ artifacts, owner, videoArtifactId: id, document, project: session.project, filename: `${safeFilename(string(i.filename || session.project.name))}.zip`, previews });
        return { ...bundle, artifactId: bundle.id, ...(await artifacts.read(owner, bundle.id)) };
    },
    export_video_start: i => startVideoExport(i),
    export_video_job: async i => {
        const job = exportJobs.get(string(i.jobId));
        if (!job || job.owner !== artifactOwner()) throw Error('导出任务不存在');
        if (job.artifact && job.phase === 'done') {
            const current = (await artifacts.list(job.owner)).find(a => a.id === job.artifact!.id);
            if (current) { job.artifact = current; job.status = current.ingestion === 'failed' || (current.ingestion === 'pending' && job.status === 'delivery_failed') ? 'delivery_failed' : 'completed'; if (current.error) job.error = current.error; else delete job.error; }
        }
        const { controller: _controller, ...status } = job;
        return status;
    },
    export_video_cancel: i => {
        const job = exportJobs.get(string(i.jobId));
        if (!job || job.owner !== artifactOwner()) throw Error('导出任务不存在');
        if (job.status !== 'running') return false;
        job.controller.abort();
        return true;
    },
};

function editScenes(label: string, edit: (document: ReturnType<typeof session.history.document>) => void) {
    const document = session.history.document();
    edit(document);
    return session.replaceSceneDocument(document, label);
}

/**
 * 命令表的静态契约与版本号。
 *
 * 这张表只在构建时变化，却出现在每次 snapshot 里（约 8.6KB，占小场景快照的八成）。
 * 宿主带上一次的 `commandsVersion`，未变时回执只给版本号，省掉整块静态文本。
 */
/**
 * 命令表的两档视图。
 *
 * `descriptors` 是全部 106 条，服务编辑器与 `includeAll`；`agentDescriptors` 只留模型该用的那些，
 * 默认快照回的就是它。隐藏项仍然能执行（界面、undo 历史、脚本都在用），只是不再出现在
 * 默认能力面里——模型看到 106 条就会去挑最顺手的，而不是最稳的那条。
 */
const descriptors = Object.keys(commands).map(name => {
    const spec = commandSpecs[name];
    if (!spec) throw Error(`导演台命令缺少参数契约: ${name}`);
    return spec.args ? { name, kind: spec.kind, args: spec.args } : { name, kind: spec.kind };
});
const agentDescriptors = Object.keys(commands)
    .filter(name => !commandSpecs[name]?.agentHidden)
    .map(name => descriptors.find(entry => entry.name === name)!);
const commandsVersion = (() => {
    const text = JSON.stringify(descriptors);
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(36);
})();

/**
 * 大场景下完整文档会涨到几十 KB，而 Agent 多数时候只需要改一两个实体。
 * `summary` 保留判断走位、构图和时长所需的字段，丢掉姿态、参数和模型细节。
 */
function summarizeDocument(document: ReturnType<typeof session.history.document>, only: Set<string> | null) {
    return {
        ...document,
        scenes: document.scenes.map(scene => ({
            ...scene,
            state: {
                ...scene.state,
                entities: scene.state.entities
                    .filter(entity => !only || only.has(entity.id))
                    .map(entity => ({
                        id: entity.id, kind: entity.kind, name: entity.name, asset: entity.asset,
                        position: entity.position, rotation: entity.rotation, scale: entity.scale,
                        visible: entity.visible, locked: entity.locked, height: entity.height,
                        path: entity.path
                            ? { points: entity.path.points.length, from: entity.path.points[0].time, to: entity.path.points[entity.path.points.length - 1].time }
                            : null,
                        rotationAnimation: entity.rotationAnimation
                            ? { pivot: entity.rotationAnimation.pivot, keys: entity.rotationAnimation.keys.length,
                                from: entity.rotationAnimation.keys[0].time, to: entity.rotationAnimation.keys.at(-1)!.time }
                            : null,
                        clips: entity.clips.map(clip => ({ id: clip.id, action: clip.action, start: clip.start, end: clip.end, speed: clip.speed })),
                        camera: entity.camera
                            ? { mode: entity.camera.mode, aim: entity.camera.aim, focal: entity.camera.focal, targetId: entity.camera.targetId }
                            : null,
                        light: entity.light ? true : null,
                    })),
            },
        })),
    };
}

/** 完整文档，但只保留指定实体的明细；切镜、房间和灯光保持原样。 */
function scopeDocument(document: ReturnType<typeof session.history.document>, only: Set<string> | null) {
    if (!only) return document;
    return {
        ...document,
        scenes: document.scenes.map(scene => ({
            ...scene,
            state: { ...scene.state, entities: scene.state.entities.filter(entity => only.has(entity.id)) },
        })),
    };
}

function startVideoExport(input: Input) {
    const engine = session.engineOrNull;
    if (!engine) throw Error('导演台画布尚未准备好');
    if (useEditorStore.getState().busy || engine.exporting || [...exportJobs.values()].some(job => job.status === 'running')) throw Error('导演台正在执行其他任务');
    const project = useEditorStore.getState().project;
    const size = input.size === undefined ? 1280 : number(input.size);
    if (![640, 1280, 1920].includes(size)) throw Error('size 必须为 640、1280 或 1920');
    const format = input.format === undefined ? 'mp4' : string(input.format);
    if (format !== 'mp4' && format !== 'webm') throw Error('format 必须为 mp4 或 webm');
    const fps = input.fps === undefined ? project.fps : number(input.fps);
    if (!FRAME_RATES.includes(fps as typeof FRAME_RATES[number])) throw Error('不支持的帧率');
    const [width, height] = outputSize(project.aspect, size);
    const filename = videoFilename(input.filename === undefined ? project.name : string(input.filename), format);
    const options: ExportOptions = {
        start: input.start === undefined ? 0 : number(input.start),
        end: input.end === undefined ? project.duration : number(input.end),
        fps, width, height,
        cameraId: input.cameraId === undefined ? 'program' : string(input.cameraId),
        format: format as ExportOptions['format'],
        monochrome: input.monochrome === true,
    };
    const context = { ...directorContext(project, options.start, options.end, options.cameraId), exportHostProjectId: artifactHostScope };
    const jobId = crypto.randomUUID();
    const owner = artifactOwner(), document = session.history.document();
    const job: ExportJobState = { owner, status: 'running', phase: 'encoding', progress: 0, filename, width, height, fps, frameCount: getFrameCount(options.start, options.end, fps), codec: format === 'mp4' ? 'avc' : 'vp9', controller: new AbortController() };
    exportJobs.set(jobId, job);
    session.beginBusy();
    void exportVideo(engine, options, job.controller.signal, progress => { job.progress = progress; })
        .then(async blob => {
            if (!blob) throw Error('视频编码未返回文件');
            job.bytes = blob.size; job.progress = 1; job.phase = 'retaining';
            job.artifact = await artifacts.retain(owner, blob, filename, 'video', { width, height, fps, frameCount: job.frameCount, codec: job.codec, options, document }, context);
            if (artifactOwner() !== owner) { job.phase = 'done'; job.status = 'delivery_failed'; job.error = '工程已切换，视频已保留；回到原工程重试入库或下载'; return; }
            job.phase = 'ingesting';
            job.artifact = await artifacts.deliver(owner, job.artifact.id, 'ingest');
            job.phase = 'done';
            job.status = job.artifact.ingestion === 'failed' ? 'delivery_failed' : 'completed';
            if (job.artifact.error) job.error = job.artifact.error;
        })
        .catch(error => {
            job.status = job.controller.signal.aborted ? 'canceled' : 'failed';
            job.error = String(error);
        })
        .finally(() => session.endBusy());
    return { jobId, filename, status: job.status, phase: job.phase, width, height, fps, frameCount: job.frameCount, codec: job.codec, note: 'export_video_job 返回分阶段状态和 artifact.id；delivery_failed 可用 export_artifact_deliver 重试入库或下载，不必重编码。completed 是否入库请看 artifact.ingestion。' };
}

function loadProject(project: unknown) {
    if (!project) return;
    const document = readSceneDocument(project);
    const restored = session.history.reset(document);
    useEditorStore.getState().patch({ project: restored, selected: restored.entities[0]?.id ?? '', time: 0 });
    session.changed(true);
}

function setPanorama(url: string, meta: { edgeId?: string; name?: string; sourceNodeId?: string } = {}) {
    const current = ++panoramaRequest;
    if (!url) {
        panorama?.dispose();
        panorama = null;
        session.engineOrNull?.setHostPanorama(null);
        panoramaEngine = null;
        setReferenceBackdrop(null);
        return;
    }
    void new THREE.TextureLoader().loadAsync(url).then(texture => {
        if (current !== panoramaRequest) { texture.dispose(); return; }
        panorama?.dispose();
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.mapping = THREE.EquirectangularReflectionMapping;
        panorama = texture;
        session.engineOrNull?.setHostPanorama(texture);
        panoramaEngine = session.engineOrNull;
        // The panel shows what the host attached; without the image's own dimensions there is
        // no way to tell an equirect panorama from a thumbnail pushed by mistake.
        const image = texture.image as { width?: number; height?: number } | undefined;
        setReferenceBackdrop({
            edgeId: string(meta.edgeId),
            name: string(meta.name) || '参考背景',
            url,
            width: Number(image?.width ?? 0),
            height: Number(image?.height ?? 0),
            ...(meta.sourceNodeId ? { sourceNodeId: string(meta.sourceNodeId) } : {}),
        });
    }).catch(error => send('error', { error: `全景图加载失败: ${String(error)}` }));
}

export function initializeHostBridge() {
    const onMessage = async (event: MessageEvent) => {
        if (event.origin !== origin || event.source !== parent || !event.data || typeof event.data.type !== 'string') return;
        const message = event.data as { type: string; payload?: Input };
        const payload = message.payload ?? {};
        if (message.type === 'storyai:director-desk-session') {
            setLanguage(payload.locale === 'en-US' ? 'en' : 'zh-CN');
            // The host decides how the desk is embedded, so its theme wins over the URL and
            // over whatever this browser stored from a previous standalone run.
            const theme = string(payload.theme);
            if (theme === 'light' || theme === 'dark') setEditorTheme(theme, false);
            try {
                const initialized = hostSession.initialize(string(payload.instanceId), () => {
                    window.clearTimeout(saveTimer);
                    loadProject(payload.project);
                });
                // Bound only once the host's document is the one on screen. A desk that failed
                // to load still shows its starter scene, and writing that back would replace
                // the scene the host saved; staying unbound keeps the saved scene recoverable.
                // A fresh canvas node owns its own starter document from the first opening,
                // even if the user closes it without making an edit.
                artifactHostScope = string(payload.artifactScope) || string(payload.instanceId);
                if (initialized) send('project-changed', { project: session.history.document(), revision: useEditorStore.getState().revision });
                scheduleCover();
            } catch (error) { send('error', { error: String(error) }); }
            return;
        }
        if (message.type === 'storyai:director-desk-panorama') {
            setPanorama(string(payload.imageUrl), {
                edgeId: string(payload.edgeId),
                name: string(payload.fileName),
                sourceNodeId: string(payload.sourceNodeId),
            });
            return;
        }
        if (message.type === 'storyai:director-desk-scene-load') {
            // Hand-over between the full-page workspace and a canvas node.
            const applied = session.importSceneDocument(payload.document, string(payload.label) || '载入场景');
            const failure = session.lastSceneLoadError;
            send('scene-loaded', {
                ok: applied,
                ...(applied || !failure ? {} : { error: failure.message, ...(failure.hint ? { hint: failure.hint } : {}) }),
            });
            if (applied) {
                // The host handed over this document explicitly, so it is now the one on screen.
                hostSession.connected = true;
                window.clearTimeout(saveTimer);
                send('project-changed', { project: session.history.document(), revision: useEditorStore.getState().revision });
                scheduleCover();
            }
            return;
        }
        if (message.type === 'storyai:director-desk-panorama-clear') {
            setPanorama('');
            return;
        }
        if (message.type === 'storyai:director-desk-agent-request') {
            const requestId = string(payload.requestId);
            try {
                // Embedded, the desk edits the host's document. Before that document has loaded,
                // the scene here is the built-in starter: the Agent would read an empty stage,
                // and its first edit would be written back over the node's real saved scene.
                // This is exactly how earlier sessions lost their work after a reload.
                if (parent !== window && !hostSession.connected && payload.operation !== 'catalog')
                    throw new DirectorCommandError('导演台还没有载入当前节点保存的场景，本次操作未执行', {
                        hint: '稍等片刻后重试；如果一直如此，关闭并重新打开导演台。不要在默认场景上继续搭建，否则会覆盖节点里保存的场景。',
                    });
                let result: unknown;
                if (payload.operation === 'snapshot') {
                    const state = useEditorStore.getState();
                    const args = (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {}) as Input;
                    const detail = args.detail === 'summary' ? 'summary' : 'full';
                    const document = session.history.document();
                    hostSession.record(state.revision, document as unknown as Record<string, unknown>);
                    const requested = Array.isArray(args.entityIds)
                        ? new Set(args.entityIds.map(string).filter(Boolean))
                        : null;
                    // 命令表只随代码变化：调用方带回上次版本号时不必再收静态契约。
                    // 默认只给 Agent 档；includeAll 时才连同界面内部命令一起返回。
                    const knownVersion = string(args.commandsVersion);
                    const all = args.includeAll === true;
                    const unchanged = !all && Boolean(knownVersion) && knownVersion === commandsVersion;
                    const table = all ? descriptors : agentDescriptors;
                    result = {
                        document: detail === 'summary' ? summarizeDocument(document, requested) : scopeDocument(document, requested),
                        selected: state.selected, time: state.time, view: state.view,
                        sessionId: hostSession.id, revision: state.revision, commandsVersion,
                        hiddenCommands: all ? 0 : descriptors.length - agentDescriptors.length,
                        ...(unchanged ? { commandsUnchanged: true } : { commands: table }),
                    };
                } else if (payload.operation === 'catalog') {
                    // 这里的每一项都是封闭枚举或真实 ID，Agent 只能从这里取合法值：
                    // 少了任何一项，对应命令就只能靠猜参数（例如 apply_framing 的中文构图名）。
                    const args = (payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {}) as Input;
                    const query = string(args.query).trim();
                    const group = string(args.group).trim();
                    const filtered = Boolean(query || group);
                    const matches = filtered ? searchAssets(query, group || '全部').map(describeAsset) : [];
                    // 全量素材序列化后接近 28 KB，而一次会话通常只用十几条：默认只给分组概览。
                    const shown = matches.slice(0, CATALOG_MATCH_LIMIT);
                    result = {
                        ...(filtered
                            ? {
                                assets: shown,
                                matched: matches.length,
                                ...(matches.length > shown.length ? { truncated: matches.length - shown.length } : {}),
                                ...(matches.length ? {} : { hint: `没有匹配的素材；分组有：${assetGroups().map(entry => entry.group).join('、')}` }),
                            }
                            : {
                                assetTotal: assetGroups().reduce((total, entry) => total + entry.count, 0),
                                groups: assetGroups(),
                                hint: 'assets 未返回：用 group（分组名）或 query（关键词，如 wall、墙、building）筛出具体素材；一次只取需要的那一组。',
                            }),
                        assetConventions: {
                            unit: '米',
                            origin: ASSET_ORIGIN,
                            note: '素材原点在底面中心：position 就是物体底面中心的位置，y=0 时物体正好立在地面上；不要按"原点在中心"再抬高半个高度。用 scale 改高度时底面仍留在 position.y。地面、道路、房间构件的上表面在 y=0，厚度向下延伸；石头和桥有一部分故意埋在地下。人物身高默认 1.75 米。',
                        },
                        actions: ACTIONS, actionTiming: ACTION_TIMING, cameraPlacements: CAMERA_PLACEMENTS, cameraPresets: CAMERA_PRESETS, aspects: ASPECTS, frameRates: FRAME_RATES,
                        framings: FRAMING_NAMES,
                        entityOptions: { build: BUILDS, gender: GENDERS },
                        // 每次新增封闭枚举都必须登记在这里，否则对应命令只能靠猜。
                        previewQualities: ['full', 'draft'],
                        labelModes: ['off', 'selected', 'all'],
                        snapSteps: [0, 0.1, 0.5, 1],
                        commandKinds: ['view', 'edit', 'export'],
                        // patch 类命令的合法键名：类型来自真实接口，字段增删会在这里同步。
                        patchFields: patchFieldCatalog,
                    };
                } else {
                    const operation = string(payload.operation);
                    const command = commands[operation];
                    if (!command) throw Error(`未知导演台操作: ${operation}`);
                    // 界面内部命令不进 Agent 档，也不接受通过单命令执行：它们依赖当前选区与播放头，
                    // 用错一次就是一整轮返工。回执直接给出该改用的 batch 写法。
                    const spec = commandSpecs[operation];
                    if (spec?.agentHidden)
                        throw new DirectorCommandError(`${operation} 是编辑器内部命令，不通过单命令执行`, {
                            code: 'INVALID_PARAMS',
                            hint: spec.prefer ? `改用 ${spec.prefer}；一次批量可完成多项相关修改` : '改用 director_desk_batch 里对应的操作',
                        });
                    result = await command((payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {}) as Input);
                    // A successful edit must reach the host before its tool receipt. The
                    // debounced subscription can be lost if an export or WebView reload follows.
                    if (commandSpecs[operation]?.kind === 'edit' && result !== false &&
                        !(operation === 'batch_edit' && (result as { applied?: boolean }).applied === false)) {
                        window.clearTimeout(saveTimer);
                        send('project-changed', { project: session.history.document(), revision: useEditorStore.getState().revision });
                        scheduleCover();
                    }
                }
                send('agent-result', { requestId, success: true, result: result ?? null });
            } catch (error) {
                // 结构化失败：code 给机器归类，hint 与 facts 让宿主不必解析 message 文本就能自愈
                // （例如 revision 冲突时带回 currentRevision）。
                const failure = error instanceof DirectorCommandError ? error : null;
                send('agent-result', {
                    requestId, success: false,
                    code: failure ? failure.code : classifyDirectorError(String(error)),
                    error: failure ? failure.message : String(error),
                    ...(failure?.hint ? { hint: failure.hint } : {}),
                    ...(failure?.facts ? { facts: { ...failure.facts, ...(failure.code === 'REVISION_MISMATCH' ? { revisionDiff: hostSession.diff(Number((payload.args as Input)?.expectedRevision), useEditorStore.getState().revision) } : {}) } } : {}),
                });
            }
        }
    };
    window.addEventListener('message', onMessage);
    useEditorStore.subscribe(state => {
        if (state.engineReady && panorama && session.engineOrNull && session.engineOrNull !== panoramaEngine) {
            session.engineOrNull.setHostPanorama(panorama);
            panoramaEngine = session.engineOrNull;
        }
        // Selection is reported separately from edits so the canvas node card can describe the
        // scene without waiting for a save round-trip.
        if (state.selected !== lastSelected) {
            lastSelected = state.selected;
            if (hostSession.connected) {
                const entity = session.project.entities.find(item => item.id === state.selected);
                send('selection-changed', {
                    id: state.selected,
                    name: entity?.name ?? '',
                    kind: entity?.kind ?? '',
                });
            }
        }
        if (!hostSession.connected || state.revision === lastRevision) return;
        lastRevision = state.revision;
        hostSession.record(state.revision, session.history.document() as unknown as Record<string, unknown>);
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            send('project-changed', { project: session.history.document(), revision: useEditorStore.getState().revision });
            scheduleCover();
            send('scene-summary', { summary: session.sceneSummary() });
        }, 220);
    });
    // The backdrop lives on a canvas edge, so removal is the host's to perform.
    session.registerBackdropRemoval(edgeId => send('panorama-removed', { edgeId }));
    send('ready');
    send('scene-summary', { summary: session.sceneSummary() });
}
