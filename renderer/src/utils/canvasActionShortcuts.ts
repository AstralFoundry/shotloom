import { t } from '../i18n/index.ts';
import { isRecord } from './typeGuards.ts';
export const DEFAULT_CANVAS_ACTION_SHORTCUTS = Object.freeze({
  fitView: Object.freeze({ type: 'mouse', button: 'middle', gesture: 'singleClick' }),
  autoLayout: Object.freeze({ type: 'mouse', button: 'middle', gesture: 'doubleClick' }),
});

const modifierKeys = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);

export function isCanvasActionShortcut(value: unknown) {
  if (!isRecord(value)) return false;
  if (value.type === 'mouse') {
    return value.button === 'middle' && (value.gesture === 'singleClick' || value.gesture === 'doubleClick');
  }
  return value.type === 'keyboard'
    && typeof value.key === 'string' && value.key.length > 0
    && typeof value.code === 'string' && value.code.length > 0
    && ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'].every((key) => typeof value[key] === 'boolean');
}

export function normalizeCanvasActionShortcuts(value: unknown = {}) {
  const source = isRecord(value) ? value : {};
  return {
    fitView: isCanvasActionShortcut(source.fitView)
      ? { ...(source.fitView as Record<string, any>) }
      : { ...DEFAULT_CANVAS_ACTION_SHORTCUTS.fitView },
    autoLayout: isCanvasActionShortcut(source.autoLayout)
      ? { ...(source.autoLayout as Record<string, any>) }
      : { ...DEFAULT_CANVAS_ACTION_SHORTCUTS.autoLayout },
  };
}

export function createKeyboardCanvasActionShortcut(event: KeyboardEvent | null | undefined) {
  if (!event || modifierKeys.has(event.key)) return null;
  return {
    type: 'keyboard',
    key: event.key === ' ' ? 'Space' : event.key,
    code: event.code,
    altKey: Boolean(event.altKey),
    ctrlKey: Boolean(event.ctrlKey),
    metaKey: Boolean(event.metaKey),
    shiftKey: Boolean(event.shiftKey),
  };
}

export function matchesCanvasKeyboardShortcut(event: KeyboardEvent, shortcut: any) {
  return shortcut?.type === 'keyboard'
    && event.code === shortcut.code
    && event.altKey === shortcut.altKey
    && event.ctrlKey === shortcut.ctrlKey
    && event.metaKey === shortcut.metaKey
    && event.shiftKey === shortcut.shiftKey;
}

export function matchesCanvasMouseShortcut(shortcut: any, gesture: string) {
  return shortcut?.type === 'mouse' && shortcut.button === 'middle' && shortcut.gesture === gesture;
}

export function areCanvasActionShortcutsEqual(left: any, right: any) {
  if (left?.type !== right?.type) return false;
  if (left?.type === 'mouse') return left.button === right.button && left.gesture === right.gesture;
  return left?.type === 'keyboard'
    && left.code === right.code
    && left.altKey === right.altKey
    && left.ctrlKey === right.ctrlKey
    && left.metaKey === right.metaKey
    && left.shiftKey === right.shiftKey;
}

export function isEditableShortcutTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')));
}

export function canvasActionShortcutLabel(shortcut: any, compact = false) {
  if (shortcut?.type === 'mouse') return shortcut.gesture === 'doubleClick' ? t("ui.canvasActionShortcuts.text.7987dc58") : t("ui.canvasActionShortcuts.text.181df97d");
  if (shortcut?.type !== 'keyboard') return t("ui.canvasActionShortcuts.text.55a04b58");
  const keys: string[] = [];
  if (shortcut.metaKey) keys.push(compact ? '⌘' : 'Meta');
  if (shortcut.ctrlKey) keys.push(compact ? '⌃' : 'Ctrl');
  if (shortcut.altKey) keys.push(compact ? '⌥' : 'Alt');
  if (shortcut.shiftKey) keys.push('Shift');
  const key = shortcut.key === ' ' ? 'Space' : shortcut.key;
  keys.push(key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, ''));
  return keys.join(compact ? '' : ' + ');
}
