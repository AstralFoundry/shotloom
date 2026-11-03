import ts from 'typescript';
import { existsSync, readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const repoRoot = new URL('../../', import.meta.url);
const sources = new Map();

function toRepoPath(relativePath) {
  return relativePath.replace(/^\.\//, '').replace(/^\.\.\//, '');
}

/**
 * 读取一份产品源码用于契约断言，路径相对仓库根，例如
 * `renderer/src/app/ReactWorkbench.tsx` 或 `src-tauri/src/commands/file.rs`。
 *
 * 测试自己不再各写一份 `readFileSync(new URL('../…'))`：同一个文件会被十几个测试读，
 * 统一在这里缓存一次，路径基准也只有一个，测试可以从任何工作目录运行。
 */
export function readSource(relativePath) {
  const key = toRepoPath(relativePath);
  if (!sources.has(key)) sources.set(key, readFileSync(new URL(key, repoRoot), 'utf8'));
  return sources.get(key);
}

/**
 * 把一个契约拆在多个模块里的情况读成一份文本，避免同一条断言复制进每个文件各自的测试。
 */
export function readSources(relativePaths) {
  return relativePaths.map((relativePath) => readSource(relativePath)).join('\n');
}

/**
 * 源码文本断言失败时，报错只该指出"哪个文件没有满足哪条契约"，
 * 而不是把几百行源码倒进测试输出里。
 */
export function assertSource(relativePath, source, pattern, shouldMatch, message) {
  const label = `${relativePath}${message ? ` — ${message}` : ''}`;
  if (shouldMatch) assert.match(source, pattern, label);
  else assert.doesNotMatch(source, pattern, label);
}

/** 断言「这个文件在不在」也按仓库根路径来问，测试不自己拼 URL。 */
export function sourceExists(relativePath) {
  return existsSync(new URL(toRepoPath(relativePath), repoRoot));
}

/**
 * 旧界面结构契约按默认中文描述控件；只展开已登记的 t 调用，保留其余代码结构。
 * 新国际化行为用运行时/浏览器测试验证，不依赖此展开结果。
 */
export function readLocalizedSource(relativePath) {
  const source = readSource(relativePath);
  const messages = JSON.parse(readSource('renderer/src/i18n/locales/zh-CN.json'));
  const tree = ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true,
    relativePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const edits = [];
  function expand(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && ts.isStringLiteral(node.arguments[0])) {
      const key = node.arguments[0].text;
      assert.ok(Object.hasOwn(messages, key), `不存在的界面词条：${key}`);
      let text = messages[key];
      const parameters = node.arguments[1];
      if (parameters && ts.isObjectLiteralExpression(parameters)) {
        for (const field of parameters.properties) {
          if (ts.isPropertyAssignment(field)) text = text.replaceAll(`{${field.name.getText(tree)}}`, '${' + expand(field.initializer) + '}');
        }
        return '`' + text.replaceAll('`', '\`') + '`';
      }
      return JSON.stringify(text);
    }
    let result = node.getText(tree);
    const start = node.getStart(tree);
    const changes = [];
    ts.forEachChild(node, child => {
      const value = expand(child);
      if (value !== child.getText(tree)) changes.push({ start: child.getStart(tree) - start, end: child.end - start, value });
    });
    for (const change of changes.sort((a, b) => b.start - a.start)) result = result.slice(0, change.start) + change.value + result.slice(change.end);
    return result;
  }
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 't' && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
      const translated = expand(node);
      if (ts.isJsxExpression(node.parent) && ts.isJsxAttribute(node.parent.parent)) {
        edits.push({ start: node.parent.getStart(tree), end: node.parent.end, value: node.arguments.length > 1 ? `{${translated}}` : translated });
      } else if (ts.isJsxExpression(node.parent) && (ts.isJsxElement(node.parent.parent) || ts.isJsxFragment(node.parent.parent)) && node.arguments.length === 1) {
        edits.push({ start: node.parent.getStart(tree), end: node.parent.end, value: JSON.parse(translated) });
      } else edits.push({ start: node.getStart(tree), end: node.end, value: translated });
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  let result = source;
  for (const edit of edits.sort((a, b) => b.start - a.start)) result = result.slice(0, edit.start) + edit.value + result.slice(edit.end);
  return result;
}
