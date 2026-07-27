export const DEFAULT_CANVAS_ACTION_SHORTCUTS = Object.freeze({
  fitView: Object.freeze({ type: 'mouse', button: 'middle', gesture: 'singleClick' }),
  autoLayout: Object.freeze({ type: 'mouse', button: 'middle', gesture: 'doubleClick' }),
});

const modifierKeys = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift']);

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isCanvasActionShortcut(value) {
  if (!isObject(value)) return false;
  if (value.type === 'mouse') {
    return value.button === 'middle' && ['singleClick', 'doubleClick'].includes(value.gesture);
  }
  return value.type === 'keyboard'
    && typeof value.key === 'string' && value.key.length > 0
    && typeof value.code === 'string' && value.code.length > 0
    && ['altKey', 'ctrlKey', 'metaKey', 'shiftKey'].every((key) => typeof value[key] === 'boolean');
}

export function normalizeCanvasActionShortcuts(value) {
  const source = isObject(value) ? value : {};
  return {
    fitView: isCanvasActionShortcut(source.fitView)
      ? { ...source.fitView }
      : { ...DEFAULT_CANVAS_ACTION_SHORTCUTS.fitView },
    autoLayout: isCanvasActionShortcut(source.autoLayout)
      ? { ...source.autoLayout }
      : { ...DEFAULT_CANVAS_ACTION_SHORTCUTS.autoLayout },
  };
}

export function createKeyboardCanvasActionShortcut(event) {
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

export function matchesCanvasKeyboardShortcut(event, shortcut) {
  return shortcut?.type === 'keyboard'
    && event.code === shortcut.code
    && event.altKey === shortcut.altKey
    && event.ctrlKey === shortcut.ctrlKey
    && event.metaKey === shortcut.metaKey
    && event.shiftKey === shortcut.shiftKey;
}

export function matchesCanvasMouseShortcut(shortcut, gesture) {
  return shortcut?.type === 'mouse' && shortcut.button === 'middle' && shortcut.gesture === gesture;
}

export function areCanvasActionShortcutsEqual(left, right) {
  if (left?.type !== right?.type) return false;
  if (left?.type === 'mouse') return left.button === right.button && left.gesture === right.gesture;
  return left?.type === 'keyboard'
    && left.code === right.code
    && left.altKey === right.altKey
    && left.ctrlKey === right.ctrlKey
    && left.metaKey === right.metaKey
    && left.shiftKey === right.shiftKey;
}

export function isEditableShortcutTarget(target) {
  return target instanceof HTMLElement
    && (target.isContentEditable || Boolean(target.closest('input, textarea, select, [contenteditable="true"]')));
}

export function canvasActionShortcutLabel(shortcut, compact = false) {
  if (shortcut?.type === 'mouse') return shortcut.gesture === 'doubleClick' ? '双击中键' : '单击中键';
  if (shortcut?.type !== 'keyboard') return '未设置';
  const keys = [];
  if (shortcut.metaKey) keys.push(compact ? '⌘' : 'Meta');
  if (shortcut.ctrlKey) keys.push(compact ? '⌃' : 'Ctrl');
  if (shortcut.altKey) keys.push(compact ? '⌥' : 'Alt');
  if (shortcut.shiftKey) keys.push('Shift');
  const key = shortcut.key === ' ' ? 'Space' : shortcut.key;
  keys.push(key.length === 1 ? key.toUpperCase() : key.replace(/^Arrow/, ''));
  return keys.join(compact ? '' : ' + ');
}
