import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const cache = join(root, 'node_modules', '.cache');
mkdirSync(cache, { recursive: true });
const temporary = mkdtempSync(join(cache, 'director-batch-test-'));
const output = join(temporary, 'entry.mjs');
let domain;
try {
  const bundle = await build({
    stdin: {
      contents: `export { applyBatchEdits } from './vendor/shotloom-director-desk/src/state/batch-edits.ts';
export { createStarterProject } from './vendor/shotloom-director-desk/src/state/starter-project.ts';
export { directorContext } from './vendor/shotloom-director-desk/src/core/director-context.ts';
export { pathPosition } from './vendor/shotloom-director-desk/src/core/timeline.ts';
export { assertProject } from './vendor/shotloom-director-desk/src/core/model.ts';
export { surfaceDropPosition } from './vendor/shotloom-director-desk/src/core/editor/object-snapping.ts';
export { BoxGeometry, Mesh, MeshBasicMaterial } from 'three';`,
      resolveDir: root,
      sourcefile: 'director-batch-test-entry.ts',
    },
    alias: { '@': join(root, 'vendor', 'shotloom-director-desk', 'src') },
    bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, outfile: output,
  });
  writeFileSync(output, bundle.outputFiles[0].contents);
  domain = await import(new URL(`file://${output}`).href);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}

const starter = () => domain.createStarterProject();
const actorOf = (project) => project.entities.find(entity => entity.kind === 'actor');

test('导演台批量设置可移除默认待机、添加动作并调整角色，结果仍是合法工程', () => {
  const project = starter();
  const actor = actorOf(project);
  const oldClipId = actor.clips[0].id;
  const receipts = domain.applyBatchEdits(project, [
    { operation: 'remove_clip', entityId: actor.id, clipId: oldClipId },
    { operation: 'add_action', entityId: actor.id, action: 'walk', atSec: 0 },
    { operation: 'set_entity', entityId: actor.id, patch: { position: [2, 0, 1], rotationDegrees: [0, 90, 0] } },
  ]);
  domain.assertProject(project);
  assert.equal(receipts.length, 3);
  assert.equal(receipts[1].clipId, actor.clips[0].id);
  assert.equal(actor.clips[0].start, 0);
  assert.deepEqual(actor.position, [2, 0, 1]);
  assert.ok(Math.abs(actor.rotation[1] - Math.PI / 2) < 1e-9);
});

test('导演台批量设置超过八项仍可执行，并指出具体失败项', () => {
  const project = starter();
  assert.equal(domain.applyBatchEdits(project, Array.from({ length: 9 }, (_, index) => ({ operation: 'set_room', patch: { width: 8 + index } }))).length, 9);
  domain.assertProject(project);
  const actor = actorOf(project);
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'set_room', patch: { width: 9 } },
    { operation: 'set_entity', entityId: actor.id, patch: { unknown: 1 } },
  ]), /第 2 项 set_entity 失败：不支持字段 unknown/);
});

test('声明式路径按给定时间点写入，并把首点作为基座位置', () => {
  const project = starter();
  const actor = actorOf(project);
  domain.applyBatchEdits(project, [{
    operation: 'set_path',
    entityId: actor.id,
    points: [
      { position: [-4, 0, 1], timeSec: 0 },
      { position: [0, 0, 0.2], timeSec: 3 },
      { position: [6, 0, 0], timeSec: 9.5 },
    ],
  }]);
  domain.assertProject(project);
  assert.equal(actor.path.points.length, 3);
  assert.deepEqual(actor.path.points.map(point => point.time), [0, 3, 9.5]);
  assert.deepEqual(actor.position, [-4, 0, 1]);
  assert.deepEqual(actor.path.points.at(-1).position, [6, 0, 0]);
  assert.ok(project.duration >= 9.5);
});

test('声明式路径拒绝非递增时间点并指出第几个点', () => {
  const project = starter();
  const actor = actorOf(project);
  assert.throws(() => domain.applyBatchEdits(project, [{
    operation: 'set_path',
    entityId: actor.id,
    points: [{ position: [0, 0, 0], timeSec: 2 }, { position: [1, 0, 0], timeSec: 2 }],
  }]), /第 2 个点/);
  assert.throws(() => domain.applyBatchEdits(project, [{
    operation: 'set_path',
    entityId: actor.id,
    points: [{ position: [0, 0, 0], timeSec: 0 }],
  }]), /至少需要 2 个关键时点/);
});

