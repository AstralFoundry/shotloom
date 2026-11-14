import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 空间检查的纯函数部分。
 *
 * 这些检查存在的理由都是"渲染帧看不出来"：机位埋在墙里时，画面只是一整片墙面，
 * 人会以为预览坏了而不是机位错了。仓库里真实发生过两次：仓库跟拍时相机一路卡在墙里，
 * 而 spatial_check 的采样报告一条没提，因为相机从不进包围盒列表。
 */

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = join(root, 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'director-spatial-test-'));
const output = join(temporary, 'entry.mjs');
let spatial;
try {
  const bundle = await build({
    stdin: {
      contents: `export {
  checkSample, checkCameraInSolid, checkOcclusion, checkUnsupported, toSpatialBox, isInFrame,
} from './vendor/shotloom-director-desk/src/core/spatial/checks.ts';
export { makeProp } from './vendor/shotloom-director-desk/src/core/assets/props.ts';
export { ASSETS } from './vendor/shotloom-director-desk/src/core/asset-catalog.ts';
export { entity } from './vendor/shotloom-director-desk/src/core/model.ts';`,
      resolveDir: root,
      sourcefile: 'director-spatial-test-entry.ts',
    },
    alias: { '@': join(root, 'vendor', 'shotloom-director-desk', 'src') },
    loader: { '.css': 'empty', '.svg': 'dataurl', '.png': 'dataurl' },
    bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, outfile: output,
  });
  writeFileSync(output, bundle.outputFiles[0].contents);
  spatial = await import(new URL(`file://${output}`).href);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const box = (id, kind, min, max, occluder = kind === 'prop') =>
  spatial.toSpatialBox(id, id, kind, {
    min: { x: min[0], y: min[1], z: min[2] },
    max: { x: max[0], y: max[1], z: max[2] },
  }, occluder);

const wall = (id, min, max) => box(id, 'prop', min, max, true);
const person = (id, center, size = 0.5) => box(
  id, 'actor',
  [center[0] - size, 0, center[2] - size],
  [center[0] + size, 1.75, center[2] + size],
  false,
);

/** 朝 -Z 看的相机；projection 与 view 都取自真实矩阵，避免手写近似。 */
function camera(addon) {
  const projectionMatrix = { elements: [1.3, 0, 0, 0, 0, 2.3, 0, 0, 0, 0, -1.002, -1, 0, 0, -0.06, 0] };
  const matrixWorldInverse = { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  return { projectionMatrix, matrixWorldInverse, ...addon };
}

test('机位落在墙体内部时报错，站在墙外不报', () => {
  const walls = [wall('w1', [-2, 0, 2], [2, 3, 2.3])];
  assert.deepEqual(spatial.checkCameraInSolid([0, 1.6, 0], walls, 1), []);
  const inside = spatial.checkCameraInSolid([0, 1.6, 2.15], walls, 1.25);
  assert.equal(inside.length, 1);
  assert.equal(inside[0].kind, 'cameraInSolid');
  assert.equal(inside[0].severity, 'error');
  assert.deepEqual(inside[0].ids, ['w1']);
  assert.equal(inside[0].time, 1.25);
});

test('机位贴在墙面外侧仍然安全，只有真的进入包围盒才算卡墙', () => {
  const walls = [wall('w1', [-2, 0, 2], [2, 3, 2.3])];
  // 相机位置在 z=1.99，比包围盒起点 2 早 1 厘米：还没进去。
  assert.deepEqual(spatial.checkCameraInSolid([0, 1.6, 1.99], walls, 0), []);
});

test('主体被墙体挡住时报 occluded，并指出挡它的那个物体', () => {
  const walls = [wall('w1', [-2, 0, 1], [2, 3, 1.2])];
  const boxes = [...walls, person('a1', [0, 0, 0])];
  // 相机在 z=3，主体在 z=0，中间隔着一堵 z≈1.1 的墙。
  const issues = spatial.checkOcclusion([0, 1.6, 3], boxes, ['a1'], 2);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].kind, 'occluded');
  assert.deepEqual(issues[0].ids, ['a1', 'w1']);
});

test('墙体在主体之后时不算遮挡', () => {
  const walls = [wall('w1', [-2, 0, -3], [2, 3, -2.8])];
  const boxes = [...walls, person('a1', [0, 0, 0])];
  assert.deepEqual(spatial.checkOcclusion([0, 1.6, 3], boxes, ['a1'], 0), []);
});

test('没有指定主体时不报遮挡，避免把每个候场演员都算一遍', () => {
  const walls = [wall('w1', [-2, 0, 1], [2, 3, 1.2])];
  const boxes = [...walls, person('a1', [0, 0, 0])];
  // requiredIds 为空数组时按"所有人物"处理；传 undefined 时同样全查。
  assert.equal(spatial.checkOcclusion([0, 1.6, 3], boxes, undefined, 0).length, 1);
  assert.equal(spatial.checkOcclusion([0, 1.6, 3], boxes, ['other'], 0).length, 0);
});

test('checkSample 一次返回卡墙、遮挡与相交，供采样循环直接收集', () => {
  const walls = [wall('w1', [-2, 0, 1], [2, 3, 1.2])];
  const boxes = [...walls, person('a1', [0, 0, 0])];
  const issues = spatial.checkSample(
    { boxes, camera: camera({}), cameraPosition: [0, 1.6, 1.1], requiredIds: ['a1'] },
    3,
  );
  const kinds = issues.map((issue) => issue.kind);
  assert.ok(kinds.includes('cameraInSolid'), '机位在墙里必须报出来');
  // 相机埋在墙里时，从机位到主体的射线一开始就在实体内，不应再重复报一次遮挡。
  assert.equal(kinds.filter((kind) => kind === 'occluded').length, 0);
});

