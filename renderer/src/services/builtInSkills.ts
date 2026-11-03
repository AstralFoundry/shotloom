import { catalogLabel, t } from '../i18n/index.ts';
import { changedBuiltInFields, withBuiltInEntries, withoutBuiltInEntries } from './builtInCatalogStorage.ts';

type AnyRecord = Record<string, any>;

const skillSources = import.meta.glob('../agent/content/skills/*/SKILL.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>;

function skillIdFromPath(path: string): string {
  return path.split('/').at(-2) || '';
}

/**
 * 内置技能记录。用类型别名而不是 interface，才能作为隐式索引签名对象
 * 传给 builtInCatalogStorage 的 AnyRecord 参数。
 */
export type BuiltInSkill = {
  id: string;
  name: string;
  description: string;
  category: string;
  version: number;
  instructions: string;
  contracts: string[] | undefined;
  workflow: string | undefined;
  metadata: Record<string, unknown>;
  builtIn: true;
  enabled: boolean;
  updatedAt: string;
};

function parseBuiltInSkill(content: string, manifest: AnyRecord): BuiltInSkill {
  const frontmatter = String(content || '').match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const metadata: AnyRecord = {};
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
    if (value.startsWith('{') && value.endsWith('}')) {
      try {
        metadata[key] = JSON.parse(value);
      } catch {
        metadata[key] = value;
      }
    } else if (value === '' || value === '[]') {
      // Start of a list block (empty value or [] means list items follow)
      currentListKey = key;
      metadata[key] = [];
    } else {
      metadata[key] = value;
    }
  }
  const name = metadata.name || manifest.id;
  const nativeMetadata = metadata.metadata && typeof metadata.metadata === 'object'
    ? metadata.metadata
    : {};
  if (!manifest.id || !name) throw new Error(`Invalid built-in Skill identity: ${manifest.id || name}`);
  return {
    id: manifest.id,
    name,
    description: metadata.description || '',
    category: String(nativeMetadata.category || 'general'),
    version: Number(nativeMetadata.version) || 1,
    instructions: String(content || '').slice(frontmatter?.[0]?.length || 0).trim(),
    contracts: Array.isArray(metadata.contracts) ? metadata.contracts : undefined,
    workflow: typeof metadata.workflow === 'string' ? metadata.workflow : undefined,
    metadata: nativeMetadata,
    builtIn: true,
    enabled: nativeMetadata.defaultEnabled !== false,
    updatedAt: '',
  };
}

export const builtInSkills: BuiltInSkill[] = Object.entries(skillSources)
  .map(([path, content]) => {
    const id = skillIdFromPath(path);
    return parseBuiltInSkill(content, { id });
  })
  .sort((left, right) => left.id.localeCompare(right.id));

export function withBuiltInSkills(storage: AnyRecord = {}): AnyRecord {
  const catalog = withBuiltInEntries(storage, 'skills', builtInSkills);
  catalog.skills = catalog.skills.map(({ recipeIds, ...skill }: AnyRecord) => skill);
  return catalog;
}

export function withoutBuiltInSkills(storage: AnyRecord = {}): AnyRecord {
  const catalog = withoutBuiltInEntries(storage, 'skills');
  catalog.skills = catalog.skills.map(({ recipeIds, ...skill }: AnyRecord) => skill);
  return catalog;
}

export function builtInSkillChanges(skill: AnyRecord | null | undefined): string[] {
  return changedBuiltInFields(skill, builtInSkills);
}

export function getBuiltInSkill(skillId: string): BuiltInSkill | null {
  return builtInSkills.find((skill) => skill.id === skillId) || null;
}

/** Translate only the shipped description in catalog views; editable content stays intact. */
export function skillDisplayDescription(skill: { id: string; description?: string; builtIn?: boolean }): string {
  const description = String(skill.description || '');
  const baseline = skill.builtIn ? getBuiltInSkill(skill.id) : null;
  return baseline && description === baseline.description
    ? catalogLabel(description, `skill.description.${skill.id}`)
    : description;
}

const skillCategoryKeys = {
  '商业广告': 'commercial', '专业影视': 'film', '动画': 'animation',
  '创意实验': 'experimental', '教育': 'education', '短剧漫剧': 'drama',
  '平台工具': 'platform', video: 'video', general: 'general', text: 'text',
  social: 'social', marketing: 'marketing', ecommerce: 'ecommerce',
} as const;

export function skillDisplayCategory(skill: { id: string; category?: string; builtIn?: boolean }): string {
  const category = String(skill.category || '');
  const baseline = skill.builtIn ? getBuiltInSkill(skill.id) : null;
  const key = baseline && category === baseline.category
    ? skillCategoryKeys[category as keyof typeof skillCategoryKeys] : undefined;
  return key ? t(`skill.category.${key}`) : category;
}
