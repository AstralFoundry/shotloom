import { reactive, toRaw } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { normalizeCanvasActionShortcuts } from '@/utils/canvasActionShortcuts';
import { getModelIdsByType, setExternalCatalogModels } from '@/domain/catalog/ModelCatalog';
import { getConfiguredProviders, getProviderDefinition } from '@/domain/provider/ProviderRegistry';
import { buildCustomCatalogModels } from '@/domain/provider/CustomModelCatalog';
import {
  getConfiguredAgentModelCatalog,
  getConfiguredModelIdsByType,
  getModelCredentialStatus as resolveModelCredentialStatus,
} from '@/domain/provider/ModelAvailability';

export const settingsStore = reactive({
  storageVersion: 7,
  providerConfigs: /** @type {Record<string, import('@/domain/provider/ProviderRegistry').ProviderConfig>} */ ({}),
  balance: 0, rawQuota: 0, usedQuota: 0,
  tokenGroups: [], activeTokenGroupId: '',
  apiKeyValid: false, accountSyncError: '',
  projectRootDir: '',
  modelPollIntervalMs: 1500,
  agentAutoEval: true, agentAutoLayout: true, agentCanRunNodes: false,
  agentPreferredTextModel: 'gpt-5.4',
  agentPreferredImageModel: 'gpt-image-2',
  agentPreferredVideoModel: 'grok-imagine-video',
  canvasActionShortcuts: normalizeCanvasActionShortcuts(),
  layoutAlgorithm: 'grid-aligned', updatedAt: '',
  runtimeProtection: {
    healthIntervalMs: 10000, failureThreshold: 3, failureWindowMs: 300000,
    circuitCooldownMs: 120000, stallWarningMs: 180000, hardCapMs: 1800000,
  },
  loading: false, syncing: false,
});

/**
 * 至少有一个 Provider 配置了 API Key 即视为远程模型可用。
 */
export function isRemoteModelEnabled() {
  const providers = getConfiguredProviders(settingsStore.providerConfigs);
  return providers.length > 0;
}

export function getModelCredentialStatus(modelId) {
  return resolveModelCredentialStatus(modelId, settingsStore.providerConfigs);
}

export function isModelAvailable(modelId) {
  return getModelCredentialStatus(modelId).available;
}

export function getAvailableModelIdsByType(nodeType) {
  return getConfiguredModelIdsByType(nodeType, settingsStore.providerConfigs);
}

export function getAvailableAgentModelCatalog() {
  return getConfiguredAgentModelCatalog(settingsStore.providerConfigs);
}

/**
 * 根据 modelId 查找对应的 provider key/url。
 * 优先使用 per-provider 配置，fallback 到 provider 默认值。
 */
export function getProviderCredentials(providerId) {
  const cfg = settingsStore.providerConfigs[providerId];
  const def = getProviderDefinition(providerId);
  return {
    baseUrl: (cfg?.baseUrl || def?.defaultBaseUrl || '').replace(/\/+$/, ''),
    apiKey: cfg?.apiKey || '',
  };
}

function normalizeTokenGroups(tokenGroups) {
  return (Array.isArray(tokenGroups) ? tokenGroups : []).map((group, index) => ({
    id: String(group?.id || `group-${index + 1}`),
    name: String(group?.name || `分组 ${index + 1}`),
    ratio: Number.isFinite(Number(group?.ratio)) ? Number(group.ratio) : 1,
  }));
}

function normalizePreferredTextModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return getModelIdsByType('textGeneration').includes(model) ? model : 'gpt-5.4';
}
function normalizePreferredImageModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return getModelIdsByType('imageGeneration').includes(model) ? model : 'gpt-image-2';
}
function normalizePreferredVideoModel(value) {
  const model = typeof value === 'string' ? value.trim() : '';
  return getModelIdsByType('videoGeneration').includes(model) ? model : 'grok-imagine-video';
}

