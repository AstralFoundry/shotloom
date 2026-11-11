import assert from 'node:assert/strict';
import test from 'node:test';

test('导演台初始语言读取项目语言，宿主更新语言时不写独立设置', async () => {
  const previousStorage = globalThis.localStorage;
  const writes = [];
  globalThis.localStorage = {
    getItem(key) { return key === 'shotloom:locale' ? 'en-US' : null; },
    setItem(key, value) { writes.push([key, value]); },
  };
  try {
    const locale = await import('../vendor/shotloom-director-desk/src/shared/i18n/locale.ts');
    assert.equal(locale.getLanguage(), 'en');
    assert.equal(locale.t('重置项目'), 'Reset Project');
    locale.setLanguage('zh-CN');
    assert.equal(locale.getLanguage(), 'zh-CN');
    assert.deepEqual(writes, []);
  } finally {
    globalThis.localStorage = previousStorage;
  }
});
