import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { entity, clip } from '../vendor/shotloom-director-desk/src/core/model.ts';
import { makeHuman } from '../vendor/shotloom-director-desk/src/core/assets/humanoid.ts';
import { sampleHumanAction } from '../vendor/shotloom-director-desk/src/core/assets/human-animation.ts';
import { fitFeetToSurface } from '../vendor/shotloom-director-desk/src/core/editor/foot-contact.ts';

const require = createRequire(new URL('../vendor/shotloom-director-desk/package.json', import.meta.url));
const THREE = require('three');

test('内置跑步保持平稳的髋部高度，脚底不穿过平地', () => {
  for (const asset of ['person', 'human-adult']) {
    const actor = entity('actor', asset, '跑步验证');
    actor.clips = [clip('run', 0, 4)];
    const rig = makeHuman(actor);
    const hips = [], feet = [];
    for (let frame = 0; frame < 100; frame++) {
      sampleHumanAction(rig, actor, frame * 0.68 / 100);
      fitFeetToSurface(rig, () => 0);
      rig.root.updateMatrixWorld(true);
      hips.push(rig.hips.position.y);
      feet.push(Math.min(...['leftAnkle', 'rightAnkle'].map(name =>
        new THREE.Box3().setFromObject(rig.joints[name], true).min.y)));
    }
    assert.ok(Math.max(...hips) - Math.min(...hips) < 0.04, `${asset} 髋部起伏超过 4 厘米`);
    assert.ok(Math.min(...feet) > -0.005, `${asset} 脚底穿地`);
    assert.ok(Math.max(...feet) < 0.12, `${asset} 双脚同时离地过高`);
  }
});