test('requiredIds 收窄出画检查，只剩指定主体参与', () => {
  // 相机在原点朝 -Z：z 为正的主体在身后必然出画。
  const behind = person('behind', [0, 0, 5]);
  const front = person('front', [0, 0, -5]);
  const required = spatial.checkSample(
    { boxes: [behind, front], camera: camera({}), requiredIds: ['front'] },
    0,
  );
  assert.deepEqual(required.filter((issue) => issue.kind === 'outOfFrame'), []);
  const all = spatial.checkSample({ boxes: [behind, front], camera: camera({}) }, 0);
  assert.deepEqual(all.filter((issue) => issue.kind === 'outOfFrame').map((issue) => issue.ids[0]), ['behind']);
});

test('整组墙一起悬空时全部报出，不因为彼此相接就算有支撑', () => {
  // 真实情形：墙按"原点在中心"放在半个墙高处，几面墙彼此相接，却没有一面落地。
  const boxes = [
    wall('仓储左墙', [0, 1.7, -2.9], [6.5, 5.1, -2.7]),
    wall('仓储后墙', [6.4, 1.7, -2.9], [6.6, 5.1, 2.9]),
    person('主角', [3, 0, 0]),
  ];
  const issues = spatial.checkUnsupported(boxes, null, 0);
  assert.deepEqual(issues.map((issue) => issue.ids[0]).sort(), ['仓储后墙', '仓储左墙']);
  assert.ok(issues.every((issue) => issue.kind === 'unsupported' && issue.severity === 'warning'));
  assert.match(issues.find((issue) => issue.ids[0] === '仓储左墙').message, /底面离地 1\.70 米/);
});

test('架在落地墙体之间的过梁、桌上的台灯、头上的帽子都算有支撑', () => {
  const boxes = [
    wall('门洞左墙', [-2, 0, -0.1], [-0.6, 3.6, 0.1]),
    wall('门洞右墙', [0.6, 0, -0.1], [2, 3.6, 0.1]),
    wall('过梁', [-0.6, 2.5, -0.1], [0.6, 3.6, 0.1]),
    box('餐桌', 'prop', [3, 0, -0.45], [4.8, 0.75, 0.45]),
    box('台灯', 'prop', [3.8, 0.75, -0.1], [4, 1.1, 0.1]),
    person('主角', [6, 0, 0], 0.3),
    box('帽子', 'prop', [5.85, 1.75, -0.15], [6.15, 1.95, 0.15]),
  ];
  assert.deepEqual(spatial.checkUnsupported(boxes, null, 0), []);
});

test('悬空检查只报告指定的物体，其他悬空物体不进本次回执', () => {
  const boxes = [wall('新墙', [0, 1.5, 0], [4, 4.5, 0.2]), wall('旧招牌', [8, 3, 0], [9, 3.5, 0.1])];
  assert.deepEqual(spatial.checkUnsupported(boxes, new Set(['新墙']), 0).map((issue) => issue.ids[0]), ['新墙']);
});

test('目录里每个道具按默认参数放在 y=0 都落地：告诉模型的原点约定是真话', async () => {
  // catalog.assetConventions 告诉模型"原点在底面中心、y=0 落地"。约定一旦对某个素材不成立，
  // 模型照做就会把它摆到半空（旧版沙发曾悬空 9 厘米），悬空检查也会误报。这里真实构建每个道具来守住它。
  const THREE = await import('three');
  const floating = [];
  const buried = [];
  for (const asset of spatial.ASSETS) {
    if (asset.kind !== 'prop' || asset.libraryRetired) continue;
    const e = spatial.entity('prop', asset.id, asset.name);
    if (e.light) continue;
    const object = spatial.makeProp(e);
    object.updateWorldMatrix(true, true);
    const bounds = new THREE.Box3().setFromObject(object);
    if (bounds.min.y > 0.005) floating.push(`${asset.id}: ${bounds.min.y.toFixed(3)}`);
    if (bounds.min.y < -0.005) buried.push(asset.id);
  }
  assert.deepEqual(floating, [], `这些素材放在 y=0 时悬空：${floating.join(', ')}`);
  // 下沉是有意的：地面、道路、房间构件的上表面在 y=0；石头和桥有一部分埋在地下。新增此类素材请同步 assetConventions。
  const expectedBuried = (id) => ['ground', 'room-part', 'rock', 'road'].includes(id) || id.startsWith('road-');
  assert.deepEqual(buried.filter((id) => !expectedBuried(id)), []);
});

test('显式空主体跳过遮挡和出画，但仍检查机位卡墙', () => {
  const boxes = [wall('w1', [-2, 0, 1], [2, 3, 1.2]), person('a1', [0, 0, 0])];
  assert.deepEqual(spatial.checkOcclusion([0, 1.6, 3], boxes, [], 0), []);
  const issues = spatial.checkSample({ boxes, camera: camera({}), cameraPosition: [0, 1.6, 1.1], requiredIds: [] }, 0);
  assert.ok(issues.some(i => i.kind === 'cameraInSolid'));
  assert.ok(!issues.some(i => ['outOfFrame', 'occluded'].includes(i.kind)));
});
