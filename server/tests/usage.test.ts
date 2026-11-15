import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

test('usage logs use the current OAuth token and pagination, and strip private upstream fields', async t => {
  const { fetchUsageLogs } = await import('../src/lib/gateway');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const item = { id: 42, created_at: 1794720000, model_name: 'deepseek-v4-pro', quota: 12345, prompt_tokens: 40, completion_tokens: 12 };
  let payload: unknown = { total: 21, page: 2, page_size: 10, items: [{ ...item, content: 'private prompt', other: { api_key: 'secret' }, ip: 'private', user_id: 7, token_name: 'private token' }] };
  let status = 200;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/oauth/logs');
    assert.equal(url.search, '?page=2&page_size=10');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-user-token');
    return Response.json(payload, { status });
  };
  assert.deepEqual(await fetchUsageLogs('private-user-token', 2, 10), { total: 21, page: 2, page_size: 10, items: [item] });
  payload = { total: 0, page: 2, page_size: 10, items: [] };
  assert.deepEqual((await fetchUsageLogs('private-user-token', 2, 10)).items, []);
  payload = { total: 1, page: 2, page_size: 10, items: [{ ...item, quota: '12345' }] };
  await assert.rejects(fetchUsageLogs('private-user-token', 2, 10), /格式异常/);
  status = 403; payload = { error_description: 'private upstream details' };
  await assert.rejects(fetchUsageLogs('private-user-token', 2, 10), /消费记录暂不可用/);
});