test('批量新增实体、机位与切镜在未读取快照的情况下也可一次完成', () => {
  const project = starter();
  const before = project.entities.length;
  const receipts = domain.applyBatchEdits(project, [
    { operation: 'add_asset', assetId: 'structure-wall', position: [3, 0, -2] },
    { operation: 'add_asset', assetId: 'person', name: '主角', position: [0, 0, 0] },
    { operation: 'add_camera', name: '跟拍机位', position: [0, 1.6, -2] },
  ]);
  domain.assertProject(project);
  assert.equal(project.entities.length, before + 3);
  assert.ok(receipts.every(receipt => typeof receipt.entityId === 'string'));
  const wall = project.entities.find(entity => entity.id === receipts[0].entityId);
  assert.deepEqual(wall.position, [3, 0, -2]);
  // 素材原点在底面中心：y=0 就是落地高度，不能按中心原点再抬半截。
  assert.equal(wall.position[1], 0);
  assert.equal(wall.kind, 'prop');
  const camera = project.entities.find(entity => entity.id === receipts[2].entityId);
  assert.equal(camera.kind, 'camera');

  const [cut] = domain.applyBatchEdits(project, [{ operation: 'add_cut', timeSec: 2, cameraId: camera.id }]);
  domain.assertProject(project);
  assert.equal(cut.cameraId, camera.id);
  assert.ok(project.cuts.some(item => item.time === 2 && item.cameraId === camera.id));
});

test('删除实体清掉指向它的引用，复制实体生成新 ID', () => {
  const project = starter();
  const actor = actorOf(project);
  const [, copy] = domain.applyBatchEdits(project, [
    { operation: 'duplicate_entity', entityId: actor.id },
    { operation: 'duplicate_entity', entityId: actor.id },
  ]);
  domain.assertProject(project);
  assert.notEqual(copy.entityId, actor.id);
  assert.equal(project.entities.filter(entity => entity.name.startsWith(actor.name)).length >= 3, true);

  const removed = domain.applyBatchEdits(project, [{ operation: 'delete_entity', entityId: copy.entityId }]);
  domain.assertProject(project);
  assert.equal(removed[0].entityId, copy.entityId);
  assert.equal(project.entities.some(entity => entity.id === copy.entityId), false);
});

test('批量新增实体拒绝未知素材，并提示取自 catalog', () => {
  const project = starter();
  assert.throws(() => domain.applyBatchEdits(project, [{ operation: 'add_asset', assetId: 'no-such-asset' }]),
    /素材不存在：no-such-asset；取自 catalog\.assets\[\]\.id/);
});

test('批量添加灯具时，显式给出的位置与朝向原样生效，不再额外抬高', () => {
  // 真实缺陷：编辑器为"丢在地上"的新灯默认抬高 3 米、下倾 45 度；批量路径把这一步放在
  // 应用调用方坐标之后，结果放在 3.2 米的灯跑到了 6.2 米。
  const project = starter();
  const [placed, fallback] = domain.applyBatchEdits(project, [
    { operation: 'add_asset', assetId: 'light-spot', position: [1, 3.2, -2], rotationDegrees: [-60, 0, 0] },
    { operation: 'add_asset', assetId: 'light-point' },
  ]);
  domain.assertProject(project);
  const spot = project.entities.find(entity => entity.id === placed.entityId);
  assert.deepEqual(spot.position, [1, 3.2, -2]);
  assert.ok(Math.abs(spot.rotation[0] - (-60 * Math.PI / 180)) < 1e-9);
  // 没给坐标时仍沿用编辑器的默认：抬到 3 米、下倾 45 度。
  const point = project.entities.find(entity => entity.id === fallback.entityId);
  assert.equal(point.position[1], 3);
  assert.ok(Math.abs(point.rotation[0] + Math.PI / 4) < 1e-9);
});

/** The wall's width runs along its local +x; after the yaw that axis must point along the segment. */
const wallDirection = (wall) => [Math.cos(wall.rotation[1]), -Math.sin(wall.rotation[1])];

