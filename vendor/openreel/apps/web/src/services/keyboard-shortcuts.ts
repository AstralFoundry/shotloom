import { editorMessage } from "../shotloom-mode";
export type ShortcutCategory =
  | "playback"
  | "editing"
  | "selection"
  | "timeline"
  | "view"
  | "file"
  | "tools";

export interface ShortcutDefinition {
  id: string;
  name: string;
  description: string;
  category: ShortcutCategory;
  defaultKey: string;
  currentKey: string;
  action: string;
  enabled: boolean;
}

export interface ShortcutPreset {
  id: string;
  name: string;
  description: string;
  shortcuts: Record<string, string>;
}

export type ShortcutHandler = (e: KeyboardEvent) => void;

const STORAGE_KEY = "openreel_shortcuts";
const PRESET_KEY = "openreel_shortcut_preset";

function parseKeyCombo(key: string): {
  key: string;
  meta: boolean;
  ctrl: boolean;
  shift: boolean;
  alt: boolean;
} {
  // The plus key is itself a separator, so preserve it at the end of a combo.
  const parts = key.toLowerCase().split("+");
  return {
    key: normalizeKey(key.endsWith("+") ? "+" : parts[parts.length - 1]),
    meta: parts.includes("cmd") || parts.includes("meta"),
    ctrl: parts.includes("ctrl"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt") || parts.includes("option"),
  };
}

function normalizeKey(key: string): string {
  if (key === " " || key === "spacebar") return "space";
  if (key === "esc") return "escape";
  return key.toLowerCase();
}

function comboIdentity(key: string): string {
  const combo = parseKeyCombo(key);
  // Cmd and Ctrl are portable aliases throughout the editor.
  return `${combo.meta || combo.ctrl}:${combo.shift && !isShiftedSymbol(combo.key)}:${combo.alt}:${combo.key === "backspace" ? "delete" : combo.key}`;
}

const PHYSICAL_PUNCTUATION: Record<string, string> = {
  BracketLeft: "[", BracketRight: "]", Backslash: "\\", Equal: "=",
  Minus: "-", Semicolon: ";", Quote: "'", Comma: ",", Period: ".",
  Slash: "/", Backquote: "`",
};

export function captureKeyCombo(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  code?: string;
}): string {
  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push("cmd");
  // Printable symbols already include Shift (for example ? and +).
  const key = event.altKey && event.code && PHYSICAL_PUNCTUATION[event.code]
    ? PHYSICAL_PUNCTUATION[event.code]
    : event.key;
  if (event.shiftKey && !isShiftedSymbol(key)) parts.push("shift");
  if (event.altKey) parts.push("alt");
  parts.push(normalizeKey(key));
  return parts.join("+");
}

function isShiftedSymbol(key: string): boolean {
  return key.length === 1 && /[~!@#$%^&*()_+{}|:"<>?]/.test(key);
}

function hasShortcutFocus(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0] ?? event.target;
  if (!(target instanceof Element)) return true;
  if (
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="slider"], [role="spinbutton"], [role="listbox"], [role="menu"], [data-editor-shortcuts="off"]',
    )
  ) return false;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return false;
  // Let focused controls keep their native keyboard activation/navigation.
  const control = target.closest('button, a[href], [role="button"], [role="tab"]');
  if (control) {
    const timelineItem = control.matches('[role="button"]:not(button)') && control.closest('[data-tour="timeline"]');
    if ([" ", "Enter"].includes(event.key)) return false;
    if (!timelineItem && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return false;
  }
  return true;
}

function formatKeyCombo(combo: {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}): string {
  const parts: string[] = [];
  const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  if (combo.meta || combo.ctrl) parts.push(isMac ? "⌘" : "Ctrl");
  if (combo.shift) parts.push(isMac ? "⇧" : "Shift");
  if (combo.alt) parts.push(isMac ? "⌥" : "Alt");

  const keyMap: Record<string, string> = {
    space: "Space",
    arrowleft: "←",
    arrowright: "→",
    arrowup: "↑",
    arrowdown: "↓",
    delete: isMac ? "⌫" : "Delete",
    backspace: isMac ? "⌫" : "Backspace",
    escape: "Esc",
    enter: "↵",
    tab: "⇥",
    home: "Home",
    end: "End",
  };

  parts.push(keyMap[combo.key] || combo.key.toUpperCase());
  return parts.join(isMac ? "" : "+");
}

