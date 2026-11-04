import { t } from '../../i18n/index.ts';
import type { IconName } from '@/app/components/IconSymbol';

// Shared by node purpose annotations, Agent contracts and asset catalog filters.
export const ASSET_PURPOSE_TYPES = ['character', 'scene', 'prop', 'storyboard', 'voice', 'music', 'soundEffect', 'other'] as const;
export type AssetPurpose = typeof ASSET_PURPOSE_TYPES[number];
export interface AssetCategory {
  id: string;
  purpose: AssetPurpose;
  label: string;
  icon: IconName;
  aliases: string[];
}

export const assetCategories: AssetCategory[] = [
  { id: 'characters', purpose: 'character', label: t('assets.purpose.character'), icon: 'user', aliases: ['actors', 'character'] },
  { id: 'scenes', purpose: 'scene', label: t('assets.purpose.scene'), icon: 'pin', aliases: ['locations', 'scene'] },
  { id: 'props', purpose: 'prop', label: t('assets.purpose.prop'), icon: 'box', aliases: ['prop'] },
  { id: 'shots', purpose: 'storyboard', label: t('assets.purpose.storyboard'), icon: 'grid', aliases: ['storyboard'] },
  { id: 'voice', purpose: 'voice', label: t('assets.purpose.voice'), icon: 'mic', aliases: [] },
  { id: 'music', purpose: 'music', label: t('assets.purpose.music'), icon: 'music', aliases: [] },
  { id: 'soundEffects', purpose: 'soundEffect', label: t('assets.purpose.soundEffect'), icon: 'volume', aliases: ['soundEffect'] },
  { id: 'other', purpose: 'other', label: t('assets.purpose.other'), icon: 'box', aliases: ['styles', 'style', 'costumes'] },
];
export const defaultAssetCategory = assetCategories.find(category => category.purpose === 'other')!;
export function assetCategoryFor(value: unknown): AssetCategory {
  return assetCategories.find(category => category.id === value || category.purpose === value || category.aliases.includes(String(value))) || defaultAssetCategory;
}
