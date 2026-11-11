import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

// Exercise the handler shipped in the native client, not a duplicate of its
// logic. Real-browser QA also exercises the complete official ModelSelect in
// separate composer/overlay ShadowRoots with model and effort selections.
const source = await readFile(new URL('../client-dist/plugins/@deepseek-ai/dsh-client-ui-model-selection/native.js', import.meta.url), 'utf8');
const start = source.indexOf('const onBlur = (event) => {');
const end = source.indexOf('const settleSelection =', start);
assert.ok(start >= 0 && end > start, 'Official picker blur handler must exist');
const handler = source.slice(start, end);

test('unavailable selection never exposes an internal provider route in the composer', () => {
  assert.match(source, /currentChoice\?\.model\.name \?\? t\("trigger\.fallback"\)/);
  assert.doesNotMatch(source, /\$\{state\.current\.provider\}\/\$\{state\.current\.model\}/);
});

function fixture() {
  class Node {}
  const trigger = new Node(), option = new Node(), shadowHost = new Node(), outside = new Node();
  const rootRef = { current: { contains: node => node === trigger } };
  const menuRef = { current: { contains: node => node === option } };
  const document = { activeElement: null };
  let closes = 0;
  const onBlur = runInNewContext(`(() => { ${handler} return onBlur; })()`, {
    Node, rootRef, menuRef, document, queueMicrotask, close: () => { closes++; },
  });
  return { onBlur, trigger, option, shadowHost, outside, document, rootRef, menuRef, closes: () => closes };
}

test('model/effort drill waits for the cross-shadow focus transfer before checking dismissal', async () => {
  const f = fixture();
  // During focusout, relatedTarget is the destination host and its focused
  // descendant has not yet become active. The browser finishes focus next.
  f.onBlur({ relatedTarget: f.shadowHost });
  assert.equal(f.closes(), 0);
  f.document.activeElement = f.option;
  await Promise.resolve();
  assert.equal(f.closes(), 0);
});

test('returning keyboard focus from a picker pane to the composer trigger keeps it open', async () => {
  const f = fixture();
  f.onBlur({ relatedTarget: f.shadowHost });
  f.document.activeElement = f.trigger;
  await Promise.resolve();
  assert.equal(f.closes(), 0);
});

test('leaving the picker or losing document focus still dismisses it', async () => {
  for (const active of ['outside', null]) {
    const f = fixture();
    f.onBlur({ relatedTarget: active ? f.outside : null });
    f.document.activeElement = active ? f.outside : null;
    await Promise.resolve();
    assert.equal(f.closes(), 1);
  }
});

test('queued focus checks tolerate a picker that unmounts during focus transfer', async () => {
  const f = fixture();
  f.onBlur({ relatedTarget: f.shadowHost });
  f.rootRef.current = null;
  f.menuRef.current = null;
  await Promise.resolve();
  assert.equal(f.closes(), 1);
});
