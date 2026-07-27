import { reactive } from '@/store/domainReactivity';
import { desktopApi } from '@/services/desktopApi';
import { getBuiltInRecipe } from '@/services/builtInRecipes';

export const recipesStore = reactive({
  storageVersion: 1,
  recipes: [],
});

function recipeId(name = '') {
  const base = String(name).trim().toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'recipe';
  const used = new Set(recipesStore.recipes.map((recipe) => recipe.id));
  let id = base;
  let suffix = 2;
  while (used.has(id)) id = `${base}-${suffix++}`;
  return id;
}

export async function loadGlobalRecipes() {
  const storage = await desktopApi.recipes.getGlobal();
  recipesStore.storageVersion = Number(storage.storageVersion) || 1;
  recipesStore.recipes = Array.isArray(storage.recipes) ? storage.recipes : [];
}

export async function saveGlobalRecipes() {
  const snapshot = JSON.parse(JSON.stringify({
    storageVersion: recipesStore.storageVersion,
    recipes: recipesStore.recipes,
  }));
  const storage = await desktopApi.recipes.setGlobal(snapshot);
  recipesStore.storageVersion = Number(storage.storageVersion) || 1;
  recipesStore.recipes = Array.isArray(storage.recipes) ? storage.recipes : [];
}

export function createRecipeDraft() {
  return {
    id: recipeId('custom-recipe'),
    name: '新策略',
    description: '说明这个策略适合增强哪类提示词。',
    generationType: 'image',
    operationTypes: ['image'],
    systemPrompt: '写清主体、动作、环境、镜头和风格，输出可直接运行的完整提示词。',
    requiredElements: ['主体'],
    version: 1,
    enabled: true,
    updatedAt: new Date().toISOString(),
  };
}

export async function upsertRecipe(recipe) {
  const existing = recipesStore.recipes.find((item) => item.id === String(recipe.id || '').trim());
  const normalized = {
    ...recipe,
    id: String(recipe.id || '').trim(),
    name: String(recipe.name || '').trim(),
    description: String(recipe.description || '').trim(),
    operationTypes: [...new Set((recipe.operationTypes || []).map((value) => String(value).trim()).filter(Boolean))],
    requiredElements: [...new Set((recipe.requiredElements || []).map((value) => String(value).trim()).filter(Boolean))],
    systemPrompt: String(recipe.systemPrompt || '').trim(),
    version: Math.max(1, Number(recipe.version) || 1),
    enabled: recipe.enabled !== false,
    builtIn: existing?.builtIn === true,
    updatedAt: new Date().toISOString(),
  };
  if (!/^[a-z0-9:_-]{1,80}$/.test(normalized.id)) throw new Error('策略 ID 仅允许小写字母、数字、:、-、_');
  if (!normalized.name || !normalized.description || !normalized.systemPrompt) {
    throw new Error('策略名称、用途说明和 System Prompt 均不能为空');
  }
  if (!['image', 'video', 'audio', 'text'].includes(normalized.generationType)) {
    throw new Error(`策略的生成类型无效：${normalized.generationType || '空'}`);
  }
  if (!normalized.operationTypes.length || !normalized.requiredElements.length) {
    throw new Error('策略的 Operation Types 和必需元素均不能为空');
  }
  const index = recipesStore.recipes.findIndex((item) => item.id === normalized.id);
  if (index >= 0) recipesStore.recipes[index] = normalized;
  else recipesStore.recipes.push(normalized);
  await saveGlobalRecipes();
  return normalized;
}

export async function toggleRecipe(recipeIdValue) {
  const recipe = recipesStore.recipes.find((item) => item.id === recipeIdValue);
  if (!recipe) return;
  recipe.enabled = recipe.enabled === false;
  await saveGlobalRecipes();
}

export async function deleteRecipe(recipeIdValue) {
  if (recipesStore.recipes.find((recipe) => recipe.id === recipeIdValue)?.builtIn) return;
  recipesStore.recipes = recipesStore.recipes.filter((recipe) => recipe.id !== recipeIdValue);
  await saveGlobalRecipes();
}

export async function resetRecipeToBuiltIn(recipeIdValue) {
  const original = getBuiltInRecipe(recipeIdValue);
  const index = recipesStore.recipes.findIndex((recipe) => recipe.id === recipeIdValue);
  if (!original || index < 0) return false;
  const enabled = recipesStore.recipes[index].enabled !== false;
  recipesStore.recipes[index] = {
    ...JSON.parse(JSON.stringify(original)),
    enabled,
    builtIn: true,
    updatedAt: new Date().toISOString(),
  };
  await saveGlobalRecipes();
  return true;
}
