/**
 * AI 全景：用配置好的图片生成模型生成一张 360 全景，并转成 iframe 可直接使用的 data URL。
 * 不写画布、不建任务；生成结果必须真实落到本地项目文件后才返回。
 */

import { getModelIdsByType, resolveModelRuntimeContract } from '@/domain/catalog/ModelCatalog';
import { getProviderAdapter } from '@/domain/provider/adapters';
import { desktopApi } from '@/services/desktopApi';
import { getModelCredentialStatus, settingsStore } from '@/store/settingsStore';
import { extractGeneratedFiles } from '@/utils/generatedOutputParsing';

function pickImageModel() {
  const models = getModelIdsByType('imageGeneration');
  const preferred = String(settingsStore.agentPreferredImageModel || '');
  if (preferred && models.includes(preferred) && getModelCredentialStatus(preferred).available) return preferred;
  return models.find((model) => getModelCredentialStatus(model).available) || '';
}

function bufferToDataUrl(buffer: ArrayBuffer, mimeType = 'image/png') {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

export async function generateDirectorPanorama(input: { prompt: string; signal?: AbortSignal }): Promise<string> {
  const model = pickImageModel();
  if (!model) throw new Error('没有可用的图片生成模型');
  const credential = getModelCredentialStatus(model);
  if (!credential.available) throw new Error(`模型 ${model} 未配置凭据：${credential.message}`);
  const contract = resolveModelRuntimeContract('imageGeneration', model, []);
  if (!contract) throw new Error(`模型 ${model} 不支持图片生成`);
  const adapter = getProviderAdapter(contract.provider);
  const compiled = adapter.compileRequest({
    taskType: 'imageGeneration',
    model,
    prompt: [
      '生成一张用于 3D 场景背景的 360 度等距柱状投影全景图（equirectangular panorama），2:1 画幅，左右边缘无缝衔接。',
      '不要文字、水印、边框、分屏或鱼眼黑边；相机位于画面中心高度，地平线保持水平。',
      String(input.prompt || '').trim(),
    ].filter(Boolean).join('\n'),
    modelContract: contract,
    params: {},
    signal: input.signal ?? new AbortController().signal,
    timeoutMs: 300000,
  });
  const task = await adapter.submit(compiled);
  if (task.status === 'failed') throw new Error(task.error || '全景模型调用失败');
  const files = extractGeneratedFiles(task.result);
  const file = files.find((item: Record<string, unknown>) => typeof item.dataUrl === 'string')
    || files.find((item: Record<string, unknown>) => typeof item.b64Json === 'string')
    || files[0];
  if (!file) throw new Error('模型没有返回全景图片');
  if (typeof file.dataUrl === 'string') return file.dataUrl;
  if (typeof file.b64Json === 'string') return `data:image/png;base64,${file.b64Json}`;
  const url = typeof file.url === 'string' ? file.url : '';
  if (!url) throw new Error('模型没有返回可下载的全景图片');
  const downloaded = await desktopApi.file.downloadUrlToProject(url, 'director-ai-panorama.png');
  const path = downloaded?.filePath || downloaded?.path || '';
  if (!path) throw new Error('全景图下载到项目失败');
  const buffer = await desktopApi.file.readArrayBuffer(path);
  if (!buffer.byteLength) throw new Error('全景图读取失败');
  return bufferToDataUrl(buffer);
}