type DisplayKeys = { nameKey: Parameters<typeof editorMessage>[0]; descriptionKey: Parameters<typeof editorMessage>[0] };
type ShortcutRecord = Omit<ShortcutDefinition, "name" | "description"> & DisplayKeys;
type PresetRecord = Omit<ShortcutPreset, "name" | "description"> & DisplayKeys;

function shortcutDisplay(shortcut: ShortcutRecord): ShortcutDefinition {
  const { nameKey, descriptionKey, ...data } = shortcut;
  return { ...data, name: editorMessage(nameKey), description: editorMessage(descriptionKey) };
}

const DEFAULT_SHORTCUTS: ShortcutRecord[] = [
  {
    id: "playback.playPause",
    nameKey: "editor.shortcuts.action.playback.playPause",
    descriptionKey: "editor.shortcuts.action.playback.playPause.description",
    category: "playback",
    defaultKey: "space",
    currentKey: "space",
    action: "playback.playPause",
    enabled: true,
  },
  {
    id: "playback.frameBack",
    nameKey: "editor.shortcuts.action.playback.frameBack",
    descriptionKey: "editor.shortcuts.action.playback.frameBack.description",
    category: "playback",
    defaultKey: "arrowleft",
    currentKey: "arrowleft",
    action: "playback.frameBack",
    enabled: true,
  },
  {
    id: "playback.frameForward",
    nameKey: "editor.shortcuts.action.playback.frameForward",
    descriptionKey: "editor.shortcuts.action.playback.frameForward.description",
    category: "playback",
    defaultKey: "arrowright",
    currentKey: "arrowright",
    action: "playback.frameForward",
    enabled: true,
  },
  {
    id: "playback.secondBack",
    nameKey: "editor.shortcuts.action.playback.secondBack",
    descriptionKey: "editor.shortcuts.action.playback.secondBack.description",
    category: "playback",
    defaultKey: "shift+arrowleft",
    currentKey: "shift+arrowleft",
    action: "playback.secondBack",
    enabled: true,
  },
  {
    id: "playback.secondForward",
    nameKey: "editor.shortcuts.action.playback.secondForward",
    descriptionKey: "editor.shortcuts.action.playback.secondForward.description",
    category: "playback",
    defaultKey: "shift+arrowright",
    currentKey: "shift+arrowright",
    action: "playback.secondForward",
    enabled: true,
  },
  {
    id: "playback.jump5Back",
    nameKey: "editor.shortcuts.action.playback.jump5Back",
    descriptionKey: "editor.shortcuts.action.playback.jump5Back.description",
    category: "playback",
    defaultKey: "arrowup",
    currentKey: "arrowup",
    action: "playback.jump5Back",
    enabled: true,
  },
  {
    id: "playback.jump5Forward",
    nameKey: "editor.shortcuts.action.playback.jump5Forward",
    descriptionKey: "editor.shortcuts.action.playback.jump5Forward.description",
    category: "playback",
    defaultKey: "arrowdown",
    currentKey: "arrowdown",
    action: "playback.jump5Forward",
    enabled: true,
  },
  {
    id: "playback.goToStart",
    nameKey: "editor.shortcuts.action.playback.goToStart",
    descriptionKey: "editor.shortcuts.action.playback.goToStart.description",
    category: "playback",
    defaultKey: "home",
    currentKey: "home",
    action: "playback.goToStart",
    enabled: true,
  },
  {
    id: "playback.goToEnd",
    nameKey: "editor.shortcuts.action.playback.goToEnd",
    descriptionKey: "editor.shortcuts.action.playback.goToEnd.description",
    category: "playback",
    defaultKey: "end",
    currentKey: "end",
    action: "playback.goToEnd",
    enabled: true,
  },
  {
    id: "playback.prevClip",
    nameKey: "editor.shortcuts.action.playback.prevClip",
    descriptionKey: "editor.shortcuts.action.playback.prevClip.description",
    category: "playback",
    defaultKey: "[",
    currentKey: "[",
    action: "playback.prevClip",
    enabled: true,
  },
  {
    id: "playback.nextClip",
    nameKey: "editor.shortcuts.action.playback.nextClip",
    descriptionKey: "editor.shortcuts.action.playback.nextClip.description",
    category: "playback",
    defaultKey: "]",
    currentKey: "]",
    action: "playback.nextClip",
    enabled: true,
  },
  {
    id: "playback.markLoopStart",
    nameKey: "editor.shortcuts.action.playback.markLoopStart",
    descriptionKey: "editor.shortcuts.action.playback.markLoopStart.description",
    category: "playback",
    defaultKey: "i",
    currentKey: "i",
    action: "playback.markLoopStart",
    enabled: true,
  },
  {
    id: "playback.markLoopEnd",
    nameKey: "editor.shortcuts.action.playback.markLoopEnd",
    descriptionKey: "editor.shortcuts.action.playback.markLoopEnd.description",
    category: "playback",
    defaultKey: "o",
    currentKey: "o",
    action: "playback.markLoopEnd",
    enabled: true,
  },
  {
    id: "playback.toggleLoop",
    nameKey: "editor.shortcuts.action.playback.toggleLoop",
    descriptionKey: "editor.shortcuts.action.playback.toggleLoop.description",
    category: "playback",
    defaultKey: "shift+l",
    currentKey: "shift+l",
    action: "playback.toggleLoop",
    enabled: true,
  },
  {
    id: "editing.undo",
    nameKey: "editor.shortcuts.action.editing.undo",
    descriptionKey: "editor.shortcuts.action.editing.undo.description",
    category: "editing",
    defaultKey: "cmd+z",
    currentKey: "cmd+z",
    action: "editing.undo",
    enabled: true,
  },
  {
    id: "editing.redo",
    nameKey: "editor.shortcuts.action.editing.redo",
    descriptionKey: "editor.shortcuts.action.editing.redo.description",
    category: "editing",
    defaultKey: "cmd+shift+z",
    currentKey: "cmd+shift+z",
    action: "editing.redo",
    enabled: true,
  },
  {
    id: "editing.cut",
    nameKey: "editor.shortcuts.action.editing.cut",
    descriptionKey: "editor.shortcuts.action.editing.cut.description",
    category: "editing",
    defaultKey: "cmd+x",
    currentKey: "cmd+x",
    action: "editing.cut",
    enabled: true,
  },
  {
    id: "editing.copy",
    nameKey: "editor.shortcuts.action.editing.copy",
    descriptionKey: "editor.shortcuts.action.editing.copy.description",
    category: "editing",
    defaultKey: "cmd+c",
    currentKey: "cmd+c",
    action: "editing.copy",
    enabled: true,
  },
  {
    id: "editing.paste",
    nameKey: "editor.shortcuts.action.editing.paste",
    descriptionKey: "editor.shortcuts.action.editing.paste.description",
    category: "editing",
    defaultKey: "cmd+v",
    currentKey: "cmd+v",
    action: "editing.paste",
    enabled: true,
  },
  {
    id: "editing.duplicate",
    nameKey: "editor.shortcuts.action.editing.duplicate",
    descriptionKey: "editor.shortcuts.action.editing.duplicate.description",
    category: "editing",
    defaultKey: "cmd+d",
    currentKey: "cmd+d",
    action: "editing.duplicate",
    enabled: true,
  },
  {
    id: "editing.delete",
    nameKey: "editor.shortcuts.action.editing.delete",
    descriptionKey: "editor.shortcuts.action.editing.delete.description",
    category: "editing",
    defaultKey: "delete",
    currentKey: "delete",
    action: "editing.delete",
    enabled: true,
  },
  {
    id: "editing.rippleDelete",
    nameKey: "editor.shortcuts.action.editing.rippleDelete",
    descriptionKey: "editor.shortcuts.action.editing.rippleDelete.description",
    category: "editing",
    defaultKey: "shift+delete",
    currentKey: "shift+delete",
    action: "editing.rippleDelete",
    enabled: true,
  },
  {
    id: "editing.split",
    nameKey: "editor.shortcuts.action.editing.split",
    descriptionKey: "editor.shortcuts.action.editing.split.description",
    category: "editing",
    defaultKey: "s",
    currentKey: "s",
    action: "editing.split",
    enabled: true,
  },
  {
    id: "editing.trimStart",
    nameKey: "editor.shortcuts.action.editing.trimStart",
    descriptionKey: "editor.shortcuts.action.editing.trimStart.description",
    category: "editing",
    defaultKey: "q",
    currentKey: "q",
    action: "editing.trimStart",
    enabled: true,
  },
  {
    id: "editing.trimEnd",
    nameKey: "editor.shortcuts.action.editing.trimEnd",
    descriptionKey: "editor.shortcuts.action.editing.trimEnd.description",
    category: "editing",
    defaultKey: "w",
    currentKey: "w",
    action: "editing.trimEnd",
    enabled: true,
  },
  {
    id: "selection.selectAll",
    nameKey: "editor.shortcuts.action.selection.selectAll",
    descriptionKey: "editor.shortcuts.action.selection.selectAll.description",
    category: "selection",
    defaultKey: "cmd+a",
    currentKey: "cmd+a",
    action: "selection.selectAll",
    enabled: true,
  },
  {
    id: "selection.deselect",
    nameKey: "editor.shortcuts.action.selection.deselect",
    descriptionKey: "editor.shortcuts.action.selection.deselect.description",
    category: "selection",
    defaultKey: "escape",
    currentKey: "escape",
    action: "selection.deselect",
    enabled: true,
  },
  {
    id: "timeline.toggleSnap",
    nameKey: "editor.shortcuts.action.timeline.toggleSnap",
    descriptionKey: "editor.shortcuts.action.timeline.toggleSnap.description",
    category: "timeline",
    defaultKey: "n",
    currentKey: "n",
    action: "timeline.toggleSnap",
    enabled: true,
  },
  {
    id: "timeline.zoomIn",
    nameKey: "editor.shortcuts.action.timeline.zoomIn",
    descriptionKey: "editor.shortcuts.action.timeline.zoomIn.description",
    category: "timeline",
    defaultKey: "cmd+=",
    currentKey: "cmd+=",
    action: "timeline.zoomIn",
    enabled: true,
  },
  {
    id: "timeline.zoomOut",
    nameKey: "editor.shortcuts.action.timeline.zoomOut",
    descriptionKey: "editor.shortcuts.action.timeline.zoomOut.description",
    category: "timeline",
    defaultKey: "cmd+-",
    currentKey: "cmd+-",
    action: "timeline.zoomOut",
    enabled: true,
  },
  {
    id: "timeline.fitTimeline",
    nameKey: "editor.shortcuts.action.timeline.fitTimeline",
    descriptionKey: "editor.shortcuts.action.timeline.fitTimeline.description",
    category: "timeline",
    defaultKey: "cmd+0",
    currentKey: "cmd+0",
    action: "timeline.fitTimeline",
    enabled: true,
  },
  {
    id: "view.showShortcuts",
    nameKey: "editor.shortcuts.action.view.showShortcuts",
    descriptionKey: "editor.shortcuts.action.view.showShortcuts.description",
    category: "view",
    defaultKey: "?",
    currentKey: "?",
    action: "view.showShortcuts",
    enabled: true,
  },
  {
    id: "file.save",
    nameKey: "editor.shortcuts.action.file.save",
    descriptionKey: "editor.shortcuts.action.file.save.description",
    category: "file",
    defaultKey: "cmd+s",
    currentKey: "cmd+s",
    action: "file.save",
    enabled: true,
  },
  {
    id: "file.export",
    nameKey: "editor.shortcuts.action.file.export",
    descriptionKey: "editor.shortcuts.action.file.export.description",
    category: "file",
    defaultKey: "cmd+e",
    currentKey: "cmd+e",
    action: "file.export",
    enabled: true,
  },
  {
    id: "tools.addText",
    nameKey: "editor.shortcuts.action.tools.addText",
    descriptionKey: "editor.shortcuts.action.tools.addText.description",
    category: "tools",
    defaultKey: "t",
    currentKey: "t",
    action: "tools.addText",
    enabled: true,
  },
  {
    id: "tools.addMarker",
    nameKey: "editor.shortcuts.action.tools.addMarker",
    descriptionKey: "editor.shortcuts.action.tools.addMarker.description",
    category: "tools",
    defaultKey: "m",
    currentKey: "m",
    action: "tools.addMarker",
    enabled: true,
  },
];

