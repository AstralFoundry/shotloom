import { t } from '../i18n/index.ts';
import { getLocale, normalizeLocale } from '@/i18n';
import { reactive, toRaw } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { normalizeCanvasActionShortcuts } from '@/utils/canvasActionShortcuts';
import {
  defaultCanvasToolbarCustomization,
  normalizeCanvasToolbarCustomization,
} from '@/utils/canvasNodeToolbar';
import { defaultGenerationModel } from '@/utils/defaultGenerationModels';
import { clonePlainData } from '@/utils/plainDataClone.ts';
import { getModelIdsByType } from '@/domain/catalog/ModelCatalog';
import { normalizeProviderConfigs } from '@/domain/provider/ProviderConfig';
import type { ProviderConfigs } from '@/domain/provider/ProviderConfig';
import {
  getConfiguredAgentModelCatalog,
  getConfiguredModelIdsByType,
  getModelCredentialStatus as resolveModelCredentialStatus,
} from '@/domain/provider/ModelAvailability';

// 设置通过 desktopApi 写入 SQLite；接口回执与设置补丁都按 AnyRecord 进出，
// 只有 providerConfigs 这类已有严格契约的字段使用 app/domain 类型。
type AnyRecord = Record<string, any>;

interface TokenGroup {
  id: string;
  name: string;
  ratio: number;
}

interface RuntimeProtection {
  healthIntervalMs: number;
  failureThreshold: number;
  failureWindowMs: number;
  circuitCooldownMs: number;
  stallWarningMs: number;
  hardCapMs: number;
}

export const settingsStore = reactive({
  storageVersion: 7,
  locale: getLocale(),
  providerConfigs: {} as ProviderConfigs,
  balance: 0, rawQuota: 0, usedQuota: 0,
  tokenGroups: [] as TokenGroup[], activeTokenGroupId: '',
  apiKeyValid: false, accountSyncError: '',
  projectRootDir: '',
  modelPollIntervalMs: 1500,
  agentAutoEval: true, agentAutoLayout: true, agentCanRunNodes: false,
  agentShellApproval: 'full',
  // 审批策略（服务层唯一判定）：'ask' 可以请求用户裁决；'never' 无人值守，需要审批的操作一律自动拒绝。
  // 它独立于 agentShellApproval：后者是"哪些操作要问"，前者是"到底还问不问"。
  agentApprovalPolicy: 'ask',
  // 思考程度只保存用户选的档位名；是否可用由模型目录声明的档位决定，'' 表示跟随模型默认。
  agentReasoningEffort: '',
  agentPreferredTextModel: defaultGenerationModel('textGeneration'),
  agentPreferredImageModel: defaultGenerationModel('imageGeneration'),
  agentPreferredVideoModel: defaultGenerationModel('videoGeneration'),
  canvasActionShortcuts: normalizeCanvasActionShortcuts(),
  canvasToolbarCustomization: defaultCanvasToolbarCustomization(),
  layoutAlgorithm: 'grid-aligned', updatedAt: '',
  runtimeProtection: {
    healthIntervalMs: 10000, failureThreshold: 3, failureWindowMs: 300000,
    circuitCooldownMs: 120000, stallWarningMs: 180000, hardCapMs: 1800000,
  } as RuntimeProtection,
  loading: false, syncing: false,
});

/**
 * 至少有一个 Provider 配置了 API Key 即视为远程模型可用。
 */
export function isRemoteModelEnabled() {
  return Object.values(settingsStore.providerConfigs).some((config) => Boolean(config?.apiKey?.trim()));
}

export function getModelCredentialStatus(modelId: string) {
  return resolveModelCredentialStatus(modelId, settingsStore.providerConfigs);
}

export function isModelAvailable(modelId: string) {
  return getModelCredentialStatus(modelId).available;
}

export function getAvailableModelIdsByType(nodeType: string) {
  return getConfiguredModelIdsByType(nodeType, settingsStore.providerConfigs);
}

export function getAvailableAgentModelCatalog() {
  return getConfiguredAgentModelCatalog(settingsStore.providerConfigs);
}

function normalizeTokenGroups(tokenGroups: unknown): TokenGroup[] {
  return (Array.isArray(tokenGroups) ? tokenGroups : []).map((item, index) => {
    const group = item as AnyRecord;
    return {
      id: String(group?.id || `group-${index + 1}`),
      name: String(group?.name || t("ui.settingsStore.text.2430ffee", { value0: String(index + 1) })),
      ratio: Number.isFinite(Number(group?.ratio)) ? Number(group.ratio) : 1,
    };
  });
}

function normalizePreferredTextModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : '';
  return getModelIdsByType('textGeneration').includes(model) ? model : defaultGenerationModel('textGeneration');
}
function normalizePreferredImageModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : '';
  return getModelIdsByType('imageGeneration').includes(model) ? model : defaultGenerationModel('imageGeneration');
}
function normalizePreferredVideoModel(value: unknown) {
  const model = typeof value === 'string' ? value.trim() : '';
  return getModelIdsByType('videoGeneration').includes(model) ? model : defaultGenerationModel('videoGeneration');
}

