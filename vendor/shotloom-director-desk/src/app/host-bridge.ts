import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { readSceneDocument } from '@/core/scenes/sequence-project.ts';
import { ACTIONS, ASPECTS, BUILDS, FRAME_RATES, GENDERS, type Joint, type Vec3 } from '@/core/model.ts';
import { searchAssets } from '@/core/asset-catalog.ts';
import { CAMERA_PRESETS } from '@/core/cinematography/camera-presets.ts';
import { exportVideo, type ExportOptions } from '@/core/export.ts';
import { outputSize } from '@/core/model.ts';
import { download } from '@/core/storage.ts';
import { deliverMedia } from '@/core/host-delivery.ts';
import { videoFilename } from '@/core/exporting/plan.ts';
import { safeFilename } from '@/core/exporting/filename.ts';
import { createScene } from '@/core/scene-templates.ts';
import { FRAMING_NAMES } from '@/state/commands/scene.ts';
import { patchFieldCatalog } from '@/core/editor/patch-fields.ts';
import * as THREE from 'three';
import { setEditorTheme } from '@/core/editor/theme-state.ts';
import { setReferenceBackdrop } from '@/state/reference-backdrop.ts';
import { setLanguage } from '@/shared/i18n/locale.ts';

type Input = Record<string, unknown>;
const origin = window.location.origin;
const parent = window.parent;
let connected = false;
let lastRevision = useEditorStore.getState().revision;
let lastSelected = useEditorStore.getState().selected;
let saveTimer = 0;
let panorama: THREE.Texture | null = null;
let panoramaRequest = 0;
let panoramaEngine: object | null = null;
type ExportJobState = { status: 'running' | 'completed' | 'failed' | 'canceled'; progress: number; filename: string; bytes?: number; error?: string; controller: AbortController };
const exportJobs = new Map<string, ExportJobState>();
const send = (type: string, payload: Input = {}) => parent.postMessage({ type: `storyai:director-desk-${type}`, payload }, origin);
export function requestHostClose() {
    if (parent !== window) send('close');
}
export function requestHostAgentOpen() {
    if (parent !== window) send('open-agent');
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
    inspect_model: { kind: 'view', args: {
        id: 'string，可选，默认当前选中的建筑或道具 ID；必须来自 snapshot.document.entities',
        views: "string[]，可选，1 至 6 个视角：front、back、left、right、top、three_quarter；默认 front/left/top/three_quarter",
    } },

    // 选择、播放头与视口：不影响工程文档
    select_entity: { kind: 'view', args: { id: 'string，实体 ID' } },
    select_scene: { kind: 'view' },
    seek: { kind: 'view', args: { seconds: 'number，项目时间（秒）' } },
    toggle_play: { kind: 'view' },
    step_frame: { kind: 'view', args: { direction: '1 或 -1' } },
    set_view: { kind: 'view', args: { view: "'stage' | 'split' | 'shot'" } },
    set_preview: { kind: 'view', args: { cameraId: 'string，机位 ID' } },
    set_transform_mode: { kind: 'view', args: { mode: "'translate' | 'rotate' | 'scale'" } },
    set_inspector_tab: { kind: 'view', args: { tab: 'string，检查器页签' } },
    toggle_grid: { kind: 'view' },
    view_home: { kind: 'view' },
    view_top: { kind: 'view' },
    focus_selected: { kind: 'view' },
    set_loop: { kind: 'view', args: { value: 'boolean' } },
    set_joint_nodes_visible: { kind: 'view', args: { visible: 'boolean' } },
    select_joint: { kind: 'view', args: { joint: 'string，关节名' } },
    select_clip: { kind: 'view', args: { id: 'string；传 null 取消选择' } },
    select_path_section: { kind: 'view', args: { entityId: 'string', index: 'number' } },
    select_path_point: { kind: 'view', args: { index: 'number' } },

    // 实体与场景编辑
    add_asset: { kind: 'edit', args: { assetId: 'string，取自 catalog.assets[].id' } },
    add_camera: { kind: 'edit', args: { fromView: 'boolean，true 表示从当前视角生成机位' } },
    rename_entity: { kind: 'edit', args: { name: 'string' } },
    duplicate_entity: { kind: 'edit' },
    delete_entity: { kind: 'edit', args: { replacementCamera: 'string，可选；删除机位时的替补机位 ID' } },
    ground_entity: { kind: 'edit' },
    set_entity_color: { kind: 'edit', args: { color: 'string，颜色值' } },
    set_entity_flag: { kind: 'edit', args: { key: "'visible' | 'locked'", value: 'boolean' } },
    set_position_axis: { kind: 'edit', args: { axis: '0 | 1 | 2', value: 'number' } },
    set_rotation_axis: { kind: 'edit', args: { axis: '0 | 1 | 2', degrees: 'number' } },
    set_scale_axis: { kind: 'edit', args: { axis: '0 | 1 | 2', value: 'number' } },
    set_height: { kind: 'edit', args: { value: 'number' } },
    set_entity_option: { kind: 'edit', args: { key: "'build' | 'gender'", value: 'string' } },
    set_camera_field: { kind: 'edit', args: { patch: 'object，机位字段补丁，键名见 snapshot.document' } },
    set_light_field: { kind: 'edit', args: { patch: 'object，灯光字段补丁' } },
    set_lighting_field: { kind: 'edit', args: { patch: 'object，环境光字段补丁' } },
    update_room: { kind: 'edit', args: { patch: 'object，房间字段补丁' } },
    update_project_settings: { kind: 'edit', args: { patch: 'object，工程设置补丁' } },
    apply_framing: { kind: 'edit', args: { name: 'string，构图预设名' } },
    apply_camera_preset: { kind: 'edit', args: { id: 'string，取自 catalog.cameraPresets[].id' } },

    // 戏段时间线
    add_cut: { kind: 'edit' },
    remove_cut: { kind: 'edit', args: { index: 'number' } },
    set_duration: { kind: 'edit', args: { seconds: 'number' } },
    // 把时长拉到现有内容末尾：set_duration 缩短后不会自动补回，超出部分会静默不可达。
    extend_duration: { kind: 'edit' },
    add_action: { kind: 'edit', args: { action: 'string，取自 catalog.actions' } },
    set_clip_field: { kind: 'edit', args: { id: 'string，片段 ID', patch: 'object，片段字段补丁' } },
    remove_clip: { kind: 'edit', args: { id: 'string，片段 ID' } },
    remove_selected_path_section: { kind: 'edit' },
    split_clip: { kind: 'edit' },
    set_action_blend: { kind: 'edit', args: { value: 'number' } },
    set_foot_contact: { kind: 'edit', args: { value: 'boolean' } },
    set_joint_angle: { kind: 'edit', args: { joint: 'string，关节名', axis: '0 | 1 | 2', degrees: 'number' } },
    reset_pose: { kind: 'edit' },
    mirror_pose: { kind: 'edit' },
    record_pose_key: { kind: 'edit' },
    seek_pose_key: { kind: 'view', args: { index: 'number' } },
    delete_pose_key: { kind: 'edit', args: { index: 'number' } },

    // 路径
    start_path: { kind: 'edit' },
    set_path_draw_mode: { kind: 'view', args: { mode: "'points' | 'freehand'" } },
    set_path_surface_mode: { kind: 'view', args: { mode: "'surface' | 'ground'" } },
    set_path_draw_duration: { kind: 'edit', args: { seconds: 'number' } },
    add_path_point: { kind: 'edit', args: { position: '[x, y, z] 三个数值' } },
    add_freehand_stroke: { kind: 'edit', args: { points: '[[x, y, z], ...] 坐标数组' } },
    finish_path: { kind: 'edit' },
    cancel_path: { kind: 'edit' },
    clear_path: { kind: 'edit' },
    append_path_point: { kind: 'edit' },
    remove_path_point: { kind: 'edit', args: { index: 'number' } },
    hold_path_point: { kind: 'edit' },
    set_path_point_time: { kind: 'edit', args: { index: 'number', seconds: 'number' } },
    set_path_point_position: { kind: 'edit', args: { index: 'number', axis: '0 | 1 | 2', value: 'number' } },

    // 关键帧与编辑辅助：只改工程或视口呈现，不产出文件
    record_position_key: { kind: 'edit' },
    record_focal_key: { kind: 'edit' },
    remove_focal_key: { kind: 'edit', args: { index: 'number，焦距关键帧序号' } },
    set_placement_snap: { kind: 'view', args: { step: 'number，米；0 关闭网格吸附。取自 catalog.snapSteps' } },
    set_object_snap: { kind: 'view', args: { enabled: 'boolean，拖动道具时贴合附近表面与边界' } },
    set_preview_quality: { kind: 'view', args: { quality: "'full' | 'draft'，取自 catalog.previewQualities" } },
    set_label_mode: { kind: 'view', args: { mode: "'off' | 'selected' | 'all'，取自 catalog.labelModes" } },

    // 镜头与空间核验
    export_shot: { kind: 'export', args: { index: 'number，切镜序号，从 0 开始；取自 scene_summary 或 document.cuts' } },
    spatial_check: { kind: 'view', args: {
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
    set_theme: { kind: 'view', args: { theme: "'light' | 'dark'" } },
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
    spatial_check: i => session.runSpatialCheck({
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
    inspect_model: i => session.inspectModel({
        ...(i.id === undefined ? {} : { id: string(i.id) }),
        ...(i.views === undefined ? {} : { views: i.views as string[] }),
    }),
    select_entity: i => session.selectEntity(string(i.id)),
    select_scene: () => session.selectScene(),
    seek: i => session.seek(number(i.seconds)),
    toggle_play: () => session.togglePlay(),
    step_frame: i => session.stepFrame(i.direction === -1 ? -1 : 1),
    set_view: i => session.setView(i.view as 'stage' | 'split' | 'shot'),
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
    apply_framing: i => session.applyFraming(i.name as Parameters<typeof session.applyFraming>[0]),
    apply_camera_preset: i => session.applyCameraPreset(i.id as Parameters<typeof session.applyCameraPreset>[0]),
    add_cut: () => session.addCutAtPlayhead(),
    remove_cut: i => session.removeCut(number(i.index)),
    set_duration: i => session.setDuration(number(i.seconds)),
    extend_duration: () => session.extendDuration(),
    add_action: i => session.addAction(string(i.action)),
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
    import_scene: i => session.importSceneDocument(i.document, string(i.label) || '载入场景'),
    scene_summary: () => session.sceneSummary(),
    set_theme: i => session.setTheme(i.theme === 'light' ? 'light' : 'dark', false),
    export_project: i => {
        const filename = `${safeFilename(string(i.filename || session.history.document().name).trim())}.director.json`;
        const blob = new Blob([JSON.stringify(session.history.document(), null, 2)], { type: 'application/json' });
        download(blob, filename);
        return { filename, bytes: blob.size, downloadTriggered: true };
    },
    export_video_start: i => startVideoExport(i),
    export_video_job: i => {
        const job = exportJobs.get(string(i.jobId));
        if (!job) throw Error('导出任务不存在');
        const { controller: _controller, ...status } = job;
        return status;
    },
    export_video_cancel: i => {
        const job = exportJobs.get(string(i.jobId));
        if (!job) throw Error('导出任务不存在');
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
    const jobId = crypto.randomUUID();
    const job: ExportJobState = { status: 'running', progress: 0, filename, controller: new AbortController() };
    exportJobs.set(jobId, job);
    session.beginBusy();
    void exportVideo(engine, options, job.controller.signal, progress => { job.progress = progress; })
        .then(async blob => {
            if (!blob) throw Error('视频编码未返回文件');
            await deliverMedia(blob, filename, 'video');
            job.bytes = blob.size;
            job.progress = 1;
            job.status = 'completed';
        })
        .catch(error => {
            job.status = job.controller.signal.aborted ? 'canceled' : 'failed';
            job.error = String(error);
        })
        .finally(() => session.endBusy());
    return { jobId, filename, status: job.status, note: '通过 export_video_job 查询完成状态；completed 表示已生成画布视频节点。' };
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
            connected = true;
            setLanguage(payload.locale === 'en-US' ? 'en' : 'zh-CN');
            // The host decides how the desk is embedded, so its theme wins over the URL and
            // over whatever this browser stored from a previous standalone run.
            const theme = string(payload.theme);
            if (theme === 'light' || theme === 'dark') setEditorTheme(theme, false);
            try {
                loadProject(payload.project);
                // A fresh canvas node owns its own starter document from the first opening,
                // even if the user closes it without making an edit.
                if (!payload.project) send('project-changed', { project: session.history.document() });
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
            send('scene-loaded', { ok: applied });
            if (applied) {
                window.clearTimeout(saveTimer);
                send('project-changed', { project: session.history.document() });
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
                let result: unknown;
                if (payload.operation === 'snapshot') {
                    const state = useEditorStore.getState();
                    // commands 带参数契约与 kind：宿主 Agent 不必猜参数名，也能按副作用分级。
                    const descriptors = Object.keys(commands).map(name => {
                        const spec = commandSpecs[name];
                        if (!spec) throw Error(`导演台命令缺少参数契约: ${name}`);
                        return spec.args ? { name, kind: spec.kind, args: spec.args } : { name, kind: spec.kind };
                    });
                    result = { document: session.history.document(), selected: state.selected, time: state.time, view: state.view, revision: state.revision, commands: descriptors };
                } else if (payload.operation === 'catalog') {
                    // 这里的每一项都是封闭枚举或真实 ID，Agent 只能从这里取合法值：
                    // 少了任何一项，对应命令就只能靠猜参数（例如 apply_framing 的中文构图名）。
                    result = {
                        assets: searchAssets('', '全部').map(asset => ({ id: asset.id, name: asset.name, kind: asset.kind })),
                        actions: ACTIONS, cameraPresets: CAMERA_PRESETS, aspects: ASPECTS, frameRates: FRAME_RATES,
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
                    const command = commands[string(payload.operation)];
                    if (!command) throw Error(`未知导演台操作: ${string(payload.operation)}`);
                    result = await command((payload.args && typeof payload.args === 'object' && !Array.isArray(payload.args) ? payload.args : {}) as Input);
                    // A successful edit must reach the host before its tool receipt. The
                    // debounced subscription can be lost if an export or WebView reload follows.
                    if (commandSpecs[string(payload.operation)]?.kind === 'edit' && result !== false) {
                        window.clearTimeout(saveTimer);
                        send('project-changed', { project: session.history.document() });
                    }
                }
                send('agent-result', { requestId, success: true, result: result ?? null });
            } catch (error) { send('agent-result', { requestId, success: false, error: String(error) }); }
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
            if (connected) {
                const entity = session.project.entities.find(item => item.id === state.selected);
                send('selection-changed', {
                    id: state.selected,
                    name: entity?.name ?? '',
                    kind: entity?.kind ?? '',
                });
            }
        }
        if (!connected || state.revision === lastRevision) return;
        lastRevision = state.revision;
        window.clearTimeout(saveTimer);
        saveTimer = window.setTimeout(() => {
            send('project-changed', { project: session.history.document() });
            send('scene-summary', { summary: session.sceneSummary() });
        }, 220);
    });
    // The backdrop lives on a canvas edge, so removal is the host's to perform.
    session.registerBackdropRemoval(edgeId => send('panorama-removed', { edgeId }));
    send('ready');
    send('scene-summary', { summary: session.sceneSummary() });
}
