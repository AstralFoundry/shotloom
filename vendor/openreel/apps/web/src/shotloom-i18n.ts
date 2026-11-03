import inspectorMessages from "./shotloom-i18n-inspector.json";
import { REFERENCE_I18N } from "./shotloom-i18n-data";
import { SHOTLOOM_I18N_EFFECTS } from "./shotloom-i18n-effects";
import { SHOTLOOM_I18N_EXTRA, SHOTLOOM_I18N_PATTERNS } from "./shotloom-i18n-extra";
import { isShotloomMode, shotloomMessage } from "./shotloom-mode";

/**
 * Shotloom 模式下的中文覆盖层。
 *
 * vendored OpenReel 的界面文案是硬编码英文；重写上游所有组件会让每次升级
 * 都变成一次大规模合并。这里只做"精确词条 + 占位符模式"翻译：
 * - 词典来自参考项目（同为定制版 OpenReel）的完整中英文词典，再补当前版本新增词条；
 * - 只处理文本节点和 title/aria/placeholder/alt，不做模糊替换；
 * - 跳过输入框、可编辑区、代码与用户内容容器，避免把素材名/轨道名误翻。
 *
 * 覆盖层只观察当前编辑器根节点，不影响宿主产品代码。
 */
const DICTIONARY: Record<string, string> = {
  ...REFERENCE_I18N,
  ...SHOTLOOM_I18N_EFFECTS,
  ...SHOTLOOM_I18N_EXTRA,
  ...inspectorMessages,
};

type Pattern = {
  regex: RegExp;
  keys: string[];
  template: string;
};

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePattern(template: string, translation: string): Pattern {
  const keys: string[] = [];
  let source = "";
  for (const part of template.split(/(\{\w+\})/g)) {
    const match = part.match(/^\{(\w+)\}$/);
    if (match) {
      keys.push(match[1]);
      source += "(.+?)";
    } else {
      source += escapeRegex(part);
    }
  }
  return { regex: new RegExp(`^${source}$`), keys, template: translation };
}

function compilePatterns() {
  const patterns: Pattern[] = [];
  for (const [template, translation] of Object.entries(DICTIONARY)) {
    if (/\{\w+\}/.test(template)) patterns.push(compilePattern(template, translation));
  }
  for (const [template, translation] of SHOTLOOM_I18N_PATTERNS) {
    patterns.push(compilePattern(template, translation));
  }
  return patterns;
}

const PATTERNS = compilePatterns();

function applyPattern(pattern: Pattern, values: string[]) {
  // Only section and media type are fixed UI labels. Names and other values belong
  // to user content and must not be looked up in the dictionary.
  return pattern.template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const index = pattern.keys.indexOf(key);
    if (index < 0) return whole;
    const value = values[index] ?? whole;
    return key === "section" || key === "type" ? DICTIONARY[value] ?? value : value;
  });
}

export function translateUiText(input: string): string | null {
  if (!input) return null;
  const match = input.match(/^(\s*)([\s\S]*?)(\s*)$/);
  const leading = match?.[1] ?? "";
  const core = (match?.[2] ?? "").replace(/\s+/g, " ").trim();
  const trailing = match?.[3] ?? "";
  if (!core) return null;
  const direct = DICTIONARY[core];
  if (direct !== undefined) return `${leading}${direct}${trailing}`;
  for (const pattern of PATTERNS) {
    const result = core.match(pattern.regex);
    if (result) {
      return `${leading}${applyPattern(pattern, result.slice(1))}${trailing}`;
    }
  }
  return null;
}

const ATTRIBUTES = [
  "title",
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "placeholder",
  "alt",
];

const SKIP_TAGS = new Set([
  "SCRIPT",
  "STYLE",
  "TEXTAREA",
  "INPUT",
  "CODE",
  "PRE",
  "KBD",
  "SVG",
  "PATH",
  "MATH",
]);

const SKIP_SELECTOR = [
  "[contenteditable='true']",
  "[data-shotloom-i18n='off']",
  "[data-shotloom-user-content]",
  ".timeline-clip",
  ".tl-clip",
  ".clip-label",
  ".clip-name",
  ".track-name",
  ".media-name",
  ".media-thumbnail",
].join(",");

function isSkipped(element: Element | null) {
  if (!element) return false;
  if (SKIP_TAGS.has(element.tagName)) return true;
  return Boolean(element.closest(SKIP_SELECTOR));
}

/**
 * 属性翻译不能沿用文本节点的 SKIP_TAGS：INPUT/TEXTAREA 没有可读的 textContent，
 * 它们的可见文案（placeholder）与 SVG 图标的 aria-label 恰恰只存在于属性上。
 */
const ATTR_SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "KBD", "PATH", "MATH"]);

