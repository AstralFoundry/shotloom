import assert from 'node:assert/strict';
import test from 'node:test';
import { entity } from '../vendor/shotloom-director-desk/src/core/model.ts';
import { makeHuman, colorHuman } from '../vendor/shotloom-director-desk/src/core/assets/humanoid.ts';

for (const asset of ['person', 'woman', 'human-adult', 'human-female']) {
  test(`${asset} 保留角色辨识色，创建与实时改色一致`, () => {
    const actor = entity('actor', asset, '主角');
    actor.color = '#cc2233';
    if (asset.startsWith('human-')) actor.assetParameters = { outfit: 1 };
    const rig = makeHuman(actor);
    assert.equal(rig.skin.color.getHexString(), 'cc2233');
    colorHuman(rig, '#2255cc');
    assert.equal(rig.skin.color.getHexString(), '2255cc');
    const costumes = [];
    rig.root.traverse(node => {
      if (node.isMesh && node.userData.costume) costumes.push(node);
    });
    if (asset.startsWith('human-')) {
      assert.ok(costumes.length > 0, '便装参数生成可见服装');
      for (const mesh of costumes) {
        assert.equal(mesh.visible, true);
        assert.equal(mesh.material.color.getHexString(), '2255cc');
      }
    }
  });
}