test('add_wall 按俯视线段建墙：中点、朝向与真实长度都由线段算出', () => {
  // 真实缺陷：模型每面墙都要手算中心、角度和 scale（长度 ÷ 4），一次布局几十面墙，
  // 算错一处就整片推倒重来。按线段建墙后这些都由导演台计算。
  const project = starter();
  const [alongX, alongZ, diagonal] = domain.applyBatchEdits(project, [
    { operation: 'add_wall', from: [0, 0], to: [4, 0], name: '北墙' },
    { operation: 'add_wall', from: [1, 1], to: [1, 5] },
    { operation: 'add_wall', from: [0, 0], to: [3, 4], height: 3.4, thickness: 0.2 },
  ]);
  domain.assertProject(project);
  const byId = (receipt) => project.entities.find((entity) => entity.id === receipt.entityId);

  const north = byId(alongX);
  assert.equal(north.asset, 'structure-wall');
  assert.equal(north.name, '北墙');
  assert.deepEqual(north.position, [2, 0, 0]);
  assert.equal(north.assetParameters.width, 4);

  const east = byId(alongZ);
  assert.deepEqual(east.position, [1, 0, 3]);
  const [ex, ez] = wallDirection(east);
  assert.ok(Math.abs(ex) < 1e-9 && Math.abs(Math.abs(ez) - 1) < 1e-9, '沿 z 的墙，局部 +x 必须转到 z 轴上');

  const slanted = byId(diagonal);
  assert.deepEqual(slanted.position, [1.5, 0, 2]);
  const [dx, dz] = wallDirection(slanted);
  assert.ok(Math.abs(dx - 0.6) < 1e-9 && Math.abs(dz - 0.8) < 1e-9, '斜墙的局部 +x 必须正好指向线段方向');
  assert.equal(slanted.assetParameters.width, 5);
  assert.equal(slanted.assetParameters.height, 3.4);
  assert.equal(slanted.assetParameters.depth, 0.2);
  assert.deepEqual(slanted.scale, [1, 1, 1], '尺寸写在参数里，scale 保持 1，门洞和墙厚不会被拉伸');
});

test('add_wall 的居中门洞写进墙体参数，放不下时说明原因', () => {
  const project = starter();
  const [door] = domain.applyBatchEdits(project, [
    { operation: 'add_wall', from: [0, 2], to: [3, 2], height: 3, opening: { width: 1.1, height: 2.2 } },
  ]);
  domain.assertProject(project);
  const wall = project.entities.find((entity) => entity.id === door.entityId);
  assert.equal(wall.assetParameters.openingWidth, 1.1);
  assert.equal(wall.assetParameters.openingHeight, 2.2);
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'add_wall', from: [0, 0], to: [1, 0], opening: { width: 1.5 } },
  ]), /第 1 项 add_wall 失败：.*洞口必须容纳在墙体宽高以内/);
  assert.throws(() => domain.applyBatchEdits(project, [{ operation: 'add_wall', from: [2, 2], to: [2, 2.01] }]),
    /墙体线段太短/);
});

test('素材参数按真实尺寸设置，参数名或范围不对时给出可用参数与范围', () => {
  const project = starter();
  const [counter] = domain.applyBatchEdits(project, [
    { operation: 'add_asset', assetId: 'furniture-counter', position: [2, 0, 1], parameters: { width: 3 }, scale: [1, 1, 1] },
  ]);
  const created = project.entities.find((entity) => entity.id === counter.entityId);
  assert.equal(created.assetParameters.width, 3);
  domain.applyBatchEdits(project, [{ operation: 'set_entity', entityId: created.id, patch: { parameters: { height: 1.1 } } }]);
  domain.assertProject(project);
  assert.deepEqual([created.assetParameters.width, created.assetParameters.height], [3, 1.1]);

  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'set_entity', entityId: created.id, patch: { parameters: { length: 2 } } },
  ]), /不支持参数 length；可用参数：.*width/);
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'set_entity', entityId: created.id, patch: { parameters: { width: 500 } } },
  ]), /parameters\.width 需在 .* 之间/);
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'add_asset', assetId: 'cube', scale: [1, 0, 1] },
  ]), /scale 的三个分量都必须大于 0/);
});

