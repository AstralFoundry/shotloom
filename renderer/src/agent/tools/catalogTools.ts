import { formatToolCount } from '@/utils/format';
import { t } from '@/i18n/index';
import { skillsStore, upsertSkill } from '@/store/skillsStore';
import { recipesStore } from '@/store/recipesStore';
import { store as projectStore } from '@/store/projectStore';
import { filterAssetLibrary } from '@/store/assetStore';
import { getAvailableAgentModelCatalog } from '@/store/settingsStore';
import { registerAgentTool } from '../core/toolRegistry';
import type { JsonObject } from '../core/types';
import { compactAgentModelCatalog } from '@/utils/agentModelCatalog.ts';
import { isPathInsideAssetRoot, projectAssetRoot } from '@/utils/assetPaths';
import { assetCategories } from '@/domain/asset/assetCategories';
import { assertAgentProject } from '@/services/agentProjectIdentity';
import { agentDefinition, AGENT_IDS } from '../agents/definitions.ts';
import { selectAgentSkills } from '../core/visibility.ts';

// 素材分类的 id 与别名都可以作为查询条件：界面写 id，别名沿用素材库既有的归属口径。
const assetCategoryChoices = assetCategories.flatMap((category) => [category.id, ...(category.aliases || [])]);

export interface StoredSkill {
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  category?: string;
  version?: number;
  metadata?: Record<string, unknown>;
  contracts?: string[];
  workflow?: string;
  enabled?: boolean;
  builtIn?: boolean;
  agentIds?: string[];
}

interface StoredRecipe {
  id: string;
  name?: string;
  description?: string;
  generationType?: string;
  operationTypes?: string[];
  systemPrompt?: string;
  requiredElements?: string[];
  enabled?: boolean;
  builtIn?: boolean;
}

/**
 * 某个 Agent 可用的 Skill 列表。Skill 授予属于 Agent 定义的一部分，
 * 运行时请求、执行时的 Skill 事件和输入框选择器都必须走这里，
 * 不能各自再维护一份作用域判断。
 */
export function availableAgentSkills(agentId: string): StoredSkill[] {
  const enabled = (skillsStore.skills as StoredSkill[]).filter((skill) => skill.enabled !== false);
  return selectAgentSkills(agentDefinition(agentId), enabled);
}

function availableRecipes(): StoredRecipe[] {
  return (recipesStore.recipes as StoredRecipe[]).filter((recipe) => recipe.enabled !== false);
}

