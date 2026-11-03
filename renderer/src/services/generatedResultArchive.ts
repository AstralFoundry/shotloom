import { t } from '../i18n/index.ts';
import { desktopApi } from '@/services/desktopApi';
import { uid } from '@/utils/format';
import {
  TEXT_SUBTASKS,
  normalizeTextSubtask,
  parseSemanticSplitResult,
  parseStoryboardResult,
} from '@/utils/textGenerationModes';
import { extractGeneratedFiles, extractGeneratedText } from '@/utils/generatedOutputParsing.ts';
import {
  extensionForGeneratedFile,
  semanticOutputFileName,
} from '@/utils/generatedOutputNaming.ts';
import { restoreMissingGeneratedFiles as restoreMissingFiles } from '@/services/generatedFileRestoration.ts';

export { extractGeneratedFiles, extractGeneratedText } from '@/utils/generatedOutputParsing.ts';

// 归档要同时读写厂商回执、画布节点和项目素材：三者结构由调用方与原生层决定，
// 这里统一按键值记录处理，节点上补充的派生字段也沿用同一约定。
type AnyRecord = Record<string, any>;

function extensionForNode(nodeType: string) {
  const extensions: Record<string, string> = {
    imageGeneration: 'png',
    videoGeneration: 'mp4',
    audioGeneration: 'wav',
    textGeneration: 'txt',
  };
  return extensions[nodeType] || 'dat';
}

function titleForNode(nodeType: string) {
  const titles: Record<string, string> = {
    imageGeneration: t("generation.result.image"),
    videoGeneration: t("generation.result.video"),
    audioGeneration: t("generation.result.audio"),
    textGeneration: t("generation.result.text"),
  };
  return titles[nodeType] || t("ui.ResourcePreview.text.99045f8e");
}

function resourceTypeForNode(nodeType: string) {
  const resourceTypes: Record<string, string> = {
    imageGeneration: 'image',
    videoGeneration: 'video',
    audioGeneration: 'audio',
    textGeneration: 'text',
  };
  return resourceTypes[nodeType] || 'file';
}

function inferResourceType(file: AnyRecord, nodeType: string) {
  const value = String(file.resourceType || file.type || file.mimeType || '').toLowerCase();
  if (value.includes('image')) return 'image';
  if (value.includes('video')) return 'video';
  if (value.includes('audio')) return 'audio';
  if (value.includes('text')) return 'text';
  return resourceTypeForNode(nodeType);
}

async function urlForArchivedFile(file: AnyRecord) {
  if (file.url) return file.url;
  return file.previewUrl || '';
}

export async function archiveGeneratedOutput({ project, node, task, output }: {
  project: AnyRecord;
  node: AnyRecord;
  task: AnyRecord;
  output: unknown;
}) {
  const remoteFiles = extractGeneratedFiles(output);
  const archivedFiles: AnyRecord[] = [];
  const resultNodes: AnyRecord[] = [];
  const pendingMaterials: Array<{ material: AnyRecord; file: AnyRecord }> = [];

  for (const [index, file] of remoteFiles.entries()) {
    const sourceUrl = await urlForArchivedFile(file);
    const extension = extensionForGeneratedFile(file, extensionForNode(node.type));
    const preferredName = semanticOutputFileName(
      node.title || titleForNode(node.type),
      extension,
      index,
      remoteFiles.length,
    );
    let material: AnyRecord | null = null;

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
      // 解析器已经过滤掉无效条目，类型上仍带 null，这里按松散记录读取。
      const segments = parseSemanticSplitResult(text) as AnyRecord[] | null;
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
        node.textResultParseError = t("generation.result.invalidSplit");
      }
    } else if (subtask === TEXT_SUBTASKS.STORYBOARD) {
      const rows = Number(task.requestPayload?.splitRows || node.config?.splitRows) || 3;
      const cols = Number(task.requestPayload?.splitCols || node.config?.splitCols) || 3;
      const cells = parseStoryboardResult(text, rows, cols) as AnyRecord[] | null;
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
        node.textResultParseError = t("generation.result.invalidStoryboard");
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

export async function restoreMissingGeneratedFiles(project: AnyRecord | null | undefined) {
  return restoreMissingFiles(project, desktopApi.file);
}