test('复制带路径的人物并指定位置时，整条路径随之平移', () => {
  const project = starter();
  const actor = actorOf(project);
  domain.applyBatchEdits(project, [{
    operation: 'set_path', entityId: actor.id,
    points: [{ position: [0, 0, 0], timeSec: 0 }, { position: [2, 0, 0], timeSec: 4 }],
  }]);
  const [copy] = domain.applyBatchEdits(project, [
    { operation: 'duplicate_entity', entityId: actor.id, position: [0, 0, 3], name: '路人' },
  ]);
  domain.assertProject(project);
  const twin = project.entities.find((entity) => entity.id === copy.entityId);
  assert.equal(twin.name, '路人');
  assert.deepEqual(twin.position, [0, 0, 3]);
  assert.deepEqual(twin.path.points.map((point) => point.position), [[0, 0, 3], [2, 0, 3]]);
  assert.deepEqual(actor.path.points.map((point) => point.position), [[0, 0, 0], [2, 0, 0]], '原型的路径不能被改动');
});

test('同一批里用 $N 引用前面新建的 id：加墙、开门、再挂灯一次完成', () => {
  // 真实痛点：id 在批内才生成，模型当时说"set_entity requires entityId which is returned by
  // add_asset, but within a batch I don't know the ID in advance"，只能拆成两批往返。
  const project = starter();
  const receipts = domain.applyBatchEdits(project, [
    { operation: 'add_wall', from: [0, 0], to: [6, 0], height: 3, opening: { width: 1.2 }, name: '南墙' },
    { operation: 'add_asset', assetId: 'light-spot', position: [1, 2.6, 0.4] },
    { operation: 'set_entity', entityId: '$1', patch: { parameters: { height: 3.4 } } },
    { operation: 'set_entity', entityId: '$2', patch: { name: '门口顶灯' } },
    { operation: 'add_camera', name: '跟拍', position: [0, 1.6, -2] },
    { operation: 'add_cut', timeSec: 1, cameraId: '$5' },
  ]);
  domain.assertProject(project);
  const wall = project.entities.find((entity) => entity.id === receipts[0].entityId);
  assert.equal(wall.assetParameters.height, 3.4, '$1 必须指到第 1 项建的墙');
  assert.equal(wall.assetParameters.openingWidth, 1.2, '先前设置的洞口不能被覆盖');
  const light = project.entities.find((entity) => entity.id === receipts[1].entityId);
  assert.equal(light.name, '门口顶灯', '$2 必须指到第 2 项建的灯');
  const cameraId = receipts[4].entityId;
  assert.equal(cameraId, receipts[5].cameraId, '$5 必须指到第 5 项建的机位');
  assert.ok(project.cuts.some((cut) => cut.cameraId === cameraId && cut.time === 1));
});

test('$N 只能指向本批前面的项，指向未来或不存在时说明原因', () => {
  const project = starter();
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'set_entity', entityId: '$2', patch: { name: 'x' } },
    { operation: 'add_asset', assetId: 'cube' },
  ]), /第 1 项 set_entity 失败：entityId 引用的 \$2 不存在/);
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'set_entity', entityId: '$9', patch: { name: 'x' } },
  ]), /\$N 只能指向本批前面某一项新建的 id/);
});

test('add_room 一次建好四面墙，墙角按半个墙厚避让，门窗挂在指定侧', () => {
  // 布局表里"入口间 x −5.5…−2.5, z 11…15"原本要展开成六面墙再算长度和中心，
  // 那正是布局会话反复返工的算术来源。一条 add_room 应当顶掉这些计算。
  const project = starter();
  const [room] = domain.applyBatchEdits(project, [{
    operation: 'add_room', name: '入口间',
    minX: -5.5, maxX: -2.5, minZ: 11, maxZ: 15,
    height: 3, thickness: 0.2,
    openings: [{ side: 'south', width: 1.1 }, { side: 'north', width: 0.9, offset: 0.5 }],
  }]);
  domain.assertProject(project);
  assert.equal(room.entities.length, 4, '四面墙都要有 id');
  const walls = room.entities.map(id => project.entities.find(entity => entity.id === id));
  assert.deepEqual(walls.map(wall => wall.name), ['入口间-南墙', '入口间-北墙', '入口间-西墙', '入口间-东墙']);

  const south = walls[0], north = walls[1], west = walls[2], east = walls[3];
  // 南北墙沿 x 铺满，两端各让出半个墙厚给东西墙；东西墙沿 z 同理。
  assert.equal(south.assetParameters.width, 3);
  assert.equal(west.assetParameters.width, 3.8);
  assert.deepEqual(south.position, [-4, 0, 15]);
  assert.deepEqual(west.position, [-5.5, 0, 13]);
  // 南墙从 minX 走向 maxX：局部 +x 指向世界 +x，偏航角为 0。
  assert.ok(Math.abs(south.rotation[1]) < 1e-9, '南墙沿 x 方向');
  assert.ok(Math.abs(Math.abs(west.rotation[1]) - Math.PI / 2) < 1e-9, '西墙沿 z 方向');

  assert.equal(south.assetParameters.openingWidth, 1.1);
  assert.equal(south.assetParameters.openingOffset, 0, '没写 offset 就是居中');
  assert.equal(north.assetParameters.openingWidth, 0.9);
  assert.equal(north.assetParameters.openingOffset, 0.5);
  assert.equal(west.assetParameters.openingWidth, undefined, '没开洞的墙不该有洞口参数');
  assert.equal(east.assetParameters.openingWidth, undefined);
  assert.equal(south.assetParameters.height, 3);
  assert.equal(south.assetParameters.depth, 0.2);
});

