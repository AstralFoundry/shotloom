import { t } from '@/i18n';
import { canvasNodeDimensions, type CanvasSizedNode } from '@/domain/graph/CanvasNodeDimensions';
import { addNode, setSelectedNodeIds } from '@/store/nodeStore';
import { recordCanvasHistory } from '@/store/canvasHistoryStore';
import { showToast } from '@/store/notificationStore';
import { store, touchProject } from '@/store/projectStore';

type AnyNode = Record<string, any>;
type AnyRecord = Record<string, any>;
type MediaKind = 'image' | 'video' | 'audio';

export interface GenerationHistoryItem {
  taskId: string;
  materialId: string;
  type: 'imageGeneration' | 'videoGeneration' | 'audioGeneration' | 'textGeneration';
  kind: MediaKind | 'text';
  prompt: string;
  model: string;
  createdAt: string;
  path: string;
  previewUrl: string;
  mimeType: string;
  text: string;
  title: string;
}

const HISTORY_GAP = 96;

function mediaKind(material: AnyRecord): MediaKind | '' {
  const type = String(material.resourceType || material.mimeType || '').toLowerCase();
  if (type.includes('video')) return 'video';
  if (type.includes('audio')) return 'audio';
  if (type.includes('image')) return 'image';
  const ext = String(material.name || material.path || material.filePath || '').split('.').pop()?.toLowerCase();
  if (['mp4', 'mov', 'webm', 'm4v'].includes(ext || '')) return 'video';
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'].includes(ext || '')) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(ext || '')) return 'image';
  return '';
}

function taskTime(task: AnyRecord) {
  return String(task.completedAt || task.createdAt || task.startedAt || '');
}

function taskPrompt(task: AnyRecord) {
  return String(task.prompt || task.requestPayload?.prompt || '');
}

function taskText(task: AnyRecord) {
  const result = task.result;
  if (typeof result === 'string') return result;
  if (!result || typeof result !== 'object') return '';
  for (const key of ['text', 'content', 'outputText']) {
    if (typeof result[key] === 'string' && result[key].trim()) return result[key].trim();
  }
  return '';
}

/**
 * 生成历史只读项目里已经归档的事实：completed task + 该 task 名下的 materials。
 * 没有归档素材的失败/进行中任务不进入列表，避免“回插一个空结果”。
 */
export function listNodeGenerationHistory(nodeId: string): GenerationHistoryItem[] {
  const node = (store.project.nodes as AnyNode[]).find((item) => item.id === nodeId && !item.archived);
  if (!node) return [];
  const tasks = (store.project.tasks as AnyRecord[])
    .filter((task) => task.nodeId === nodeId && task.status === 'completed')
    .sort((left, right) => Date.parse(taskTime(right)) - Date.parse(taskTime(left)));
  const items: GenerationHistoryItem[] = [];
  for (const task of tasks) {
    const prompt = taskPrompt(task) || String(node.prompt || '');
    const model = String(task.model || node.model || '');
    const materials = (store.project.materials as AnyRecord[])
      .filter((material) => material.taskId === task.id)
      .map((material) => ({ material, kind: mediaKind(material) }))
      .filter((entry): entry is { material: AnyRecord; kind: MediaKind } => Boolean(entry.kind));
    for (const { material, kind } of materials) {
      items.push({
        taskId: String(task.id),
        materialId: String(material.id),
        type: kind === 'video' ? 'videoGeneration' : kind === 'audio' ? 'audioGeneration' : 'imageGeneration',
        kind,
        prompt,
        model,
        createdAt: taskTime(task),
        path: String(material.filePath || material.path || ''),
        previewUrl: String(material.previewUrl || material.remoteUrl || material.url || ''),
        mimeType: String(material.mimeType || ''),
        text: '',
        title: String(material.name || task.title || t('imageHistory.itemTitle')),
      });
    }
    const text = taskText(task);
    if (task.type === 'textGeneration' && text) {
      items.push({
        taskId: String(task.id),
        materialId: '',
        type: 'textGeneration',
        kind: 'text',
        prompt,
        model,
        createdAt: taskTime(task),
        path: '',
        previewUrl: '',
        mimeType: 'text/plain',
        text,
        title: String(task.title || t('imageHistory.itemTitle')),
      });
    }
  }
  return items;
}

/**
 * 回插是新建一个独立结果节点，不是覆盖源节点：历史结果和当前结果可以并排比较。
 * 素材路径直接挂到新节点上，预览会按本地媒体缓存读取，不复制大文件。
 */
export function reinsertGenerationHistory(nodeId: string, taskId: string, materialId = ''): boolean {
  const source = (store.project.nodes as AnyNode[]).find((item) => item.id === nodeId && !item.archived);
  if (!source) return false;
  const item = listNodeGenerationHistory(nodeId)
    .find((entry) => entry.taskId === taskId && entry.materialId === materialId);
  if (!item) return false;

  recordCanvasHistory(t('imageHistory.history'));
  const created = addNode(item.type);
  created.title = t('imageHistory.nodeTitle', { name: String(source.title || t('imageHistory.itemTitle')) });
  created.prompt = item.prompt || String(source.prompt || '');
  created.model = item.model || String(source.model || '');
  created.status = 'completed';
  created.generatedFrom = { nodeId: source.id, type: 'generation-history' };
  created.historyReinsert = { taskId: item.taskId, materialId: item.materialId };
  created.selectedOutputTaskId = item.taskId;
  const dimensions = canvasNodeDimensions(source as CanvasSizedNode);
  created.x = Math.round(Number(source.x || 0) + dimensions.width + HISTORY_GAP);
  created.y = Math.round(Number(source.y || 0));

  if (item.type === 'textGeneration') {
    created.textContent = item.text;
    created.textOutputs = [item.text];
    created.currentTextIndex = 0;
  } else {
    created.width = Number(source.width) || 320;
    created.height = Number(source.height) || 320;
    created.filePath = item.path;
    created.previewUrl = item.previewUrl;
    created.mimeType = item.mimeType;
    if (item.path) {
      created.uploadedFile = {
        name: item.title,
        path: item.path,
        filePath: item.path,
        type: item.mimeType,
        mimeType: item.mimeType,
      };
    }
  }

  setSelectedNodeIds([String(created.id)]);
  touchProject();
  showToast(t('imageHistory.inserted'));
  return true;
}
