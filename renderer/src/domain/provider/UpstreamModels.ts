import { t } from '../../i18n/index.ts';
import { getCatalogModels } from '../catalog/ModelCatalog';
import { findProviderAdapter } from './adapters';

export interface UpstreamModel {
  id: string;
  owned_by?: string;
  supported_endpoint_types?: string[] | null;
}

export interface UpstreamModelRow {
  id: string;
  type: string;
  providerName: string;
  iconId: string;
}

export function parseUpstreamModels(value: unknown): UpstreamModel[] {
  if (!Array.isArray(value) || value.some(model => !model || typeof model.id !== 'string' || !model.id.trim()
    || (model.owned_by !== undefined && typeof model.owned_by !== 'string')
    || (model.supported_endpoint_types !== undefined && model.supported_endpoint_types !== null
      && (!Array.isArray(model.supported_endpoint_types) || model.supported_endpoint_types.some((type: unknown) => typeof type !== 'string'))))) {
    throw new Error(t('settings.upstreamModels.invalid'));
  }
  return [...new Map(value.map(model => [model.id, model])).values()];
}

export function getUpstreamModelRows(models: UpstreamModel[]): UpstreamModelRow[] {
  const catalog = getCatalogModels();
  return models.map(model => {
    const declarations = catalog.filter(entry => (entry.upstreamModel || entry.id) === model.id);
    const declaredTypes = new Set(declarations.map(entry => entry.type));
    const endpoints = model.supported_endpoint_types || [];
    // 通用聊天协议也承载图片、视频与音频；没有明确类型时保留在“其他”。
    const type = declaredTypes.size === 1 ? declarations[0]!.type : endpoints.includes('image-generation') ? 'imageGeneration'
      : endpoints.includes('openai-video') ? 'videoGeneration'
      : declaredTypes.size === 1 ? declarations[0]?.type || 'other' : 'other';
    return {
      id: model.id,
      type,
      providerName: model.owned_by || '',
      iconId: findProviderAdapter(model.owned_by || '')?.iconId || '',
    };
  });
}