test('add_room 可同时铺地板，并拒绝放不下的门窗', () => {
  const project = starter();
  const [room] = domain.applyBatchEdits(project, [{
    operation: 'add_room', name: '库房', minX: 0, maxX: 4, minZ: 0, maxZ: 3, floor: true,
  }]);
  domain.assertProject(project);
  assert.equal(room.entities.length, 5, '四面墙 + 一块楼板');
  const floor = project.entities.find(entity => entity.id === room.entities[4]);
  assert.equal(floor.asset, 'structure-slab');
  assert.deepEqual(floor.position, [2, 0, 1.5]);

  assert.throws(() => domain.applyBatchEdits(project, [{
    operation: 'add_room', minX: 0, maxX: 3, minZ: 0, maxZ: 3,
    openings: [{ side: 'south', width: 3.5 }],
  }]), /width 需在 0 与墙面长度 3\.00 米之间/);
  assert.throws(() => domain.applyBatchEdits(project, [{
    operation: 'add_room', minX: 0, maxX: 3, minZ: 0, maxZ: 3,
    openings: [{ side: 'south', width: 1, offset: 1.5 }],
  }]), /offset 超出墙面范围/);
  assert.throws(() => domain.applyBatchEdits(project, [{
    operation: 'add_room', minX: 0, maxX: 3, minZ: 0, maxZ: 3,
    openings: [{ side: 'south', width: 1 }, { side: 'south', width: 1 }],
  }]), /同一面墙只能开一个洞/);
  assert.throws(() => domain.applyBatchEdits(project, [{
    operation: 'add_room', minX: 0, maxX: 3, minZ: 0, maxZ: 3,
    openings: [{ side: 'up', width: 1 }],
  }]), /side 只能是 west \/ east \/ north \/ south/);
});

test('墙洞可以偏离墙段中心建墙，偏移量超出墙体时说明原因', () => {
  const project = starter();
  const [door] = domain.applyBatchEdits(project, [
    { operation: 'add_wall', from: [0, 0], to: [4, 0], opening: { width: 1, offset: 1.2 } },
  ]);
  domain.assertProject(project);
  const wall = project.entities.find(entity => entity.id === door.entityId);
  assert.equal(wall.assetParameters.openingWidth, 1);
  assert.equal(wall.assetParameters.openingOffset, 1.2);
  assert.throws(() => domain.applyBatchEdits(project, [
    { operation: 'add_wall', from: [0, 0], to: [4, 0], opening: { width: 2, offset: 1.5 } },
  ]), /洞口的偏移超出了墙体范围/);
});

