import ecommerceProduct from '../agent/content/skills/ecommerce-product/SKILL.md?raw';
import ecommerceProductManifest from '../agent/content/skills/ecommerce-product/skill.json';
import general from '../agent/content/skills/general/SKILL.md?raw';
import generalManifest from '../agent/content/skills/general/skill.json';
import keyframeVideo from '../agent/content/skills/keyframe-video/SKILL.md?raw';
import keyframeVideoManifest from '../agent/content/skills/keyframe-video/skill.json';
import shortDrama from '../agent/content/skills/short-drama/SKILL.md?raw';
import shortDramaManifest from '../agent/content/skills/short-drama/skill.json';
import socialMedia from '../agent/content/skills/social-media/SKILL.md?raw';
import socialMediaManifest from '../agent/content/skills/social-media/skill.json';
import talkingHead from '../agent/content/skills/talking-head/SKILL.md?raw';
import talkingHeadManifest from '../agent/content/skills/talking-head/skill.json';
import videoAd from '../agent/content/skills/video-ad/SKILL.md?raw';
import videoAdManifest from '../agent/content/skills/video-ad/skill.json';
import videoProduction from '../agent/content/skills/video-production/SKILL.md?raw';
import videoProductionManifest from '../agent/content/skills/video-production/skill.json';
import { changedBuiltInFields, withBuiltInEntries, withoutBuiltInEntries } from './builtInCatalogStorage.js';

function parseBuiltInSkill(content, manifest) {
  const frontmatter = String(content || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const metadata = {};
  let currentListKey = '';
  for (const line of String(frontmatter?.[1] || '').split(/\r?\n/)) {
    // YAML list item continuation
    if (currentListKey && /^\s+-\s+.+/.test(line)) {
      const value = line.replace(/^\s+-\s+/, '').trim().replace(/^['"]|['"]$/g, '');
      if (!metadata[currentListKey]) metadata[currentListKey] = [];
      metadata[currentListKey].push(value);
      continue;
    }
    currentListKey = '';
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value === '' || value === '[]') {
      // Start of a list block (empty value or [] means list items follow)
      currentListKey = key;
      metadata[key] = [];
    } else {
      metadata[key] = value;
    }
  }
  const name = metadata.name || manifest.id;
  if (!manifest.id || !name) throw new Error(`Invalid built-in Skill identity: ${manifest.id || name}`);
  if (!Array.isArray(manifest.triggers?.keywords) || !Array.isArray(manifest.recipeIds)) {
    throw new Error(`Invalid built-in Skill manifest: ${manifest.id}`);
  }
  return {
    id: manifest.id,
    name,
    description: metadata.description || '',
    category: manifest.category || 'general',
    version: Number(manifest.version) || 1,
    triggers: {
      keywords: Array.isArray(manifest.triggers?.keywords) ? manifest.triggers.keywords : [],
    },
    instructions: String(content || '').slice(frontmatter?.[0]?.length || 0).trim(),
    recipeIds: Array.isArray(manifest.recipeIds) ? manifest.recipeIds : [],
    contracts: Array.isArray(metadata.contracts) ? metadata.contracts : undefined,
    workflow: typeof metadata.workflow === 'string' ? metadata.workflow : undefined,
    builtIn: true,
    enabled: true,
    updatedAt: '',
  };
}

export const builtInSkills = [
  parseBuiltInSkill(ecommerceProduct, ecommerceProductManifest),
  parseBuiltInSkill(general, generalManifest),
  parseBuiltInSkill(keyframeVideo, keyframeVideoManifest),
  parseBuiltInSkill(shortDrama, shortDramaManifest),
  parseBuiltInSkill(socialMedia, socialMediaManifest),
  parseBuiltInSkill(talkingHead, talkingHeadManifest),
  parseBuiltInSkill(videoAd, videoAdManifest),
  parseBuiltInSkill(videoProduction, videoProductionManifest),
];

export function withBuiltInSkills(storage = {}) {
  return withBuiltInEntries(storage, 'skills', builtInSkills);
}

export function withoutBuiltInSkills(storage = {}) {
  return withoutBuiltInEntries(storage, 'skills');
}

export function builtInSkillChanges(skill) {
  return changedBuiltInFields(skill, builtInSkills);
}

export function getBuiltInSkill(skillId) {
  return builtInSkills.find((skill) => skill.id === skillId) || null;
}
