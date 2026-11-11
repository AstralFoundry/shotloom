/**
 * Shortcut arbitration for the global key handler.
 *
 * The editor owns a handful of unmodified keys (Space, Delete, 1/2/3, F, …). They must not
 * fire while the user is typing, while a dialog/popover is open, or while a focused widget
 * needs the key itself (a button responds to Space, a slider to the arrows). Every check here
 * is a reason to step aside and let the focused element handle the event.
 */

const TEXT_INPUT_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/** True for anything that consumes typed characters, including antd's number and search inputs. */
export function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    if (TEXT_INPUT_TAGS.has(target.tagName)) return true;
    // Custom composed widgets (rich text, editors) mark themselves editable.
    return target.closest('[contenteditable="true"], [role="textbox"]') !== null;
}

const INTERACTIVE_SELECTOR = [
    'button',
    'a[href]',
    'select',
    'textarea',
    'input',
    '[role="button"]',
    '[role="switch"]',
    '[role="slider"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="option"]',
    '[role="combobox"]',
].join(', ');

/**
 * True when a focused control should receive the key itself. Space activates buttons and
 * toggles switches; arrows and Delete belong to sliders, tabs and listboxes.
 */
export function isInteractiveTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element)) return false;
    return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * Overlays that own the keyboard while open. Tooltips are deliberately excluded: antd renders
 * and keeps them in the DOM after hover, so counting them would disable every editor shortcut
 * the moment the pointer rested on a toolbar button.
 */
const BLOCKING_SELECTOR = [
    '.ant-modal-root',
    '.ant-modal-wrap',
    // antd keeps closed popovers/dropdowns mounted with a `*-hidden` class; only count live ones.
    '.ant-popover:not(.ant-popover-hidden)',
    '.ant-dropdown:not(.ant-dropdown-hidden)',
    '.ant-select-dropdown:not(.ant-select-dropdown-hidden)',
    '.ant-menu-submenu-popup',
    '.ant-drawer',
    '.ant-color-picker',
].join(', ');

/** True while a layer is open that owns the keyboard (dialogs, menus, pickers). */
export function hasBlockingLayer(root: ParentNode = document): boolean {
    return root.querySelector(BLOCKING_SELECTOR) !== null;
}

/**
 * True when a key press must reach the focused control instead of the editor shortcuts.
 *
 * Unmodified keys belong to whatever is focused (Space activates a button, arrows drive a
 * slider). Modified shortcuts do not: a focused toolbar button has no Ctrl+D behaviour, so the
 * editor still owns them.
 */
export function shouldIgnoreShortcut(event: Pick<KeyboardEvent, 'target' | 'ctrlKey' | 'metaKey'>): boolean {
    if (isTypingTarget(event.target)) return true;
    const modified = event.ctrlKey || event.metaKey;
    if (!modified && isInteractiveTarget(event.target)) return true;
    return hasBlockingLayer();
}
