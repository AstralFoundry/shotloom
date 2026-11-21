import { uid } from '../../utils/format.ts';

/**
 * 姿势库数据只描述参考图目录：分组、筛选与图片地址都在这里收窄，
 * 图片按需读取，插入时复制为用户自己的项目素材。
 */
export const POSE_LIBRARY_IMAGE_BASE = 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/';
export const POSE_LIBRARY_HOMEPAGE = 'https://github.com/anhao/ai-pose-gallery-zh';
export const POSE_LIBRARY_MAX_SELECTION = 16;
export const POSE_LIBRARY_PAGE_SIZE = 36;
export const POSE_LIBRARY_ANGLES = ['正面', '斜侧', '侧面', '背面', '俯视', '仰视'] as const;

export type PoseItem = {
  id: string;
  angle: string;
  thumb: string;
  image: string;
  thumbUrl: string;
  imageUrl: string;
  width: number;
  height: number;
};

export type Pose = {
  key: string;
  code: string;
  name: string;
  system: string;
  category: string;
  searchText: string;
  items: PoseItem[];
};

export type PoseFacet = { name: string; count: number };

export type PoseCatalog = {
  poses: Pose[];
  source: 'ai-pose-gallery-zh' | 'custom';
  sourceName: string;
  imageBase: string;
  importedAt: string;
};

