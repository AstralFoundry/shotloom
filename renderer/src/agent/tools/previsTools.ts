import { t } from '@/i18n';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { capturePrevisAgentFrame } from "@/services/previsAgentPreview";
import { omitModelBinaryPayloads } from '@/services/agentCanvasContext';
import { store, touchProject } from '@/store/projectStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { DIRECTOR_AGENT_ID } from '../agents/definitions';
import { registerAgentTool } from '../core/toolRegistry';
import type { AgentToolContext, JsonObject } from '../core/types';

type Scene = { id: string; title: string; [key: string]: unknown };
type DirectorNode = { id: string; type: string; archived?: boolean; directorData?: { scene?: Scene; [key: string]: unknown }; updatedAt?: string };
interface PrevisEngine {
  previsAgentCatalog(): unknown;
  createAgentPrevisScene(title: string, template: unknown): Scene;
  applyAgentPrevisPatch(scene: Scene, operations: unknown[]): { scene: Scene; results: unknown[] };
}
let engine: Promise<PrevisEngine> | undefined;
function loadPrevisEngine() {
  engine ??= (import(/* @vite-ignore */ new URL('./previs-world-app/previs-agent.js', document.baseURI).href) as Promise<PrevisEngine>)
    .catch(error => { engine = undefined; throw error; });
  return engine;
}

