import assert from 'node:assert/strict';
import test from 'node:test';
import { presentUserReferences } from '../client/userReferencePresentation.ts';

const director = { node: {
  id: 'director:entity:project-a:scene-main:wall-a', label: '③长廊西墙',
}, snapshot: { source: 'director-scene', entity: { id: 'wall-a', asset: 'structure-wall' } } };

test('导演台实体引用在用户消息中显示名称，不显示内部 JSON', () => {
  const serialized = `<shotloom-director-reference>\n${JSON.stringify(director)}\n</shotloom-director-reference>`;
  const source = `把这面墙降低。\n${serialized}`;
  const shown = presentUserReferences(source);
  assert.equal(shown.text, '把这面墙降低。\n@导演台「③长廊西墙」');
  assert.deepEqual(shown.canvasReferences, []);
  assert.match(source, /"asset":"structure-wall"/, '只修改展示内容，不改提交给 Agent 的原文');
});

test('原有画布引用继续显示短标签并保留导航目标', () => {
  const source = `<shotloom-canvas-reference>${JSON.stringify({ node: { id: 'node-a', label: '参考图' }, snapshot: { id: 'node-a' } })}</shotloom-canvas-reference>`;
  assert.deepEqual(presentUserReferences(source), {
    text: '@"参考图"', canvasReferences: [{ id: 'node-a', label: '参考图' }],
  });
});

test('损坏的引用内容原样保留', () => {
  const source = '<shotloom-director-reference>{broken}</shotloom-director-reference>';
  assert.equal(presentUserReferences(source).text, source);
});
