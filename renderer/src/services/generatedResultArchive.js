import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';
import {
  TEXT_SUBTASKS,
  normalizeTextSubtask,
  parseSemanticSplitResult,
  parseStoryboardResult,
} from '@/utils/textGenerationModes';
import { extractGeneratedFiles, extractGeneratedText } from '@/utils/generatedOutputParsing.mjs';
import {
  extensionForGeneratedFile,
  semanticOutputFileName,
} from '@/utils/generatedOutputNaming.mjs';
import { restoreMissingGeneratedFiles as restoreMissingFiles } from '@/services/generatedFileRestoration.mjs';

export { extractGeneratedFiles, extractGeneratedText } from '@/utils/generatedOutputParsing.mjs';

function extensionForNode(nodeType) {
  return {
    imageGeneration: 'png',
    videoGeneration: 'mp4',
    audioGeneration: 'wav',
    textGeneration: 'txt',
  }[nodeType] || 'dat';
}

function titleForNode(nodeType) {
  return {
    imageGeneration: '图片结果',
    videoGeneration: '视频结果',
    audioGeneration: '音频结果',
    textGeneration: '文本结果',
  }[nodeType] || '生成结果';
}

function resourceTypeForNode(nodeType) {
  return {
    imageGeneration: 'image',
    videoGeneration: 'video',
    audioGeneration: 'audio',
    textGeneration: 'text',
  }[nodeType] || 'file';
}

function inferResourceType(file, nodeType) {
  const value = String(file.resourceType || file.type || file.mimeType || '').toLowerCase();
  if (value.includes('image')) return 'image';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  if (value.includes('text')) return 'text';
  return resourceTypeForNode(nodeType);
}

async function urlForArchivedFile(file) {
  if (file.url) return file.url;
  return file.previewUrl || '';
}

function createResultNode({ sourceNode, task, material = null, file = null, text = '', index = 0 }) {
  const nodeId = uid();
  const localPath = material?.path || '';
  return {
    id: nodeId,
    type: 'resource',
    title: material?.name || file?.name || titleForNode(sourceNode.type),
    content: text || localPath || file?.url || file?.previewUrl || file?.objectKey || material?.name || '',
    fileName: material?.name || file?.name || '',
    filePath: localPath,
    url: localPath || file?.url || '',
    previewUrl: localPath,
    objectKey: file?.objectKey || '',
    materialId: material?.id || '',
    resourceType: material?.resourceType || file?.resourceType || material?.mimeType || resourceTypeForNode(sourceNode.type),
    mimeType: material?.mimeType || file?.mimeType || '',
    metadata: file?.metadata || material?.metadata || {},
    cloudCache: file?.cloudCache || material?.cloudCache || null,
    source: 'generation',
    generatedFrom: {
      nodeId: sourceNode.id,
      taskId: task.id,
      nodeType: sourceNode.type,
      model: task.model,
      remoteTaskId: task.remoteTaskId || '',
    },
    width: 260,
    height: 120,
    status: 'completed',
    x: Math.round((sourceNode.x || 0) + 360),
    y: Math.round((sourceNode.y || 0) + 90 * index),
    createdAt: new Date().toISOString(),
  };
}

function nextOutputIndex(project, sourceNode) {
  if (!project || !sourceNode) return 0;
  return project.nodes.filter((node) => (
    node.type === 'resource'
    && node.generatedFrom?.nodeId === sourceNode.id
  )).length;
}

function appendResultNode(project, sourceNode, resultNode) {
  project.nodes.push(resultNode);
  return resultNode;
}

