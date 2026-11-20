import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePublication, executionTemplates } from '../../shared/modelPublications';
import { relayPath } from '../src/lib/relay';

test('RunningHub templates are publishable through supported gateway routes', () => {
  for (const [id, type] of [['minimax-h3-reference-to-video', 'videoGeneration'], ['krea2-normal-v1', 'imageGeneration']] as const) {
    const templateId = `newapi-runninghub-${id}`;
    assert.ok(executionTemplates.some(template => template.id === templateId));
    const publication = { id, owned_by: 'runninghub', supported_endpoint_types: [], available: true,
      name: id, type, template_id: templateId, sort_order: 0, published: true, revision: 1 };
    const model = compilePublication(publication)!;
    assert.ok(model);
    assert.equal(model.id, id);
    assert.equal(model.upstreamModel, id);
    assert.equal(model.provider, 'openai');
    for (const mode of model.modes) {
      assert.equal((mode.requestTemplate as { model: string }).model, '{{model}}');
      assert.equal(relayPath(mode.endpoint.path, model.provider, mode.endpoint.scope),
        type === 'videoGeneration' ? '/v1/videos' : mode.inputMode === 'reference' ? '/v1/images/edits' : '/v1/images/generations');
    }
    assert.equal(compilePublication({ ...publication, published: false }), null);
    assert.equal(compilePublication({ ...publication, available: false }), null);
  }
});