export type PoseFilters = { keyword?: string; system?: string; category?: string; angle?: string };

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function joinUrl(base: string, path: string): string {
  if (!path) return '';
  if (/^(?:https?:|data:|blob:)/i.test(path)) return path;
  return `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function upstreamGroup(id: string): string {
  const index = id.lastIndexOf('_');
  return index > 0 ? id.slice(0, index) : id;
}

function parseUpstreamRow(value: unknown, imageBase: string): (Pose & { item: PoseItem }) | null {
  const row = record(value);
  if (!row) return null;
  const id = text(row.id);
  const name = text(row['姿势名称']);
  if (!id || !name) return null;
  const system = text(row['体系']) || '未分类';
  const category = text(row['分类']) || '未分类';
  const code = text(row['姿势编号']);
  const angle = text(row['角度']) || '正面';
  const thumb = text(row['缩略图']);
  const image = text(row['原图']);
  const item: PoseItem = {
    id,
    angle,
    thumb: joinUrl(imageBase, thumb),
    image: joinUrl(imageBase, image),
    thumbUrl: joinUrl(imageBase, thumb),
    imageUrl: joinUrl(imageBase, image),
    width: 0,
    height: 0,
  };
  return {
    key: upstreamGroup(id),
    code,
    name,
    system,
    category,
    searchText: [name, code, system, category, angle, text(row['检索'])].join(' ').toLowerCase(),
    items: [item],
    item,
  };
}

function mergePoseItems(poses: Pose[]): Pose[] {
  const grouped = new Map<string, Pose>();
  for (const pose of poses) {
    const existing = grouped.get(pose.key);
    if (!existing) {
      grouped.set(pose.key, pose);
      continue;
    }
    existing.items.push(...pose.items.filter((item) => !existing.items.some((current) => current.id === item.id)));
    existing.searchText = `${existing.searchText} ${pose.searchText}`;
  }
  return [...grouped.values()].map((pose) => ({
    ...pose,
    items: pose.items.slice().sort((a, b) => {
      const rank = (angle: string) => { const index = (POSE_LIBRARY_ANGLES as readonly string[]).indexOf(angle); return index < 0 ? POSE_LIBRARY_ANGLES.length : index; };
      return rank(a.angle) - rank(b.angle) || a.angle.localeCompare(b.angle, 'zh-CN');
    }),
  }));
}

/** 支持 ai-pose-gallery-zh 的 data/pose-zh.json 与同字段的通用数组。 */
export function parsePoseCatalog(value: unknown, imageBase = POSE_LIBRARY_IMAGE_BASE): PoseCatalog | null {
  const rows = Array.isArray(value)
    ? value
    : Array.isArray(record(value)?.poses)
      ? (record(value)?.poses as unknown[])
      : null;
  if (!rows?.length) return null;
  const poses = rows
    .map((row) => parseUpstreamRow(row, imageBase))
    .filter((entry): entry is Pose & { item: PoseItem } => Boolean(entry))
    .map(({ item: _item, ...pose }) => pose);
  if (!poses.length) return null;
  return {
    poses: mergePoseItems(poses),
    source: 'ai-pose-gallery-zh',
    sourceName: 'AI 姿势参考图库（ai-pose-gallery-zh）',
    imageBase,
    importedAt: new Date().toISOString(),
  };
}

/** 自建通用姿势包：source.baseUrl + items[{key,group,name,system,category,angle,thumb,image,code}]。 */
export function parsePosePack(value: unknown): PoseCatalog | null {
  const pack = record(value);
  if (!pack || pack.format !== 'yingce-pose-library' || !Array.isArray(pack.items)) return null;
  const source = record(pack.source) || {};
  const baseUrl = text(source.baseUrl) || POSE_LIBRARY_IMAGE_BASE;
  const poses: Pose[] = [];
  for (const raw of pack.items) {
    const item = record(raw);
    if (!item) continue;
    const key = text(item.group) || text(item.key) || uid();
    const angle = text(item.angle) || '正面';
    const thumb = text(item.thumb);
    const image = text(item.image);
    const name = text(item.name) || key;
    const system = text(item.system) || '未分类';
    const category = text(item.category) || '未分类';
    const poseItem: PoseItem = {
      id: text(item.key) || `${key}_${angle}`,
      angle,
      thumb: joinUrl(baseUrl, thumb),
      image: joinUrl(baseUrl, image),
      thumbUrl: joinUrl(baseUrl, thumb),
      imageUrl: joinUrl(baseUrl, image),
      width: 0,
      height: 0,
    };
    poses.push({
      key,
      code: text(item.code),
      name,
      system,
      category,
      searchText: [name, text(item.code), system, category, angle, ...(Array.isArray(item.keywords) ? item.keywords.map(text) : [])].join(' ').toLowerCase(),
      items: [poseItem],
    });
  }
  if (!poses.length) return null;
  return {
    poses: mergePoseItems(poses),
    source: 'custom',
    sourceName: text(source.name) || '自定义姿势包',
    imageBase: baseUrl,
    importedAt: new Date().toISOString(),
  };
}

function matchesKeyword(pose: Pose, keyword: string) {
  if (!keyword) return true;
  return pose.searchText.includes(keyword.toLowerCase());
}

export function filterPoses(poses: Pose[], filters: PoseFilters): Pose[] {
  const keyword = text(filters.keyword);
  const system = text(filters.system);
  const category = text(filters.category);
  const angle = text(filters.angle);
  return poses.filter((pose) => {
    if (!matchesKeyword(pose, keyword)) return false;
    if (system && pose.system !== system) return false;
    if (category && pose.category !== category) return false;
    if (angle && !pose.items.some((item) => item.angle === angle)) return false;
    return true;
  });
}

/** 体系计数不受体系筛选影响；分类随体系收窄，视角随体系与分类收窄。 */
export function poseFacets(poses: Pose[], filters: PoseFilters) {
  const systems = new Map<string, number>();
  const categories = new Map<string, number>();
  const angles = new Map<string, number>();
  for (const pose of poses) {
    systems.set(pose.system, (systems.get(pose.system) || 0) + 1);
  }
  const scoped = poses.filter((pose) => !filters.system || pose.system === filters.system);
  for (const pose of scoped) categories.set(pose.category, (categories.get(pose.category) || 0) + 1);
  const scopedAngles = scoped.filter((pose) => !filters.category || pose.category === filters.category);
  for (const pose of scopedAngles) {
    const seen = new Set<string>();
    for (const item of pose.items) {
      if (seen.has(item.angle)) continue;
      seen.add(item.angle);
      angles.set(item.angle, (angles.get(item.angle) || 0) + 1);
    }
  }
  const toFacets = (map: Map<string, number>): PoseFacet[] => [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  const angleRank = new Map<string, number>(POSE_LIBRARY_ANGLES.map((name, index) => [name, index]));
  const sortedAngles = toFacets(angles).sort((a, b) => (
    (angleRank.get(a.name) ?? 99) - (angleRank.get(b.name) ?? 99)
  ));
  return { systems: toFacets(systems), categories: toFacets(categories), angles: sortedAngles };
}

export function defaultPoseAngle(pose: Pose, preferred?: string): PoseItem | undefined {
  return (preferred ? pose.items.find((item) => item.angle === preferred) : undefined) || pose.items[0];
}

export function poseInsertTitle(pose: Pose, item: PoseItem): string {
  return `姿势参考·${pose.name}·${item.angle}`;
}

export function poseCatalogStats(catalog: PoseCatalog) {
  const systems = new Set(catalog.poses.map((pose) => pose.system));
  const items = catalog.poses.reduce((sum, pose) => sum + pose.items.length, 0);
  return { poses: catalog.poses.length, items, systems: systems.size };
}
