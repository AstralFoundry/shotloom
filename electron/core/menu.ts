import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * 原生菜单标题和渲染进程用同一份 JSON 词条（native.menu.*），
 * 菜单语言跟随已保存的 locale；同一语言重复保存时不重建菜单。
 */
let currentLocale: string | null = null;

type Catalog = Record<string, unknown>;

/**
 * 菜单词条由 scripts/build-electron.mjs 从渲染进程语言包里抽出 native.menu.*，
 * 避免把两份 600KB 的完整语言包打进主进程。
 */
function catalogs(): { zh: Catalog; en: Catalog } {
  const file = join(__dirname, 'native-menu.json');
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as { zh: Catalog; en: Catalog };
  return parsed;
}

let cachedCatalogs: { zh: Catalog; en: Catalog } | null = null;

function catalog(locale: string): Catalog {
  cachedCatalogs ??= catalogs();
  return locale === 'en-US' ? cachedCatalogs.en : cachedCatalogs.zh;
}

function text(catalogValue: Catalog, key: string): string {
  const value = catalogValue[key];
  if (typeof value !== 'string' || !value) throw new Error(`missing native menu translation: ${key}`);
  return value;
}

export function applyNativeMenu(locale: string): void {
  const normalized = locale === 'en-US' ? 'en-US' : 'zh-CN';
  if (currentLocale === normalized) return;
  currentLocale = normalized;
  const zh = catalog('zh-CN');
  if (!('native.menu.file' in zh)) throw new Error('native menu catalog is incomplete');
  const t = (key: string) => text(catalog(normalized), key);
  Menu.setApplicationMenu(Menu.buildFromTemplate(template(t)));
}

function template(t: (key: string) => string): MenuItemConstructorOptions[] {
  const isMac = process.platform === 'darwin';
  const appMenu: MenuItemConstructorOptions[] = [
    { role: 'about', label: t('native.menu.about') },
    { type: 'separator' },
    { role: 'services', label: t('native.menu.services') },
    { type: 'separator' },
    { role: 'hide', label: t('native.menu.hide') },
    { role: 'hideOthers', label: t('native.menu.hideOthers') },
    { role: 'unhide', label: t('native.menu.showAll') },
    { type: 'separator' },
    { role: 'quit', label: t('native.menu.quit') },
  ];
  const items: MenuItemConstructorOptions[] = [];
  if (isMac) items.push({ label: app.name, submenu: appMenu });
  items.push(
    { label: t('native.menu.file'), submenu: [{ role: 'close', label: t('native.menu.closeWindow') }] },
    {
      label: t('native.menu.edit'),
      submenu: [
        { role: 'undo', label: t('native.menu.undo') },
        { role: 'redo', label: t('native.menu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('native.menu.cut') },
        { role: 'copy', label: t('native.menu.copy') },
        { role: 'paste', label: t('native.menu.paste') },
        { role: 'selectAll', label: t('native.menu.selectAll') },
      ],
    },
    { label: t('native.menu.view'), submenu: [{ role: 'togglefullscreen', label: t('native.menu.fullscreen') }] },
    {
      label: t('native.menu.window'),
      submenu: [
        { role: 'minimize', label: t('native.menu.minimize') },
        { role: 'zoom', label: t('native.menu.maximize') },
        { type: 'separator' },
        { role: 'close', label: t('native.menu.closeWindow') },
      ],
    },
    { label: t('native.menu.help'), submenu: [] },
  );
  return items;
}
