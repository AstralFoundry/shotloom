import assert from 'node:assert/strict';
import test from 'node:test';

process.env.NODE_ENV = 'test';

test('top-up conversion reads the gateway display unit and rejects unavailable or malformed rates', async t => {
  const { fetchTopupOptions } = await import('../src/lib/gateway');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let data: object = { quota_per_unit: 500_000, quota_display_type: 'USD' };
  let status = 200;
  globalThis.fetch = async input => {
    assert.equal(new URL(String(input)).pathname, '/api/status');
    return Response.json({ success: true, data }, { status });
  };
  assert.deepEqual(await fetchTopupOptions(), { quotaPerAmount: 500_000 });
  data = { quota_per_unit: 1_000_000, quota_display_type: 'CNY' };
  assert.deepEqual(await fetchTopupOptions(), { quotaPerAmount: 1_000_000 });
  data = { quota_per_unit: 500_000, quota_display_type: 'TOKENS' };
  assert.deepEqual(await fetchTopupOptions(), { quotaPerAmount: 1 });
  for (const quota_per_unit of [0, -1, '500000', null]) {
    data = { quota_per_unit, quota_display_type: 'USD' };
    await assert.rejects(fetchTopupOptions(), /充值比例暂不可用/);
  }
  status = 503;
  await assert.rejects(fetchTopupOptions(), /充值比例暂不可用/);
});

test('App checkout sends display amount to the gateway, keeps tokens private and accepts only HTTPS payment links', async t => {
  const { createTopup } = await import('../src/lib/gateway');
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let result: object = { checkout_url: 'https://payments.example.com/order/1' };
  let status = 200;
  globalThis.fetch = async (input, init) => {
    assert.equal(new URL(String(input)).pathname, '/oauth/topup/checkout');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer private-access-token');
    assert.deepEqual(JSON.parse(String(init?.body)), { amount: 10, payment_method: 'waffo_pancake' });
    return Response.json(result, { status });
  };
  assert.equal(await createTopup('private-access-token', 10), 'https://payments.example.com/order/1');
  for (const checkout_url of ['http://insecure.example.com/pay', 'https://user:secret@payments.example.com/pay', 'javascript:alert(1)']) {
    result = { checkout_url };
    await assert.rejects(createTopup('private-access-token', 10));
  }
  result = { error_description: 'upstream diagnostic' }; status = 400;
  await assert.rejects(createTopup('private-access-token', 10), /充值通道暂不可用/);
});
