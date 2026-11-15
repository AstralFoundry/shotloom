import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readSource } from './helpers/sourceContract.mjs';
import { adaptGatewayFailureUi, isGatewayQuotaFailure } from '../harness/host/scripts/gateway-failure-ui.mjs';

for (const name of ['chat', 'trajectory']) {
  test(`${name} shows the real gateway quota failure in historical AUTH events`, () => {
    const id = `@deepseek-ai/dsh-client-ui-${name}`;
    const source = adaptGatewayFailureUi(id, readSource(`harness/host/node_modules/${id}/lib/client.js`));
    const functionName = name === 'chat' ? 'failureMessage' : 'requestErrorMessage';
    const body = source.match(new RegExp(`function ${functionName}\\([^]*?\\n\\t\\t}`))?.[0];
    assert.ok(body);
    const format = runInNewContext(`(${body})`, { isGatewayQuotaFailure });
    const projectionBody = source.match(/function displayFailure\([^]*?\n\t\t}/)?.[0];
    assert.ok(projectionBody);
    const project = runInNewContext(`(${projectionBody})`, { isGatewayQuotaFailure });
    const render = (message, code) => name === 'chat' ? format(message, code, key => key) : format({ error: message, errorCode: code }, key => key);
    const prefix = name === 'chat' ? 'message.failure' : 'details.failure';
    const quota = '403: {"message":"Insufficient user quota, remaining quota: $0","code":"insufficient_user_quota"}';
    assert.equal(render(quota, 'AUTH'), `${prefix}.shotloomQuota`);
    for (const message of [quota, '403: {"message":"Insufficient user quota, remaining quota: ＄0.000000","type":"new_api_error","param":"","code":"insufficient_user_quota"}',
      '403: { "error": { "code": "insufficient_user_quota" } }']) {
      const projected = project({ code: 'AUTH', message });
      assert.equal(projected.code, 'SHOTLOOM_QUOTA');
      assert.equal(projected.message, '');
      assert.equal(render(projected.message, projected.code), `${prefix}.shotloomQuota`);
    }
    assert.equal(project({ code: 'AUTH', message: '401: invalid token' }).message, '');
    assert.equal(isGatewayQuotaFailure('403: {invalid JSON'), false);
    assert.equal(isGatewayQuotaFailure('insufficient_user_quota'), false);
    assert.equal(render('401: invalid token', 'AUTH'), `${prefix}.auth`);
    assert.equal(render('Network unavailable', 'NETWORK'), 'Network unavailable');
  });
}