const PRESETS: PresetRecord[] = [
  {
    id: "openreel",
    nameKey: "editor.shortcuts.preset.openreel",
    descriptionKey: "editor.shortcuts.preset.openreel.description",
    shortcuts: {},
  },
  {
    id: "capcut",
    nameKey: "editor.shortcuts.preset.capcut",
    descriptionKey: "editor.shortcuts.preset.capcut.description",
    shortcuts: {
      "editing.split": "ctrl+b",
      "playback.playPause": "space",
      "editing.delete": "delete",
    },
  },
  {
    id: "premiere",
    nameKey: "editor.shortcuts.preset.premiere",
    descriptionKey: "editor.shortcuts.preset.premiere.description",
    shortcuts: {
      "editing.split": "cmd+k",
      "playback.playPause": "space",
      "playback.frameBack": "arrowleft",
      "playback.frameForward": "arrowright",
      "editing.rippleDelete": "shift+delete",
    },
  },
  {
    id: "finalcut",
    nameKey: "editor.shortcuts.preset.finalcut",
    descriptionKey: "editor.shortcuts.preset.finalcut.description",
    shortcuts: {
      "editing.split": "cmd+b",
      "playback.playPause": "space",
      "editing.trimStart": "[",
      "editing.trimEnd": "]",
    },
  },
  {
    id: "davinci",
    nameKey: "editor.shortcuts.preset.davinci",
    descriptionKey: "editor.shortcuts.preset.davinci.description",
    shortcuts: {
      "editing.split": "cmd+\\",
      "playback.playPause": "space",
      "editing.rippleDelete": "shift+backspace",
    },
  },
];

