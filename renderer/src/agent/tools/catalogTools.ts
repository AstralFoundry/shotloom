import { skillsStore } from '@/store/skillsStore';
import { recipesStore } from '@/store/recipesStore';
import { getAvailableAgentModelCatalog } from '@/store/settingsStore';
import { registerAgentTool } from '../core/toolRegistry';
import type { JsonObject } from '../core/types';
import type { AgentToolContext } from '../core/types';
import { compactAgentModelCatalog } from '@/utils/agentModelCatalog.mjs';

export interface StoredSkill {
  id: string;
  name?: string;
  description?: string;
  instructions?: string;
  category?: string;
  version?: number;
  triggers?: { keywords?: string[] };
  contracts?: string[];
  workflow?: string;
  enabled?: boolean;
  builtIn?: boolean;
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

export function availableAgentSkills(): StoredSkill[] {
  return (skillsStore.skills as StoredSkill[]).filter((skill) => skill.enabled !== false);
}

function availableRecipes(): StoredRecipe[] {
  return (recipesStore.recipes as StoredRecipe[]).filter((recipe) => recipe.enabled !== false);
}

export function registerCatalogTools(): void {
  registerAgentTool({
    id: 'inspect_runtime_capabilities',
    title: '查看 Agent 运行能力',
    description: '读取本轮画布编排和节点执行能力。需要时可以重复读取；能力与用户意图冲突时不得静默降级。',
    effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    summarizeInput: () => '本轮运行能力',
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
    title: '查看模型目录',
    description: '读取当前完整模型能力快照，包括节点类型、输入角色、模式和 config 参数 schema。需要刷新能力信息时可以重复读取。',
    effect: 'read',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    summarizeInput: () => '完整能力快照',
    execute: (_input, context) => {
      const types = getAvailableAgentModelCatalog() as unknown as JsonObject[];
      const catalog = compactAgentModelCatalog(types);
      const snapshotId = `catalog-${Date.now()}`;
      context.state.set('modelCatalogSnapshotId', snapshotId);
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
    title: '查找提示词模板',
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
    execute: (input, context) => {
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
    title: '读取提示词模板',
    description: '按需读取一个已启用的提示词模板，结合用户要求调整或组合其方法；可用 usageNote 记录用途。可以直接编写 prompt，无需加载模板。',
    effect: 'agent_state_write',
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
      if (!recipe) throw new Error(`Recipe not found or disabled: ${String(input.recipeId)}`);
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
}
