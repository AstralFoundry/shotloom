import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRendererEnv } from './helpers/rendererSsr.mjs';

const env = await createRendererEnv();
after(() => env.dispose());

const rows = [
  { id: 'full_single_P001_front', 体系: '全身单人・标准系', 姿势编号: 'P001', 分类: '站姿', 姿势名称: '对立式平衡', 角度: '正面', 缩略图: 'thumbs/a_front.jpg', 原图: 'img/a_front.png', 检索: '站立 平衡' },
  { id: 'full_single_P001_side', 体系: '全身单人・标准系', 姿势编号: 'P001', 分类: '站姿', 姿势名称: '对立式平衡', 角度: '侧面', 缩略图: 'thumbs/a_side.jpg', 原图: 'img/a_side.png' },
  { id: 'upper_single_P002_front', 体系: '上半身单人・可爱系', 姿势编号: 'P002', 分类: '坐姿', 姿势名称: '双手托腮', 角度: '正面', 缩略图: 'thumbs/b.jpg', 原图: 'img/b.png' },
];

test('姿势目录按姿势编号分组，并保留多视角与远程地址', async () => {
  const { parsePoseCatalog } = await env.load('domain/pose/PoseLibrary');
  const catalog = parsePoseCatalog(rows);
  assert.ok(catalog);
  assert.equal(catalog.poses.length, 2);
  assert.equal(catalog.source, 'ai-pose-gallery-zh');
  const first = catalog.poses.find((pose) => pose.code === 'P001');
  assert.deepEqual(first.items.map((item) => item.angle).sort(), ['侧面', '正面'].sort());
  const front = first.items.find((item) => item.angle === '正面');
  assert.match(front.thumbUrl, /^https:\/\/raw\.githubusercontent\.com\/anhao\/ai-pose-gallery-zh\/main\/thumbs\/a_front\.jpg$/);
  assert.equal(front.imageUrl, 'https://raw.githubusercontent.com/anhao/ai-pose-gallery-zh/main/img/a_front.png');
});

test('姿势筛选支持关键词、体系、分类、视角，分面计数按依赖收窄', async () => {
  const { parsePoseCatalog, filterPoses, poseFacets } = await env.load('domain/pose/PoseLibrary');
  const catalog = parsePoseCatalog(rows);
  const all = catalog.poses;
  assert.equal(filterPoses(all, { keyword: '平衡' }).length, 1);
  assert.equal(filterPoses(all, { keyword: 'p002' }).length, 1);
  assert.equal(filterPoses(all, { system: '全身单人・标准系' }).length, 1);
  assert.equal(filterPoses(all, { category: '坐姿' }).length, 1);
  assert.equal(filterPoses(all, { angle: '侧面' }).length, 1);
  const facets = poseFacets(all, { system: '全身单人・标准系' });
  assert.deepEqual(facets.systems.map((facet) => facet.name).sort(), ['上半身单人・可爱系', '全身单人・标准系']);
  assert.deepEqual(facets.categories, [{ name: '站姿', count: 1 }]);
  assert.deepEqual(facets.angles.map((facet) => facet.name).sort(), ['侧面', '正面']);
});

test('通用姿势包支持自建 baseUrl、关键词与视角合并', async () => {
  const { parsePosePack } = await env.load('domain/pose/PoseLibrary');
  const catalog = parsePosePack({
    format: 'yingce-pose-library', version: 1,
    source: { key: 'demo', name: '演示姿势包', baseUrl: 'https://example.com/poses' },
    items: [
      { key: 'k1', group: 'g1', code: 'C1', system: '自建', category: '动作', name: '起跳', angle: '正面', thumb: 'thumbs/1.jpg', image: 'img/1.png', keywords: ['跳跃'] },
      { key: 'k2', group: 'g1', code: 'C1', system: '自建', category: '动作', name: '起跳', angle: '侧面', thumb: 'thumbs/2.jpg', image: 'img/2.png' },
    ],
  });
  assert.ok(catalog);
  assert.equal(catalog.source, 'custom');
  assert.equal(catalog.sourceName, '演示姿势包');
  assert.equal(catalog.poses.length, 1);
  assert.equal(catalog.poses[0].items.length, 2);
  assert.match(catalog.poses[0].searchText, /跳跃/);
  assert.equal(catalog.poses[0].items.find((item) => item.angle === '正面').thumbUrl, 'https://example.com/poses/thumbs/1.jpg');
});

test('插入标题与目录统计可复现', async () => {
  const { parsePoseCatalog, poseInsertTitle, poseCatalogStats, defaultPoseAngle } = await env.load('domain/pose/PoseLibrary');
  const catalog = parsePoseCatalog(rows);
  const pose = catalog.poses.find((item) => item.code === 'P001');
  const item = defaultPoseAngle(pose, '侧面');
  assert.equal(poseInsertTitle(pose, item), '姿势参考·对立式平衡·侧面');
  assert.deepEqual(poseCatalogStats(catalog), { poses: 2, items: 3, systems: 2 });
});