function toPlainSettings(patch: AnyRecord = {}) {
  const rawStore = toRaw(settingsStore);
  const rawPatch = toRaw(patch) || {};
  const next: AnyRecord = {
    storageVersion: rawStore.storageVersion,
    locale: rawStore.locale,
    providerConfigs: { ...rawStore.providerConfigs },
    balance: rawStore.balance, rawQuota: rawStore.rawQuota, usedQuota: rawStore.usedQuota,
    tokenGroups: normalizeTokenGroups(rawStore.tokenGroups),
    activeTokenGroupId: rawStore.activeTokenGroupId,
    apiKeyValid: rawStore.apiKeyValid, accountSyncError: rawStore.accountSyncError,
    projectRootDir: rawStore.projectRootDir,
    modelPollIntervalMs: rawStore.modelPollIntervalMs,
    agentAutoEval: rawStore.agentAutoEval, agentAutoLayout: rawStore.agentAutoLayout,
    agentCanRunNodes: rawStore.agentCanRunNodes,
    agentShellApproval: rawStore.agentShellApproval,
    agentApprovalPolicy: rawStore.agentApprovalPolicy,
    agentReasoningEffort: rawStore.agentReasoningEffort,
    agentPreferredTextModel: rawStore.agentPreferredTextModel,
    agentPreferredImageModel: rawStore.agentPreferredImageModel,
    agentPreferredVideoModel: rawStore.agentPreferredVideoModel,
    canvasActionShortcuts: normalizeCanvasActionShortcuts(rawStore.canvasActionShortcuts),
    canvasToolbarCustomization: normalizeCanvasToolbarCustomization(rawStore.canvasToolbarCustomization),
    layoutAlgorithm: rawStore.layoutAlgorithm === 'elk-layered' ? 'elk-layered' : 'grid-aligned',
    runtimeProtection: { ...rawStore.runtimeProtection },
    ...rawPatch,
  };
  next.tokenGroups = normalizeTokenGroups(next.tokenGroups);
  next.providerConfigs = normalizeProviderConfigs(next.providerConfigs);
  return clonePlainData(next);
}

function applySettings(settings: AnyRecord) {
  settingsStore.storageVersion = settings.storageVersion;
  settingsStore.locale = normalizeLocale(settings.locale);
  settingsStore.providerConfigs = normalizeProviderConfigs(toRaw(settings.providerConfigs) || {});
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
  settingsStore.agentShellApproval = settings.agentShellApproval === 'ask' ? 'ask' : 'full';
  settingsStore.agentApprovalPolicy = settings.agentApprovalPolicy === 'never' ? 'never' : 'ask';
  settingsStore.agentReasoningEffort = typeof settings.agentReasoningEffort === 'string'
    ? settings.agentReasoningEffort.trim()
    : '';
  settingsStore.agentPreferredTextModel = normalizePreferredTextModel(settings.agentPreferredTextModel);
  settingsStore.agentPreferredImageModel = normalizePreferredImageModel(settings.agentPreferredImageModel);
  settingsStore.agentPreferredVideoModel = normalizePreferredVideoModel(settings.agentPreferredVideoModel);
  settingsStore.canvasActionShortcuts = normalizeCanvasActionShortcuts(settings.canvasActionShortcuts);
  settingsStore.canvasToolbarCustomization = normalizeCanvasToolbarCustomization(settings.canvasToolbarCustomization);
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
    let settings: AnyRecord = await desktopApi.settings.get();
    if (desktopApi.platform !== 'browser') {
      const requestedRoot = String(settings.projectRootDir || '');
      const ensuredRoot = await desktopApi.project.ensureRoot?.(requestedRoot);
      if (ensuredRoot && ensuredRoot !== requestedRoot) {
        settings = await desktopApi.settings.set({ ...settings, projectRootDir: ensuredRoot });
      }
    }
    applySettings(settings);
    // Rust 网关生成时只从设置文件读取 baseUrl，因此加载后要把适配器算出的生效地址写回磁盘。
    if (desktopApi.platform !== 'browser' && providerConfigsNeedWrite(settings.providerConfigs)) {
      await saveAppSettings({ providerConfigs: toRaw(settingsStore.providerConfigs) });
    }
  } finally {
    settingsStore.loading = false;
  }
}

function providerConfigsNeedWrite(stored: unknown) {
  const normalized = normalizeProviderConfigs(toRaw(stored as AnyRecord) || {});
  return JSON.stringify(toRaw(stored) ?? null) !== JSON.stringify(normalized);
}

export async function saveAppSettings(patch: AnyRecord = {}) {
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

export async function setActiveTokenGroup(groupId: string) {
  applySettings(await desktopApi.settings.setTokenGroup(groupId));
}