class KeyboardShortcutsManager {
  private shortcuts: Map<string, ShortcutRecord> = new Map();
  private handlers: Map<string, Set<ShortcutHandler>> = new Map();
  private activePreset: string = "openreel";
  private isListening: boolean = false;

  constructor() {
    this.loadShortcuts();
    this.loadPreset();
  }

  private loadShortcuts(): void {
    let customizations: Record<string, unknown> = {};
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed: unknown = saved ? JSON.parse(saved) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        customizations = parsed as Record<string, unknown>;
      }
    } catch {
      // Storage may be unavailable or a previous customization may be corrupt.
    }

    DEFAULT_SHORTCUTS.forEach((shortcut) => {
      const customKey = customizations[shortcut.id];
      this.shortcuts.set(shortcut.id, {
        ...shortcut,
        currentKey: typeof customKey === "string" && customKey
          ? customKey
          : shortcut.defaultKey,
      });
    });
  }

  private loadPreset(): void {
    try {
      const saved = localStorage.getItem(PRESET_KEY);
      if (PRESETS.some((preset) => preset.id === saved)) this.activePreset = saved!;
    } catch { /* In-memory shortcuts still work when storage is unavailable. */ }
  }

  private saveShortcuts(): void {
    const customizations: Record<string, string> = {};
    this.shortcuts.forEach((shortcut, id) => {
      if (shortcut.currentKey !== shortcut.defaultKey) {
        customizations[id] = shortcut.currentKey;
      }
    });
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(customizations));
    } catch { /* Keep the customization active for this session. */ }
  }

  private savePreset(): void {
    try {
      localStorage.setItem(PRESET_KEY, this.activePreset);
    } catch { /* Keep the preset active for this session. */ }
  }

  startListening(): void {
    if (this.isListening) return;
    this.isListening = true;
    window.addEventListener("keydown", this.handleKeyDown);
  }

  stopListening(): void {
    if (!this.isListening) return;
    this.isListening = false;
    window.removeEventListener("keydown", this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229 || !hasShortcutFocus(e)) return;
    if (document.querySelector('[aria-modal="true"]:not([data-state="closed"])')) return;

    const matchedShortcut = this.findMatchingShortcut(e);
    if (matchedShortcut && this.handlers.get(matchedShortcut.action)?.size) {
      e.preventDefault();
      e.stopPropagation();
      // Holding a key may scrub/zoom continuously, but must not repeat edits,
      // toggle playback, add markers, or open dialogs repeatedly.
      if (e.repeat && !/^(playback\.(frame|second|jump5|prevClip|nextClip)|timeline\.zoom)/.test(matchedShortcut.action)) return;
      this.executeAction(matchedShortcut.action, e);
    }
  };

  private findMatchingShortcut(e: KeyboardEvent): ShortcutDefinition | null {
    const isMeta = e.metaKey || e.ctrlKey;

    for (const shortcut of this.shortcuts.values()) {
      if (!shortcut.enabled) continue;

      const combo = parseKeyCombo(shortcut.currentKey);
      const eventKey = normalizeKey(e.key);
      const keyMatches =
        eventKey === combo.key || e.code.toLowerCase() === combo.key ||
        (e.altKey && PHYSICAL_PUNCTUATION[e.code] === combo.key) ||
        (eventKey === "backspace" && combo.key === "delete");
      const metaMatches = (combo.meta || combo.ctrl) === isMeta;
      const shiftMatches = combo.shift === e.shiftKey ||
        (!combo.shift && e.shiftKey && isShiftedSymbol(combo.key) && eventKey === combo.key);
      const altMatches = combo.alt === e.altKey;

      if (keyMatches && metaMatches && shiftMatches && altMatches) {
        return shortcutDisplay(shortcut);
      }
    }

    return null;
  }

  private executeAction(action: string, e: KeyboardEvent): void {
    const handlers = this.handlers.get(action);
    if (handlers) {
      handlers.forEach((handler) => handler(e));
    }
  }

  registerHandler(action: string, handler: ShortcutHandler): () => void {
    if (!this.handlers.has(action)) {
      this.handlers.set(action, new Set());
    }
    this.handlers.get(action)!.add(handler);

    return () => {
      this.handlers.get(action)?.delete(handler);
    };
  }

  getShortcut(id: string): ShortcutDefinition | undefined {
    const shortcut = this.shortcuts.get(id);
    return shortcut ? shortcutDisplay(shortcut) : undefined;
  }

  getAllShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values(), shortcutDisplay);
  }

  getShortcutsByCategory(category: ShortcutCategory): ShortcutDefinition[] {
    return this.getAllShortcuts().filter((s) => s.category === category);
  }

  setShortcut(id: string, key: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut) return false;

    const conflict = this.findConflict(key, id);
    if (conflict) return false;

    this.shortcuts.set(id, { ...shortcut, currentKey: key });
    this.saveShortcuts();
    return true;
  }

  resetShortcut(id: string): boolean {
    const shortcut = this.shortcuts.get(id);
    if (shortcut) {
      if (this.findConflict(shortcut.defaultKey, id)) return false;
      this.shortcuts.set(id, { ...shortcut, currentKey: shortcut.defaultKey });
      this.saveShortcuts();
      return true;
    }
    return false;
  }

  resetAllShortcuts(): void {
    this.shortcuts.forEach((shortcut, id) => {
      this.shortcuts.set(id, { ...shortcut, currentKey: shortcut.defaultKey });
    });
    this.saveShortcuts();
    this.activePreset = "openreel";
    this.savePreset();
  }

  findConflict(key: string, excludeId?: string): ShortcutDefinition | null {
    for (const [id, shortcut] of this.shortcuts) {
      if (id === excludeId) continue;
      if (comboIdentity(shortcut.currentKey) === comboIdentity(key)) {
        return shortcutDisplay(shortcut);
      }
    }
    return null;
  }

  getPresets(): ShortcutPreset[] {
    return PRESETS.map(({ nameKey, descriptionKey, ...data }) => ({ ...data, name: editorMessage(nameKey), description: editorMessage(descriptionKey) }));
  }

  getActivePreset(): string {
    return this.activePreset;
  }

  applyPreset(presetId: string): void {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;

    this.resetAllShortcuts();

    Object.entries(preset.shortcuts).forEach(([id, key]) => {
      // A preset override takes precedence over the default binding it replaces.
      // Relocate that command so both remain accessible (Final Cut uses [ / ]
      // for trimming, while OpenReel uses those keys for clip navigation).
      const conflict = this.findConflict(key, id);
      if (conflict) {
        const alternative = `alt+${conflict.defaultKey}`;
        this.shortcuts.set(conflict.id, {
          ...this.shortcuts.get(conflict.id)!,
          currentKey: this.findConflict(alternative, conflict.id) ? "" : alternative,
        });
      }
      const shortcut = this.shortcuts.get(id);
      if (shortcut) {
        this.shortcuts.set(id, { ...shortcut, currentKey: key });
      }
    });

    this.activePreset = presetId;
    this.saveShortcuts();
    this.savePreset();
  }

  formatShortcut(id: string): string {
    const shortcut = this.shortcuts.get(id);
    if (!shortcut?.currentKey) return "";
    const combo = parseKeyCombo(shortcut.currentKey);
    return formatKeyCombo(combo);
  }

  getCategories(): ShortcutCategory[] {
    return [
      "playback",
      "editing",
      "selection",
      "timeline",
      "view",
      "file",
      "tools",
    ];
  }

  getCategoryName(category: ShortcutCategory): string {
    const names: Record<ShortcutCategory, Parameters<typeof editorMessage>[0]> = {
      playback: "editor.shortcuts.category.playback",
      editing: "editor.shortcuts.category.editing",
      selection: "editor.shortcuts.category.selection",
      timeline: "editor.shortcuts.category.timeline",
      view: "editor.shortcuts.category.view",
      file: "editor.shortcuts.category.file",
      tools: "editor.shortcuts.category.tools",
    };
    return editorMessage(names[category]);
  }
}

export const keyboardShortcuts = new KeyboardShortcutsManager();

export function formatKeyComboDisplay(key: string): string {
  const combo = parseKeyCombo(key);
  return formatKeyCombo(combo);
}