function boundNode(context: AgentToolContext): DirectorNode {
  assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
  const session = store.project.harnessSessions?.find((item: { id?: string }) => item.id === context.conversationId);
  const node = store.project.nodes.find((item: DirectorNode) => item.id === session?.directorNodeId);
  if (context.agentId !== DIRECTOR_AGENT_ID || session?.agentId !== DIRECTOR_AGENT_ID
      || node?.type !== 'threeDDirector' || node.archived) throw new Error(t('agent.bindingNodeMissing'));
  return node;
}
function sceneText(node: DirectorNode) {
  return JSON.stringify(node.directorData?.scene ?? null);
}
async function revision(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
const stale = { success: false, applied: false, code: 'PREVIS_REVISION_CONFLICT', error: 'Scene changed. Read it with previs_scene_read and retry against its new revision.' };

async function writeScene(input: JsonObject, context: AgentToolContext, mode: 'create' | 'patch') {
  const initial = boundNode(context);
  const before = sceneText(initial);
  if (await revision(before) !== input.revision) return stale;
  const runtime = await loadPrevisEngine();
  const node = boundNode(context);
  if (sceneText(node) !== before) return stale;

  let result;
  try {
    if (mode === 'create') {
      if (node.directorData?.scene && input.replace !== true) return { success: false, applied: false, error: 'A scene already exists. Edit it with previs_apply_patch.' };
      result = { scene: runtime.createAgentPrevisScene(String(input.title), input.template), results: [] };
    } else {
      if (!node.directorData?.scene) return { success: false, applied: false, error: 'Scene is uninitialized. Create it first.' };
      result = runtime.applyAgentPrevisPatch(JSON.parse(before), input.operations as unknown[]);
    }
  } catch (error) {
    return { success: false, applied: false, error: error instanceof Error ? error.message : String(error) };
  }
  // Engine operations are synchronous: the project cannot change between the fence and the commit.
  recordCanvasHistory(t('agent.role.director'));
  node.directorData = { ...node.directorData, scene: result.scene };
  node.updatedAt = new Date().toISOString();
  touchProject();
  return { success: true, applied: true, nodeId: node.id, sceneId: result.scene.id,
    revision: await revision(sceneText(node)), operations: result.results };
}

const opNames = [
  'scene_update', 'world_update', 'object_add', 'object_update', 'object_remove',
  'camera_add', 'camera_update', 'camera_remove', 'light_add', 'light_update', 'light_remove',
  'shot_add', 'shot_update', 'shot_activate', 'shot_remove', 'actor_travel', 'actor_motion_add',
  'actor_motion_remove', 'object_motion_path_set', 'object_motion_path_clear',
  'keyframe_upsert', 'keyframe_remove', 'camera_move', 'camera_move_remove',
];
export function registerPrevisTools() {
  registerAgentTool({
    id: 'previs_scene_read', icon: 'search', title: t('tool.title.previs_scene_read'), effect: 'read',
    description: '读取当前世界引擎节点的真实场景、revision、对象和镜头 ID。includeCatalog=true 时同时读取引擎可用布景、道具、动作、运镜、天气和镜头目录。',
    inputSchema: { type: 'object', properties: { includeCatalog: { type: 'boolean' } }, additionalProperties: false },
    async execute(input, context) {
      const catalog = input.includeCatalog === true ? (await loadPrevisEngine()).previsAgentCatalog() : undefined;
      const node = boundNode(context);
      const serialized = sceneText(node);
      const token = await revision(serialized);
      if (sceneText(boundNode(context)) !== serialized) return stale;
      return { success: true, nodeId: node.id, revision: token, scene: omitModelBinaryPayloads(JSON.parse(serialized)), ...(catalog !== undefined && { catalog }) };
    },
  });
  registerAgentTool({
    id: 'previs_scene_create', icon: 'box', title: t('tool.title.previs_scene_create'), effect: 'canvas_write',
    description: '在绑定节点初始化真实场景，模板 empty、monologue、dialogue、blocking、product。revision 来自 previs_scene_read。只有用户明确要求替换已有场景时才设置 replace=true。',
    inputSchema: { type: 'object', required: ['revision', 'title'], properties: {
      revision: { type: 'string' }, title: { type: 'string' }, template: { type: 'string', enum: ['empty', 'monologue', 'dialogue', 'blocking', 'product'] }, replace: { type: 'boolean' },
    }, additionalProperties: false },
    execute: (input, context) => writeScene(input, context, 'create'),
  });
  registerAgentTool({
    id: 'previs_preview', icon: 'film', title: t('tool.title.previs_preview'), effect: 'read',
    description: '从当前世界引擎的活动镜头渲染真实构图帧，返回给当前会话。mode 可选 clay 白模或 beauty 构图。先用 shot_activate 切换镜头。',
    inputSchema: { type: 'object', properties: { mode: { type: 'string', enum: ['clay', 'beauty'] } }, additionalProperties: false },
    async execute(input, context) {
      const node = boundNode(context);
      const before = sceneText(node);
      const scene = JSON.parse(before) as Scene | null;
      if (!scene || typeof scene.activeShotId !== 'string' || typeof scene.updatedAt !== 'string') {
        return { success: false, error: 'No active shot is available.' };
      }
      const mode = input.mode === 'beauty' ? 'beauty' : 'clay';
      try {
        const url = await capturePrevisAgentFrame(node.id, { sceneId: scene.id, shotId: scene.activeShotId, updatedAt: scene.updatedAt, mode });
        if (sceneText(boundNode(context)) !== before) return stale;
        return { success: true, sceneId: scene.id, shotId: scene.activeShotId, mode,
          __toolAttachments: [{ mime: 'image/png', filename: `${mode}-preview.png`, url }] };
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  });
  registerAgentTool({
    id: 'previs_apply_patch', icon: 'spark', title: t('tool.title.previs_apply_patch'), effect: 'canvas_write',
    description: '原子编辑当前场景。每项 type、已有对象 id（新增可省略）、fields。变换使用 position、rotation(弧度)、scale 三元组。object_add 的 kind 支持 actor(archetype)、prop(propId,params)、layout(template,size,density,seed,crowd)、primitive(primitive)。actor_travel 接收 to、style、start、duration；actor_motion_add 接收 motion、start、duration；object_motion_path_set 接收 points 或 pathId、speed、duration；camera_move 接收 technique 或 recipe、subjectId、start、duration、params。时间操作可传 shotId，缺省为当前镜头。keyframe_upsert 接收 time 和变换；移除段落使用 motionId、moveId 或 keyframeId。camera、light、shot 支持 name 与相应场景字段。world_update 使用 timeOfDay、weather、ground、groundSize、horizon。revision 取自最近的读取或写入回执。',
    inputSchema: { type: 'object', required: ['revision', 'operations'], properties: {
      revision: { type: 'string' },
      operations: { type: 'array', minItems: 1, items: { type: 'object', required: ['type'],
        properties: { type: { type: 'string', enum: opNames }, id: { type: 'string' }, fields: { type: 'object', additionalProperties: true } }, additionalProperties: false } },
    }, additionalProperties: false },
    execute: (input, context) => writeScene(input, context, 'patch'),
  });
}