test('add_prop 用形状素材拼出目录外的物体，产物是普通可编辑实体', () => {
  // 目录里没有篝火/吉他这类物体。以前只能拿外形无关的道具改名冒充，或者放弃；
  // 声明式组合让它成为一件普通实体：可选中、可撤销、存进工程，且没有代码执行面。
  const project = starter();
  const [prop] = domain.applyBatchEdits(project, [{
    operation: 'add_prop', name: '篝火', position: [2, 0, -1],
    parts: [
      { shape: 'shape-cylinder', at: [0, 0.09, 0], size: [0.9, 0.18, 0.9], color: '#4a3b2e' },
      { shape: 'shape-cone', at: [0, 0.5, 0], size: [0.5, 0.7, 0.5], color: '#c2542a' },
      { shape: 'shape-box', at: [0.45, 0.1, 0], size: [0.8, 0.2, 0.2], rotationDegrees: [0, 45, 0] },
    ],
  }]);
  domain.assertProject(project);
  const fire = project.entities.find(entity => entity.id === prop.entityId);
  assert.equal(fire.asset, 'composite');
  assert.equal(fire.kind, 'prop');
  assert.equal(fire.name, '篝火');
  assert.deepEqual(fire.position, [2, 0, -1]);
  assert.equal(fire.parts.length, 3);
  assert.deepEqual(fire.parts[0], { shape: 'shape-cylinder', at: [0, 0.09, 0], size: [0.9, 0.18, 0.9], color: '#4a3b2e' });
  assert.deepEqual(fire.parts[2].rotationDegrees, [0, 45, 0]);
  assert.equal(fire.parts[2].color, undefined, '没写颜色的部件跟随整件颜色');
  assert.equal(prop.parts, 3);
});