function toPlainSettings(patch = {}) {
  const rawStore = toRaw(settingsStore);
  const rawPatch = toRaw(patch) || {};
  const next = {
    storageVersion: rawStore.storageVersion,
    providerConfigs: { ...rawStore.providerConfigs },
    balance: rawStore.balance, rawQuota: rawStore.rawQuota, usedQuota: rawStore.usedQuota,
    tokenGroups: normalizeTokenGroups(rawStore.tokenGroups),
    activeTokenGroupId: rawStore.activeTokenGroupId,
    apiKeyValid: rawStore.apiKeyValid, accountSyncError: rawStore.accountSyncError,
    projectRootDir: rawStore.projectRootDir,
    modelPollIntervalMs: rawStore.modelPollIntervalMs,
    agentAutoEval: rawStore.agentAutoEval, agentAutoLayout: rawStore.agentAutoLayout,
    agentCanRunNodes: rawStore.agentCanRunNodes,
    agentPreferredTextModel: rawStore.agentPreferredTextModel,
    agentPreferredImageModel: rawStore.agentPreferredImageModel,
    agentPreferredVideoModel: rawStore.agentPreferredVideoModel,
    canvasActionShortcuts: normalizeCanvasActionShortcuts(rawStore.canvasActionShortcuts),
    layoutAlgorithm: rawStore.layoutAlgorithm === 'elk-layered' ? 'elk-layered' : 'grid-aligned',
    runtimeProtection: { ...rawStore.runtimeProtection },
    ...rawPatch,
  };
  next.tokenGroups = normalizeTokenGroups(next.tokenGroups);
  return next;
}

function applySettings(settings) {
  settingsStore.storageVersion = settings.storageVersion;
  settingsStore.providerConfigs = settings.providerConfigs || {};
  setExternalCatalogModels(buildCustomCatalogModels(settingsStore.providerConfigs));
  settingsStore.balance = Number.isFinite(settings.balance) ? settings.balance : 0;
  settingsStore.rawQuota = Number.isFinite(settings.rawQuota) ? settings.rawQuota : 0;
  settingsStore.usedQuota = Number.isFinite(settings.usedQuota) ? settings.usedQuota : 0;
  settingsStore.tokenGroups = normalizeTokenGroups(settings.tokenGroups);
  settingsStore.activeTokenGroupId = settings.activeTokenGroupId || '';
  settingsStore.apiKeyValid = Boolean(settings.apiKeyValid);
  settingsStore.accountSyncError = settings.accountSyncError || '';
  settingsStore.projectRootDir = settings.projectRootDir || '';
  settingsStore.modelPollIntervalMs = Number.isFinite(settings.modelPollIntervalMs) ? settings.modelPollIntervalMs : 1500;
  settingsStore.agentAutoEval = settings.agentAutoEval !== false;
  settingsStore.agentAutoLayout = settings.agentAutoLayout !== false;
  settingsStore.agentCanRunNodes = settings.agentCanRunNodes === true;
  settingsStore.agentPreferredTextModel = normalizePreferredTextModel(settings.agentPreferredTextModel);
  settingsStore.agentPreferredImageModel = normalizePreferredImageModel(settings.agentPreferredImageModel);
  settingsStore.agentPreferredVideoModel = normalizePreferredVideoModel(settings.agentPreferredVideoModel);
  settingsStore.canvasActionShortcuts = normalizeCanvasActionShortcuts(settings.canvasActionShortcuts);
  settingsStore.layoutAlgorithm = settings.layoutAlgorithm === 'elk-layered' ? 'elk-layered' : 'grid-aligned';
  settingsStore.runtimeProtection = {
    ...settingsStore.runtimeProtection,
    ...(settings.runtimeProtection || {}),
  };
  settingsStore.updatedAt = settings.updatedAt || '';
}

export async function loadAppSettings() {
  settingsStore.loading = true;
  try {
    let settings = await desktopApi.settings.get();
    if (desktopApi.platform !== 'browser') {
      const requestedRoot = String(settings.projectRootDir || '');
      const ensuredRoot = await desktopApi.project.ensureRoot?.(requestedRoot);
      if (ensuredRoot && ensuredRoot !== requestedRoot) {
        settings = await desktopApi.settings.set({ ...settings, projectRootDir: ensuredRoot });
      }
    }
    applySettings(settings);
  } finally {
    settingsStore.loading = false;
  }
}

export async function saveAppSettings(patch = {}) {
  const next = await desktopApi.settings.set(toPlainSettings(patch));
  applySettings(next);
}

export async function refreshBalance() {
  settingsStore.syncing = true;
  try {
    applySettings(await desktopApi.settings.refreshBalance());
  } finally {
    settingsStore.syncing = false;
  }
}

export async function setActiveTokenGroup(groupId) {
  applySettings(await desktopApi.settings.setTokenGroup(groupId));
}
