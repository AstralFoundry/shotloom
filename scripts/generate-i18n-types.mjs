import { readFileSync, writeFileSync } from 'node:fs';
const base = new URL('../renderer/src/i18n/', import.meta.url);
const zh = JSON.parse(readFileSync(new URL('locales/zh-CN.json', base), 'utf8'));
const rows = Object.entries(zh).flatMap(([key, text]) => {
  const parameters = [...new Set([...text.matchAll(/\{([^{}]+)\}/g)].map(match => match[1]))];
  return parameters.length ? [`  ${JSON.stringify(key)}: Record<${parameters.map(value => JSON.stringify(value)).join(' | ')}, string | number>;`] : [];
});
const content = '// 从 locales/zh-CN.json 生成；请运行 node scripts/generate-i18n-types.mjs。\nexport interface MessageParameters {\n' + rows.join('\n') + '\n}\n';
const target = new URL('message-parameters.d.ts', base);
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error('文案参数类型已过期，请重新生成');
} else writeFileSync(target, content);
console.log(`文案参数类型：${Object.keys(zh).length} 条词条，${rows.length} 条含参数`);
const login = Object.fromEntries(['zh-CN', 'en-US'].map(locale => {
  const catalog = JSON.parse(readFileSync(new URL(`locales/${locale}.json`, base), 'utf8'));
  return [locale, Object.fromEntries(Object.entries(catalog).filter(([key]) => key.startsWith('cloud.login.') || key.startsWith('cloud.logout')))];
}));
const loginTarget = new URL('login-messages.generated.json', base), loginContent = JSON.stringify(login, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(loginTarget, 'utf8').replace(/\r\n/g, '\n') !== loginContent) throw new Error('Login translations are outdated; regenerate i18n types');
} else writeFileSync(loginTarget, loginContent);