export function registerCatalogTools(): void {
  registerAgentTool({
    id: 'inspect_skills', title: t('tool.title.inspect_skills'), icon: 'list', effect: 'read',
    description: '读取 Shotloom 技能库与角色分配；传 skillId 读取完整正文和 updatedAt。技能实际加载仍使用官方 skill 工具。',
    inputSchema: { type: 'object', properties: { skillId: { type: 'string' } }, additionalProperties: false },
    execute: (input) => ({ skills: skillsStore.skills.filter(skill => !input.skillId || skill.id === input.skillId).map(skill => ({
      id: skill.id, name: skill.name, description: skill.description, category: skill.category,
      agentIds: skill.agentIds || [], enabled: skill.enabled, builtIn: skill.builtIn === true,
      updatedAt: skill.updatedAt, ...(input.skillId ? { instructions: skill.instructions } : {}),
    })) }),
  });
  registerAgentTool({
    id: 'save_skill', title: t('tool.title.save_skill'), icon: 'file', effect: 'agent_state_write', activity: 'skill', approvalRequired: true,
    description: '审批后创建或更新 Shotloom 全局用户技能，供指定角色自动发现。新建 expectedUpdatedAt 留空；更新必须使用读取到的时间戳。内置技能不可覆盖，请另存新 ID。不授予任何工具或执行权限。',
    inputSchema: {
      type: 'object', required: ['id', 'name', 'description', 'instructions', 'agentIds'],
      properties: {
        id: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' },
        instructions: { type: 'string' }, category: { type: 'string' }, expectedUpdatedAt: { type: 'string' },
        agentIds: { type: 'array', minItems: 1, items: { type: 'string', enum: [...AGENT_IDS] } },
      }, additionalProperties: false,
    },
    summarizeInput: input => String(input.name),
    async execute(input) {
      const id = String(input.id).trim();
      const existing = skillsStore.skills.find(skill => skill.id === id);
      if (existing?.builtIn) return { success: false, applied: false, code: 'BUILT_IN_SKILL', recovery: '请另存为新的用户技能 ID。' };
      if ((existing?.updatedAt || '') !== String(input.expectedUpdatedAt || '')) return {
        success: false, applied: false, code: 'SKILL_VERSION_CONFLICT', recovery: '请重新 inspect_skills 读取当前正文和 updatedAt，再合并修改。',
      };
      await upsertSkill({ ...existing, ...input, id, enabled: existing?.enabled !== false, version: (existing?.version || 0) + 1 });
      const saved = skillsStore.skills.find(skill => skill.id === id);
      if (!saved) throw new Error(t('tool.feedback.catalog.noSavedSkill'));
      return { success: true, applied: true, id: saved.id, name: saved.name, updatedAt: saved.updatedAt,
        agentIds: saved.agentIds, enabled: saved.enabled, scope: 'global',
        activation: 'pending', note: '技能已持久保存；官方会话目录刷新结果由 Tool Bridge 返回。' };
    },
  });
  registerAgentTool({
    id: 'inspect_runtime_capabilities',
    icon: 'shield',
    title: t('tool.title.inspect_runtime_capabilities'),
    description: '读取本轮画布编排和节点执行能力。需要时可以重复读取；能力与用户意图冲突时不得静默降级。',
    effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    summarizeInput: () => t('tool.feedback.catalog.capabilities'),
    execute: (_input, context) => {
      const nodeExecution = context.capabilities.nodeExecution;
      return {
        canvas: { read: true, createNodes: true, configureNodes: true, connectNodes: true },
        nodeExecution,
        executionToolVisible: nodeExecution,
      };
    },
  });

  registerAgentTool({
    id: 'inspect_model_catalog',
    icon: 'package',
    title: t('tool.title.inspect_model_catalog'),
    description: '读取当前完整模型能力快照，包括节点类型、输入角色、模式和 config 参数 schema。需要刷新能力信息时可以重复读取。',
    effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    summarizeInput: () => t('tool.feedback.catalog.snapshot'),
    execute: () => {
      const types = getAvailableAgentModelCatalog() as unknown as JsonObject[];
      const catalog = compactAgentModelCatalog(types);
      const snapshotId = `catalog-${Date.now()}`;
      return {
        snapshotId,
        nodeContract: {
          prompt: '生成节点顶层字符串字段；唯一提示词真值',
          model: '生成节点顶层字符串字段；唯一模型真值',
          outputSpec: '跨模型输出意图：图片可用 aspectRatio/generationCount/quality；视频可用 aspectRatio/duration/resolution/generateAudio/quality；音频可用 duration/quality；文本留空',
          config: '只包含下列 mode.params 中的模型参数，不包含 prompt/model',
        },
        ...catalog,
      };
    },
  });

  registerAgentTool({
    id: 'list_recipes',
    icon: 'list',
    title: t('tool.title.list_recipes'),
    description: '按需查找已启用的提示词模板，可按生成类型或操作类型筛选。模板是可选参考，不要求先加载 Skill，也不是创建节点的前置条件。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        generationType: { type: 'string', enum: ['image', 'video', 'audio', 'text'] },
        operationType: { type: 'string' },
      },
      additionalProperties: false,
    },
    execute: (input) => {
      return {
        recipes: availableRecipes()
          .filter((recipe) => !input.generationType || recipe.generationType === input.generationType)
          .filter((recipe) => !input.operationType || (recipe.operationTypes || []).includes(String(input.operationType)))
          .map((recipe) => ({
            id: recipe.id,
            name: recipe.name,
            description: recipe.description,
            generationType: recipe.generationType,
            operationTypes: recipe.operationTypes || [],
          })),
      };
    },
  });

  registerAgentTool({
    id: 'load_recipe',
    icon: 'file',
    title: t('tool.title.load_recipe'),
    description: '按需读取一个已启用的提示词模板，结合用户要求调整或组合其方法；可用 usageNote 记录用途。可以直接编写 prompt，无需加载模板。',
    effect: 'agent_state_write',
    activity: 'skill',
    inputSchema: {
      type: 'object',
      required: ['recipeId'],
      properties: {
        recipeId: { type: 'string' },
        usageNote: { type: 'string' },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => String(input.recipeId),
    execute: (input, context) => {
      const usageNote = String(input.usageNote || '').trim();
      const recipe = availableRecipes().find((item) => item.id === input.recipeId);
      if (!recipe) throw new Error(t('tool.feedback.recipeMissing', { id: String(input.recipeId) }));
      context.emit({
        type: 'recipe_used',
        recipeId: String(recipe.id),
        name: String(recipe.name || recipe.id),
        generationType: String(recipe.generationType || 'text'),
        source: recipe.builtIn ? 'built-in' : 'user',
        usageNote,
      });
      return {
        id: recipe.id,
        name: recipe.name,
        generationType: recipe.generationType,
        operationTypes: recipe.operationTypes || [],
        instructions: recipe.systemPrompt || '',
        requiredElements: recipe.requiredElements || [],
      };
    },
  });

  registerAgentTool({
    id: 'inspect_assets',
    icon: 'box',
    title: t('tool.title.inspect_assets'),
    description: '读取项目素材库里已绑定真实文件的设定条目（角色、场景、道具、风格、分镜），返回可直接用于 place_asset_on_canvas 的 assetId、materialId 与名称。只读，不修改素材库，也不读取文件内容；库里的素材是用户既有资产，规划前应先读取以避免重复生成。',
    effect: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string' },
        category: { type: 'string', enum: assetCategoryChoices },
        resourceType: { type: 'string', enum: ['image', 'video', 'audio', 'text', 'file'] },
      },
      additionalProperties: false,
    },
    summarizeInput: (input) => {
      const parts = [input.category, input.resourceType, input.keyword].filter(Boolean);
      return parts.length ? parts.map(String).join(' · ') : t('tool.feedback.catalog.allAssets');
    },
    execute: (input, context) => {
      assertAgentProject(context.projectKey, context.projectInstanceId, context.projectGeneration);
      const project = projectStore.project as Record<string, any>;
      const assets = (Array.isArray(project.assets) ? project.assets : []) as JsonObject[];
      const materials = new Map((Array.isArray(project.materials) ? project.materials : [])
        .map((item: any) => [String(item.id), item]));
      const assetRoot = projectAssetRoot(project, projectStore.projectDir);
      const filters = {
        keyword: String(input.keyword || ''),
        category: String(input.category || ''),
        resourceType: String(input.resourceType || ''),
      };
      const categoryLabel = (categoryId: unknown) => String(
        assetCategories.find((category) => category.id === categoryId || category.aliases?.includes(String(categoryId)))?.label
        || categoryId || '',
      );
      return {
        libraryTotal: filterAssetLibrary(assets as Record<string, any>[]).length,
        assets: filterAssetLibrary(assets as Record<string, any>[], filters).map((asset: Record<string, any>) => {
          const material = (materials.get(String(asset.materialId)) || {}) as Record<string, any>;
          const path = String(material.path || material.filePath || asset.path || asset.filePath || '');
          return {
            assetId: String(asset.id || ''),
            materialId: String(asset.materialId || ''),
            name: String(asset.name || material.name || ''),
            category: String(asset.category || ''),
            categoryLabel: categoryLabel(asset.category),
            resourceType: String(asset.resourceType || material.resourceType || ''),
            nodeType: String(asset.nodeType || material.nodeType || ''),
            code: String(asset.code || ''),
            phone: String(asset.phone || ''),
            tags: Array.isArray(asset.tags) ? asset.tags.map(String) : [],
            note: String(asset.note || material.note || ''),
            path,
            hasLocalFile: !!path && !/^(?:https?:|blob:|data:)/i.test(path),
            inProjectAssets: isPathInsideAssetRoot(path, assetRoot),
          };
        }),
      };
    },
    summarizeResult: (result: any) => {
      const assets = Array.isArray(result?.assets) ? result.assets : [];
      return { summary: assets.length ? formatToolCount('assets', assets.length) : t('tool.feedback.catalog.noAssets') };
    },
  });
}
