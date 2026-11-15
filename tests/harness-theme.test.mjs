import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readSource } from './helpers/sourceContract.mjs';

test('Harness scopes real document theme selectors to the same shadow host', async () => {
  const compiled = await build({ stdin: { contents: readSource('harness/host/client/domScope.ts'), loader: 'ts' }, write: false, format: 'esm', target: 'es2023' });
  const previous = globalThis.document;
  globalThis.document = {};
  try {
    const { scopeDocumentCss } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
    const css = ':root{--font:13px}body{--bg:white}body[data-ds-dark-theme]{--bg:black}html[data-platform=darwin] body[data-ds-dark-theme] .menu{color:white}';
    const scoped = scopeDocumentCss(css);
    assert.equal(scoped, ':host{--font:13px}:host{--bg:white}:host([data-ds-dark-theme]){--bg:black}:host([data-platform=darwin][data-ds-dark-theme]) .menu{color:white}');
    assert.equal(scopeDocumentCss(scoped), scoped, 'style mirroring must be idempotent');
    assert.equal(scopeDocumentCss('@media (prefers-reduced-motion:reduce){body[data-ds-dark-theme] .chat{animation:none}}'), '@media (prefers-reduced-motion:reduce){:host([data-ds-dark-theme]) .chat{animation:none}}');
    assert.equal(scopeDocumentCss('.body-copy{content:"body[data-theme]"}'), '.body-copy{content:"body[data-theme]"}');
    const upstream = readSource('harness/host/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/client.js');
    const themeCss = JSON.parse(upstream.match(/var design_platform_css_default = ("(?:[^"\\]|\\.)*");/)?.[1] || '""');
    assert.ok(themeCss.includes('body[data-ds-dark-theme]'), 'exercise actual upstream dark theme CSS');
    const themeScoped = scopeDocumentCss(themeCss);
    assert.ok(themeScoped.includes(':host([data-ds-dark-theme])'));
    assert.ok(themeScoped.includes(':host([data-platform=darwin][data-ds-dark-theme])'));
    assert.equal(themeScoped.includes(':host[data-ds-dark-theme]'), false);
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
