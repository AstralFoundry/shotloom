import assert from 'node:assert/strict';
import test from 'node:test';
import { isSessionSource } from '../src/sessionSource';

const origin = 'https://shotloom.0xfiang.com';
test('authorized Android WebMessageListener sends an origin, not the document path', () => {
  assert.equal(isSessionSource(origin, `${origin}/native`, origin), true);
});
test('legacy Android and iOS send the bridge document URL', () => {
  assert.equal(isSessionSource(`${origin}/native?auth=ok`, `${origin}/native?auth=ok`, origin), true);
});
test('provider pages, workspace documents, and malformed sources cannot use the session bridge', () => {
  for (const [message, document] of [
    [origin, `${origin}/workspace/1`],
    [origin, 'https://provider.example/native'],
    ['https://provider.example', `${origin}/native`],
    [`${origin}/workspace/1`, `${origin}/native`],
    [`${origin}/native`, `${origin}/workspace/1`],
    [`${origin}.evil.example/native`, `${origin}/native`],
    ['null', `${origin}/native`],
  ] as const) assert.equal(isSessionSource(message, document, origin), false, `${message} from ${document}`);
});
