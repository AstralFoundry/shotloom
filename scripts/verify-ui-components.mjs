#!/usr/bin/env node
// UI 控件门禁：标准控件统一走 antd，避免焦点、Esc、弹层定位和无障碍语义在每个文件里各写一遍。
//
// 这里只拦“已经有库组件、却重新手写一遍”的标准控件；画布里跟随节点坐标、缩放或
// 媒体手势的浮层仍保留自绘，登记在下面的例外表里。新增例外必须写清为什么库组件不适用。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const appRoot = path.resolve(import.meta.dirname, '../renderer/src/app');
const SOURCE_EXTENSION = /\.(tsx|ts)$/;

// 自绘对话框白名单：弹层锚在画布坐标系里，或内部是像素级手势画布。
const HANDWRITTEN_DIALOG_EXCEPTIONS = new Set([
  'canvas/CanvasDisplaySettings.tsx',
  'canvas/ThreeDDirectorNode.tsx',
  'components/ImageWatermarkEditor.tsx',
  'components/MediaViewer.tsx',
]);

// 原生输入白名单：按文件 + 控件类型登记，不能因为一个控件放行整份文件。
const NATIVE_INPUT_EXCEPTIONS = new Map([
  ['canvas/CanvasDisplaySettings.tsx', new Set(['checkbox'])],
]);

// 自绘遮罩白名单：只剩媒体灯箱和 3D 导演台详情，它们需要压在画布/素材上。
const HANDWRITTEN_BACKDROP_EXCEPTIONS = new Set([
  'canvas/ThreeDDirectorNode.tsx',
  'components/MediaViewer.tsx',
]);

// 自绘 menu 白名单：画布工具栏与画布右键菜单跟随 React Flow 坐标系。
const HANDWRITTEN_MENU_EXCEPTIONS = new Set([
  'canvas/CanvasContextMenu.tsx',
  'canvas/CanvasNodeToolbar.tsx',
]);

const violations = [];

// 注释不参与检查，避免说明文字里提到 <select> 就误报。
function maskComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length));
}

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((name) => {
    const entry = path.join(directory, name);
    if (statSync(entry).isDirectory()) return sourceFiles(entry);
    return SOURCE_EXTENSION.test(name) ? [entry] : [];
  });
}

for (const file of sourceFiles(appRoot)) {
  const relative = path.relative(appRoot, file).replace(/\\/g, '/');
  const text = maskComments(readFileSync(file, 'utf8'));

  // 原生下拉没有可复用的键盘导航、搜索和边缘翻转，统一用 antd Select。
  for (const match of text.matchAll(/<select\b/g)) {
    violations.push(`${relative}:${lineOf(text, match.index)} 使用原生 <select>（改用 antd Select，需要搜索时加 showSearch）`);
  }

  // 复选、数值、滑杆、文件选择、搜索、密码与取色都已有库组件；搜索统一走 SearchInput。
  for (const match of text.matchAll(/<input\b[^>]*?\btype=["'](checkbox|number|range|file|search|password|color)["']/g)) {
    const type = match[1];
    const allowed = NATIVE_INPUT_EXCEPTIONS.get(relative);
    if (allowed?.has(type)) continue;
    const hint = {
      checkbox: "antd Checkbox / Switch",
      number: "antd InputNumber",
      range: "antd Slider",
      file: "antd Upload",
      search: "components/SearchInput",
      password: "antd Input.Password",
      color: "antd ColorPicker",
    }[type];
    violations.push(`${relative}:${lineOf(text, match.index)} 使用原生 input[type=${type}]（改用 ${hint}）`);
  }

  if (relative.endsWith('.tsx')) {
    // 手写遮罩通常也意味着自己管 Esc、滚动锁定和焦点；弹窗外壳统一交给 antd Modal/Drawer。
    // 只认 className/rootClassName/classNames 里的类名，避免把 backdropFilter 样式误判成遮罩。
    if (!HANDWRITTEN_BACKDROP_EXCEPTIONS.has(relative)) {
      for (const match of text.matchAll(/(?:root)?[cC]lassNames?\s*=\s*(?:"[^"]*backdrop[^"]*"|`[^`]*backdrop[^`]*`|\{[^}]*backdrop[^}]*\})/g)) {
        violations.push(`${relative}:${lineOf(text, match.index)} 出现手写遮罩类名（改用 antd Modal/Drawer 的遮罩；确实要自绘时登记到脚本例外表）`);
      }
    }

    // 手写 tablist 要自己管键盘与选中态；分档/切换统一用 Segmented / Tabs。
    for (const match of text.matchAll(/role=["']tablist["']/g)) {
      violations.push(`${relative}:${lineOf(text, match.index)} 手写 role="tablist"（改用 antd Segmented / Tabs）`);
    }

    // 自绘 role="menu" 要自己管定位、键盘和点外关闭；标准菜单统一用 Dropdown。
    if (!HANDWRITTEN_MENU_EXCEPTIONS.has(relative)) {
      for (const match of text.matchAll(/role=["']menu["']/g)) {
        violations.push(`${relative}:${lineOf(text, match.index)} 手写 role="menu"（改用 antd Dropdown + Menu；画布菜单请登记例外）`);
      }
    }

  }

  // 所有确认都走 confirmService / App.useApp().modal.confirm，才能跟随主题并被键盘操作。
  for (const match of text.matchAll(/window\.confirm\s*\(/g)) {
    violations.push(`${relative}:${lineOf(text, match.index)} 使用 window.confirm（改用 confirmService / App.useApp().modal.confirm）`);
  }

  // 手写 role="dialog" 通常意味着自己管遮罩、Esc 和焦点陷阱；统一交给 antd Modal。
  if (!HANDWRITTEN_DIALOG_EXCEPTIONS.has(relative)) {
    for (const match of text.matchAll(/role=["']dialog["']/g)) {
      violations.push(`${relative}:${lineOf(text, match.index)} 手写 role="dialog"（改用 antd Modal；确实需要自绘时登记到脚本例外表）`);
    }
  }
}

if (violations.length) {
  console.error('UI 控件违规：');
  for (const violation of violations) console.error(`  ${violation}`);
  console.error('\n标准控件统一使用 antd；自绘只保留登记在 scripts/verify-ui-components.mjs 里的画布/媒体浮层。');
  process.exit(1);
}

console.log('UI 控件检查通过：标准控件没有重新手写，自绘浮层均在登记例外内。');