export async function archiveGeneratedOutput({ project, node, task, output }) {
  const remoteFiles = extractGeneratedFiles(output);
  const archivedFiles = [];
  const resultNodes = [];
  const pendingMaterials = [];

  for (const [index, file] of remoteFiles.entries()) {
    const sourceUrl = await urlForArchivedFile(file);
    const extension = extensionForGeneratedFile(file, extensionForNode(node.type));
    const preferredName = semanticOutputFileName(
      node.title || titleForNode(node.type),
      extension,
      index,
      remoteFiles.length,
    );
    let material = null;

    if (sourceUrl || file.metadata?.downloadAuth?.endpointPath) {
      const downloaded = await desktopApi.file.downloadUrlToProject(
        sourceUrl,
        preferredName,
        file.metadata?.downloadAuth,
      );
      if (downloaded) {
        material = {
          id: uid(),
          path: downloaded.filePath || downloaded.path,
          name: downloaded.name || preferredName,
          ext: downloaded.ext || '',
          size: downloaded.size || 0,
          checksum: downloaded.checksum || '',
          checksumAlgorithm: downloaded.checksumAlgorithm || '',
          source: 'generation',
          taskId: task.id,
          remoteTaskId: task.remoteTaskId || '',
          nodeId: node.id,
          nodeType: node.type,
          model: task.model,
          mimeType: file.mimeType || '',
          resourceType: inferResourceType(file, node.type),
          objectKey: file.objectKey || '',
          previewUrl: '',
          remoteUrl: file.url || file.previewUrl || '',
          metadata: file.metadata || {},
          cloudCache: file.cloudCache || null,
          importedAt: downloaded.downloadedAt || new Date().toISOString(),
        };
        pendingMaterials.push({ material, file });
      }
    } else if (file.dataUrl || file.b64Json) {
      const mimeType = file.mimeType || (node.type === 'imageGeneration' ? 'image/png' : 'application/octet-stream');
      const dataUrl = file.dataUrl || `data:${mimeType};base64,${file.b64Json}`;
      const saved = await desktopApi.file.saveDataUrlToProject?.(dataUrl, preferredName);
      if (saved) {
        material = {
          id: uid(),
          path: saved.filePath || saved.path,
          name: saved.name || preferredName,
          ext: saved.ext || '',
          size: saved.size || 0,
          checksum: saved.checksum || '',
          checksumAlgorithm: saved.checksumAlgorithm || '',
          source: 'generation',
          taskId: task.id,
          remoteTaskId: task.remoteTaskId || '',
          nodeId: node.id,
          nodeType: node.type,
          model: task.model,
          mimeType: saved.mimeType || mimeType,
          resourceType: resourceTypeForNode(node.type),
          metadata: file.metadata || {},
          importedAt: saved.savedAt || new Date().toISOString(),
        };
        pendingMaterials.push({ material, file });
      }
    }
  }

  // 下载全部完成后再提交项目状态，避免多文件任务中途失败留下半套节点，
  // 以及恢复归档时重复创建已经提交过的素材。
  for (const { material } of pendingMaterials) {
    project.materials.unshift(material);
    archivedFiles.push(material);
    node.selectedOutputNodeId = `material:${material.id}`;
    node.selectedOutputTaskId = task.id;
  }

  const text = extractGeneratedText(output);
  if (node.type === 'textGeneration' && text) {
    const subtask = normalizeTextSubtask(task.requestPayload?.textSubtask || node.config?.textSubtask);
    node.textSubtask = subtask;
    node.textResultParseError = '';
    if (subtask === TEXT_SUBTASKS.SEMANTIC_SPLIT) {
      const segments = parseSemanticSplitResult(text);
      if (segments?.length) {
        node.textOutputs = segments.map((segment) => segment.content);
        node.textOutputSummaries = segments.map((segment) => segment.summary);
        node.currentTextIndex = 0;
        node.textContent = node.textOutputs[0];
        node.storyboardCells = [];
      } else {
        node.textOutputs = [text];
        node.textOutputSummaries = [];
        node.currentTextIndex = 0;
        node.textContent = text;
        node.storyboardCells = [];
        node.textResultParseError = '语义拆分结果不是有效的 JSON 数组，已按普通文本保留';
      }
    } else if (subtask === TEXT_SUBTASKS.STORYBOARD) {
      const rows = Number(task.requestPayload?.splitRows || node.config?.splitRows) || 3;
      const cols = Number(task.requestPayload?.splitCols || node.config?.splitCols) || 3;
      const cells = parseStoryboardResult(text, rows, cols);
      if (cells?.length) {
        node.storyboardCells = cells;
        node.textOutputs = [];
        node.textOutputSummaries = [];
        node.currentTextIndex = 0;
        node.textContent = cells.map((cell) => cell.content).filter(Boolean).join('\n\n');
      } else {
        node.storyboardCells = [];
        node.textOutputs = [text];
        node.textOutputSummaries = [];
        node.currentTextIndex = 0;
        node.textContent = text;
        node.textResultParseError = '分镜结果不是有效的 JSON 数组，已按普通文本保留';
      }
    } else {
      node.textOutputs = [text];
      node.textOutputSummaries = [];
      node.currentTextIndex = 0;
      node.textContent = text;
      node.storyboardCells = [];
    }
    return {
      archivedFiles,
      resultNodes,
      text,
      textSubtask: subtask,
      textOutputs: node.textOutputs || [],
      storyboardCells: node.storyboardCells || [],
      parseError: node.textResultParseError || '',
    };
  }
  return { archivedFiles, resultNodes, text };
}

