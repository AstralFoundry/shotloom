/**
 * ProtocolPresets — 常见协议的声明式起点。
 *
 * 只收录有事实标准的常见协议（OpenAI 兼容、Claude 原生）。预设只声明协议的
 * 固定骨架，模型 ID / 名称 / 供应商由接入对话框补全；冷门或各家私有的视频、
 * 音频协议不在这里枚举，仍通过内置厂商或手写 JSON 接入。
 */

import type { CatalogMode } from '../catalog/ModelCatalog';

export type ProtocolPresetType = 'textGeneration' | 'imageGeneration';

export interface ProtocolPreset {
  id: string;
  label: string;
  type: ProtocolPresetType;
  buildMode(): CatalogMode;
}

const maxTokensParam = {
  key: 'maxTokens',
  label: '最大长度',
  type: 'select',
  default: 8192,
  numeric: true,
  options: [4096, 8192, 16384],
};

export const PROTOCOL_PRESETS: readonly ProtocolPreset[] = [
  {
    id: 'openai-chat',
    label: 'OpenAI 兼容 · 文本',
    type: 'textGeneration',
    buildMode: () => ({
      id: 'text-generation',
      label: '文本生成',
      endpoint: { method: 'POST', path: '/chat/completions', scope: 'root' },
      inputConstraints: {},
      outputConstraints: {},
      params: [{ ...maxTokensParam }],
      auth: { type: 'bearer' },
      requestTemplate: {
        model: '{{model}}',
        messages: '{{messages}}',
        max_tokens: '{{params.maxTokens}}',
      },
      resultTextPath: 'choices.0.message.content',
    }),
  },
  {
    id: 'openai-image',
    label: 'OpenAI 兼容 · 图片',
    type: 'imageGeneration',
    buildMode: () => ({
      id: 'text-to-image',
      label: '文生图',
      endpoint: { method: 'POST', path: '/images/generations', scope: 'root' },
      inputConstraints: {},
      outputConstraints: {},
      params: [
        {
          key: 'size',
          label: '尺寸',
          type: 'select',
          default: '1024x1024',
          options: ['1024x1024', '1536x864', '864x1536'],
        },
      ],
      auth: { type: 'bearer' },
      requestTemplate: {
        model: '{{model}}',
        prompt: '{{prompt}}',
        size: '{{params.size}}',
      },
      resultUrlPath: 'data.*.url',
    }),
  },
  {
    id: 'anthropic-messages',
    label: 'Claude 原生 · 文本',
    type: 'textGeneration',
    buildMode: () => ({
      id: 'text-generation',
      label: '文本生成',
      endpoint: { method: 'POST', path: '/v1/messages', scope: 'root' },
      inputConstraints: {},
      outputConstraints: {},
      params: [{ ...maxTokensParam }],
      auth: { type: 'header', name: 'x-api-key' },
      headers: { 'anthropic-version': '2023-06-01' },
      requestTemplate: {
        model: '{{model}}',
        system: '{{system}}',
        messages: '{{nonSystemMessages}}',
        max_tokens: '{{params.maxTokens}}',
      },
      resultTextPath: 'content.0.text',
    }),
  },
];

export function getProtocolPreset(id: string): ProtocolPreset | undefined {
  return PROTOCOL_PRESETS.find((preset) => preset.id === id);
}

export function presetsForType(type: string): ProtocolPreset[] {
  return PROTOCOL_PRESETS.filter((preset) => preset.type === type);
}