function isAttributeSkipped(element: Element | null) {
  if (!element) return false;
  if (ATTR_SKIP_TAGS.has(element.tagName)) return true;
  return Boolean(element.closest(SKIP_SELECTOR));
}

function hasLatin(value: string) {
  return /[A-Za-z]{2,}/.test(value);
}

const ATTR_PRESENT_SELECTOR = ATTRIBUTES.map((name) => `[${name}]`).join(",");

function elementHasLatinAttribute(element: Element) {
  const carriers = [element, ...element.querySelectorAll(ATTR_PRESENT_SELECTOR)];
  for (const carrier of carriers) {
    for (const name of ATTRIBUTES) {
      const value = carrier.getAttribute(name);
      if (value && hasLatin(value)) return true;
    }
  }
  return false;
}

function translateTextNode(node: Text) {
  const value = node.nodeValue;
  if (!value || !hasLatin(value)) return;
  if (isSkipped(node.parentElement)) return;
  const translated = translateUiText(value);
  if (translated !== null && translated !== value) node.nodeValue = translated;
}

function translateAttributes(element: Element) {
  if (isAttributeSkipped(element)) return;
  for (const name of ATTRIBUTES) {
    if (!element.hasAttribute(name)) continue;
    const value = element.getAttribute(name);
    if (!value || !hasLatin(value)) continue;
    const translated = translateUiText(value);
    if (translated !== null && translated !== value) element.setAttribute(name, translated);
  }
}

function translateElement(element: Element) {
  translateAttributes(element);
  const root = element as HTMLElement;
  if (!root.querySelectorAll) return;
  for (const child of root.querySelectorAll("*")) translateAttributes(child);
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    translateTextNode(node as Text);
    node = walker.nextNode();
  }
}

let scheduled = false;
let frame: number | null = null;
const dirtyRoots = new Set<Element>();
let observer: MutationObserver | null = null;

function flush() {
  frame = null;
  scheduled = false;
  const roots = dirtyRoots.size ? [...dirtyRoots] : [document.body];
  dirtyRoots.clear();
  for (const root of roots) {
    if (!root.isConnected) continue;
    try {
      translateElement(root);
    } catch (error) {
      console.warn("[shotloom-i18n] translate failed", error);
    }
  }
}

function schedule(root?: Element | null) {
  if (root) dirtyRoots.add(root);
  if (scheduled) return;
  scheduled = true;
  frame = requestAnimationFrame(flush);
}

function onMutations(mutations: MutationRecord[]) {
  for (const mutation of mutations) {
    if (mutation.type === "characterData") {
      const value = mutation.target.nodeValue || "";
      if (hasLatin(value)) schedule(mutation.target.parentElement);
      continue;
    }
    if (mutation.type === "attributes") {
      if (mutation.target instanceof Element) schedule(mutation.target);
      continue;
    }
    for (const node of mutation.addedNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (hasLatin(node.nodeValue || "")) schedule(mutation.target instanceof Element ? mutation.target : document.body);
      } else if (node instanceof Element) {
        // 只有属性的节点（输入框、纯图标按钮）没有 textContent，必须单独探测。
        if (hasLatin(node.textContent || "") || elementHasLatinAttribute(node)) schedule(node);
      }
    }
  }
}

export function installShotloomI18n() {
  if (!isShotloomMode || typeof window === "undefined") return;
  document.documentElement.lang = "zh-CN";
  document.title = shotloomMessage("ui.ReactWorkbench.text.3d65ff77");
  stopShotloomI18n();
  const start = () => {
    if (!document.body) return;
    translateElement(document.body);
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRIBUTES,
    });
    (window as unknown as { __shotloomI18nAudit?: () => unknown }).__shotloomI18nAudit = auditUntranslated;
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

export function auditUntranslated() {
  const counts = new Map<string, number>();
  const add = (value: string, source: "text" | "attr") => {
    if (!hasLatin(value)) return;
    if (/^https?:|^blob:|^data:|^[0-9:.,%\s]+$/.test(value)) return;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized || translateUiText(normalized) !== null) return;
    if (normalized.length < 2 || normalized.length > 160) return;
    const key = `${source}:${normalized}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const element = node.parentElement;
    if (element && !isSkipped(element)) add(node.nodeValue || "", "text");
    node = walker.nextNode();
  }
  for (const element of document.body.querySelectorAll("*")) {
    if (isSkipped(element)) continue;
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value) add(value, "attr");
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 300)
    .map(([key, count]) => ({ key, count }));
}

export function stopShotloomI18n() {
  observer?.disconnect();
  observer = null;
  if (frame !== null) cancelAnimationFrame(frame);
  frame = null;
  scheduled = false;
  dirtyRoots.clear();
}