test('add_prop 拒绝非形状素材、越界部件和非法尺寸', () => {
  const project = starter();
  const make = (parts) => () => domain.applyBatchEdits(project, [{ operation: 'add_prop', parts }]);
  assert.throws(make([{ shape: 'structure-wall', at: [0, 0, 0] }]),
    /shape 必须是形状素材（shape-\*）/);
  assert.throws(make([{ shape: 'shape-box', at: [0, 0, 0], size: [1, 0, 1] }]),
    /scale 的三个分量都必须大于 0/);
  assert.throws(make([{ shape: 'shape-box', at: [0, 0, 0], color: 'gray' }]),
    /color 必须是 #rrggbb/);
  assert.throws(make([{ shape: 'shape-box', at: [0, 0, 0], bogus: 1 }]),
    /不支持字段 bogus/);
  assert.throws(make([]), /parts 需要 1 至 32 个部件/);
  assert.throws(make(Array.from({ length: 33 }, () => ({ shape: 'shape-box', at: [0, 0, 0] }))),
    /parts 需要 1 至 32 个部件/);
});


test('表面放置使用同批已修改的实际几何，离开支撑范围时返回错误', () => {
  const project = starter();
  const [support, prop] = domain.applyBatchEdits(project, [
    { operation: 'add_prop', position: [0, 0, 0], parts: [{ shape: 'shape-box', at: [0, 0, 0], size: [2, 1, 2] }] },
    { operation: 'add_prop', position: [0, 4, 0], parts: [{ shape: 'shape-box', at: [0, 0, 0], size: [0.2, 0.2, 0.2] }] },
  ]);
  domain.applyBatchEdits(project, [
    { operation: 'set_entity', entityId: support.entityId, patch: { scale: [1, 2, 1] } },
    { operation: 'place_on_surface', entityId: prop.entityId, targetEntityId: support.entityId },
  ]);
  assert.ok(Math.abs(project.entities.find(e => e.id === prop.entityId).position[1] - 2) < 1e-5);
  domain.applyBatchEdits(project, [{ operation: 'set_entity', entityId: prop.entityId, patch: { position: [10, 2, 0] } }]);
  assert.throws(() => domain.applyBatchEdits(project, [{ operation: 'place_on_surface', entityId: prop.entityId, targetEntityId: support.entityId }]), /下方没有/);
});

test('朝向对齐以 +Z 为正面，路径 easing 和片段过渡保存后参与采样', () => {
  const project = starter(), actor = actorOf(project);
  const [other] = domain.applyBatchEdits(project, [{ operation: 'add_asset', assetId: 'shape-box', position: [2, 0, 0] }]);
  domain.applyBatchEdits(project, [
    { operation: 'align_facing', entityId: actor.id, targetEntityId: other.entityId },
    { operation: 'set_path', entityId: actor.id, smooth: false, points: [{ timeSec: 0, position: [0,0,0] }, { timeSec: 2, position: [2,0,0], easing: 'ease-in' }] },
    { operation: 'set_clip', entityId: actor.id, clipId: actor.clips[0].id, patch: { blendIn: 0.7 } },
  ]);
  assert.equal(actor.rotation[1], Math.PI / 2);
  assert.equal(domain.pathPosition(actor.path, actor.position, 1).x, 0.5);
  assert.equal(actor.clips[0].blendIn, 0.7);
  domain.assertProject(project);
});

test('导出上下文按切镜分段且冻结事实，不把之后的修改带进旧素材', () => {
  const project = starter(), actor = actorOf(project);
  const [camera] = domain.applyBatchEdits(project, [{ operation: 'add_camera', position: [2,2,2] }]);
  domain.applyBatchEdits(project, [{ operation: 'add_cut', timeSec: 2, cameraId: camera.entityId }]);
  const context = domain.directorContext(project, 0, 4);
  assert.equal(context.version, 1);
  assert.equal(context.shots.length, 2);
  assert.equal(context.shots[1].cameraId, camera.entityId);
  const color = context.shots[0].subjects.find(e => e.id === actor.id).color;
  actor.color = '#000000';
  assert.equal(context.shots[0].subjects.find(e => e.id === actor.id).color, color);
});

test('拖拽落面使用真实表面高度，移出承托范围不吸附，并排除隐藏表面', () => {
  const geometry = new domain.BoxGeometry(1, 1, 1), material = new domain.MeshBasicMaterial();
  try {
    const prop = new domain.Mesh(geometry, material), table = new domain.Mesh(geometry, material);
    prop.scale.set(0.2, 0.2, 0.2);
    prop.position.set(0, 0.1, 0);
    table.scale.set(2, 0.8, 2);
    table.position.set(2, 0.4, 0);
    const placed = domain.surfaceDropPosition(prop, [2, 0.1, 0], [table]);
    assert.ok(Math.abs(placed[1] - 0.9) < 1e-6);
    assert.equal(domain.surfaceDropPosition(prop, [4, 0.1, 0], [table]), null);
    table.visible = false;
    assert.equal(domain.surfaceDropPosition(prop, [2, 0.1, 0], [table]), null);
  } finally { geometry.dispose(); material.dispose(); }
});

test('具名批内引用将创建机位、构图、路径与镜头主体作为一次编排', () => {
  const p = starter(), actor = actorOf(p);
  const r = domain.applyBatchEdits(p, [
    { operation: 'add_camera', ref: 'tracking', name: 'Tracking' },
    { operation: 'add_shot', cameraId: '$tracking', timeSec: 0, name: 'Return', subjectIds: [actor.id], patch: { targetId: actor.id, focal: 35 }, points: [{ timeSec: 0, position: [3, 2, 4] }, { timeSec: 4, position: [3, 2, 0] }] },
  ]);
  domain.assertProject(p);
  assert.equal(p.cuts[0].cameraId, r[0].entityId);
  assert.deepEqual(p.cuts[0].subjectIds, [actor.id]);
  assert.equal(p.entities.find(e => e.id === r[0].entityId).path.points.length, 2);
  assert.throws(() => domain.applyBatchEdits(p, [{ operation: 'add_shot', cameraId: '$future', timeSec: 0 }]), /引用/);
  assert.throws(() => domain.applyBatchEdits(p, [{ operation: 'add_camera', ref: 'x' }, { operation: 'add_camera', ref: 'x' }]), /唯一/);
});

test('动作创建可直接指定起止、循环、速度与过渡，并拒绝静默推迟精确时间', () => {
  const p = starter(), actor = actorOf(p);
  assert.throws(() => domain.applyBatchEdits(p, [{ operation: 'add_action', entityId: actor.id, action: 'walk', startSec: 0, endSec: 10 }]), /重叠/);
  actor.clips = [];
  const result = domain.applyBatchEdits(p, [
    { operation: 'add_action', ref: 'walk', entityId: actor.id, action: 'walk', startSec: 0, endSec: 10, loop: true, speed: 1.2, blendIn: 0.3 },
    { operation: 'set_clip', entityId: actor.id, clipId: '$walk', patch: { loop: false } },
  ]);
  domain.assertProject(p);
  assert.equal(result[0].clipId, actor.clips[0].id);
  assert.deepEqual([actor.clips[0].start, actor.clips[0].end, actor.clips[0].loop, actor.clips[0].speed, actor.clips[0].blendIn], [0, 10, false, 1.2, 0.3]);
  assert.throws(() => domain.applyBatchEdits(p, [{ operation: 'set_clip', entityId: actor.id, clipId: actor.clips[0].id, patch: { loop: 'yes' } }]), /布尔/);
});