export async function restoreMissingGeneratedFiles(project) {
  return restoreMissingFiles(project, desktopApi.file);
}

export function createMockGeneratedOutput({ project, node, task }) {
  const outputText = [
    `${titleForNode(node.type)}已生成`,
    node.prompt ? `提示词：${node.prompt}` : '',
    task?.model ? `模型：${task.model}` : '',
  ].filter(Boolean).join('\n');
  const resultNode = createResultNode({
    sourceNode: node,
    task,
    text: outputText,
    index: nextOutputIndex(project, node) + 1,
  });
  resultNode.title = `${node.title || titleForNode(node.type)} 输出`;
  resultNode.mock = true;
  resultNode.resourceType = resourceTypeForNode(node.type);
  if (node.type === 'textGeneration') {
    const subtask = normalizeTextSubtask(task?.requestPayload?.textSubtask || node.config?.textSubtask);
    if (subtask === TEXT_SUBTASKS.SEMANTIC_SPLIT) {
      node.textOutputs = [outputText, '这是用于验证语义拆分多结果展示的第二段模拟文本。'];
      node.textOutputSummaries = ['模拟文本', '第二段'];
    } else if (subtask === TEXT_SUBTASKS.STORYBOARD) {
      const rows = Number(task?.requestPayload?.splitRows || node.config?.splitRows) || 3;
      const cols = Number(task?.requestPayload?.splitCols || node.config?.splitCols) || 3;
      node.storyboardCells = Array.from({ length: rows * cols }, (_, index) => ({
        id: index + 1,
        summary: `镜头 ${index + 1}`,
        content: `镜头 ${index + 1}：主体位于画面中心，动作承接上一镜，场景与角色外观保持一致。`,
        schemaVersion: 2,
        scene: '同一场景',
        shotSize: index % 3 === 0 ? '全景' : index % 3 === 1 ? '中景' : '近景',
        cameraMove: '静止',
        action: index ? '(承接上镜)继续当前动作' : '(开篇)建立主体与场景关系',
        orientation: '主体-朝右',
        spatialRelation: '主体(中中)',
        emotion: '专注',
        duration: 4,
        dialogue: '',
        sound: '',
      }));
      node.textOutputs = [];
      node.textOutputSummaries = [];
    } else {
      node.textOutputs = [outputText];
      node.textOutputSummaries = [];
      node.storyboardCells = [];
    }
    node.currentTextIndex = 0;
    node.textContent = node.textOutputs?.[0] || node.storyboardCells?.map((cell) => cell.content).join('\n\n') || '';
    node.textSubtask = subtask;
  }
  return {
    archivedFiles: [],
    resultNodes: [],
    output: {
      text: outputText,
      mock: true,
      resourceType: resultNode.resourceType,
    },
  };
}
