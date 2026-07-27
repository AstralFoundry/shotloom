import adobeFirefly from '@lobehub/icons-static-svg/icons/adobefirefly-color.svg';
import anthropic from '@lobehub/icons-static-svg/icons/anthropic.svg';
import claude from '@lobehub/icons-static-svg/icons/claude-color.svg';
import cohere from '@lobehub/icons-static-svg/icons/cohere-color.svg';
import deepseek from '@lobehub/icons-static-svg/icons/deepseek-color.svg';
import doubao from '@lobehub/icons-static-svg/icons/doubao-color.svg';
import fal from '@lobehub/icons-static-svg/icons/fal-color.svg';
import gemini from '@lobehub/icons-static-svg/icons/gemini-color.svg';
import google from '@lobehub/icons-static-svg/icons/google-color.svg';
import grok from '@lobehub/icons-static-svg/icons/grok.svg';
import groq from '@lobehub/icons-static-svg/icons/groq.svg';
import happyhorse from '@lobehub/icons-static-svg/icons/happyhorse.svg';
import huggingface from '@lobehub/icons-static-svg/icons/huggingface-color.svg';
import kimi from '@lobehub/icons-static-svg/icons/kimi-color.svg';
import kling from '@lobehub/icons-static-svg/icons/kling-color.svg';
import midjourney from '@lobehub/icons-static-svg/icons/midjourney.svg';
import minimax from '@lobehub/icons-static-svg/icons/minimax-color.svg';
import mistral from '@lobehub/icons-static-svg/icons/mistral-color.svg';
import moonshot from '@lobehub/icons-static-svg/icons/moonshot.svg';
import ollama from '@lobehub/icons-static-svg/icons/ollama.svg';
import openai from '@lobehub/icons-static-svg/icons/openai.svg';
import openrouter from '@lobehub/icons-static-svg/icons/openrouter-color.svg';
import perplexity from '@lobehub/icons-static-svg/icons/perplexity-color.svg';
import qwen from '@lobehub/icons-static-svg/icons/qwen-color.svg';
import replicate from '@lobehub/icons-static-svg/icons/replicate.svg';
import stability from '@lobehub/icons-static-svg/icons/stability-color.svg';
import together from '@lobehub/icons-static-svg/icons/together-color.svg';
import volcengine from '@lobehub/icons-static-svg/icons/volcengine-color.svg';
import xai from '@lobehub/icons-static-svg/icons/xai.svg';
import zhipu from '@lobehub/icons-static-svg/icons/zhipu-color.svg';

/**
 * 可供 API 厂商复用的品牌图标目录。图标来自 @lobehub/icons-static-svg，
 * 构建时打包到应用内，不依赖在线图片服务。
 */
export const PROVIDER_ICON_OPTIONS = Object.freeze([
  { id: 'openai', label: 'OpenAI', src: openai },
  { id: 'volcengine', label: '火山引擎', src: volcengine },
  { id: 'doubao', label: '豆包', src: doubao },
  { id: 'google', label: 'Google', src: google },
  { id: 'gemini', label: 'Gemini', src: gemini },
  { id: 'xai', label: 'xAI', src: xai },
  { id: 'grok', label: 'Grok', src: grok },
  { id: 'deepseek', label: 'DeepSeek', src: deepseek },
  { id: 'anthropic', label: 'Anthropic', src: anthropic },
  { id: 'claude', label: 'Claude', src: claude },
  { id: 'qwen', label: '通义千问', src: qwen },
  { id: 'kimi', label: 'Kimi', src: kimi },
  { id: 'kling', label: 'Kling AI', src: kling },
  { id: 'moonshot', label: 'Moonshot', src: moonshot },
  { id: 'zhipu', label: '智谱 AI', src: zhipu },
  { id: 'minimax', label: 'MiniMax', src: minimax },
  { id: 'mistral', label: 'Mistral', src: mistral },
  { id: 'cohere', label: 'Cohere', src: cohere },
  { id: 'perplexity', label: 'Perplexity', src: perplexity },
  { id: 'groq', label: 'Groq', src: groq },
  { id: 'openrouter', label: 'OpenRouter', src: openrouter },
  { id: 'together', label: 'Together AI', src: together },
  { id: 'replicate', label: 'Replicate', src: replicate },
  { id: 'fal', label: 'fal.ai', src: fal },
  { id: 'huggingface', label: 'Hugging Face', src: huggingface },
  { id: 'stability', label: 'Stability AI', src: stability },
  { id: 'midjourney', label: 'Midjourney', src: midjourney },
  { id: 'adobefirefly', label: 'Adobe Firefly', src: adobeFirefly },
  { id: 'ollama', label: 'Ollama', src: ollama },
  { id: 'happyhorse', label: 'HappyHorse', src: happyhorse },
]);

const ICONS_BY_ID = new Map(PROVIDER_ICON_OPTIONS.map((icon) => [icon.id, icon]));

const MODEL_ICON_RULES = [
  ['doubao', 'doubao'], ['seedream', 'doubao'], ['seedance', 'doubao'],
  ['gemini', 'gemini'], ['grok', 'grok'], ['claude', 'claude'], ['qwen', 'qwen'],
  ['kimi', 'kimi'], ['moonshot', 'moonshot'], ['glm', 'zhipu'], ['minimax', 'minimax'],
  ['kling', 'kling'],
  ['mistral', 'mistral'], ['deepseek', 'deepseek'], ['midjourney', 'midjourney'],
  ['stable', 'stability'], ['sdxl', 'stability'], ['flux', 'fal'], ['ollama', 'ollama'],
];

export function getProviderIcon(iconId) {
  return ICONS_BY_ID.get(iconId) || ICONS_BY_ID.get('openai');
}

export function resolveProviderIconId(providerId = '', modelId = '', configuredIconId = '') {
  if (ICONS_BY_ID.has(configuredIconId)) return configuredIconId;
  if (ICONS_BY_ID.has(providerId)) return providerId;
  const value = String(modelId).toLowerCase();
  return MODEL_ICON_RULES.find(([keyword]) => value.includes(keyword))?.[1] || 'openai';
}
