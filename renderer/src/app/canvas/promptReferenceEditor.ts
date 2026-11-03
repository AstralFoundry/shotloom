import { t } from '@/i18n';
import { convertFileSrc } from "@tauri-apps/api/core";
import type { WorkflowIncomingInput } from "./WorkflowCanvas";
import { generationMediaKind } from "./generationNodeMedia";

export interface PromptReference {
  alias: string;
  nodeId: string;
}

export interface PromptToken {
  type: "text" | "reference";
  value: string;
  alias?: string;
  nodeId?: string;
}

// 别名之后只有继续拼标识符的字符才算没写完；中文、空格和标点都是结束边界。
// 早先按 `\s|\p{P}` 判定，把「参考@图1的形象」这类最常见的中文写法判成普通文本。
const aliasContinuation = /[A-Za-z0-9_.@-]/;

export function tokenizePrompt(prompt: string, references: PromptReference[]): PromptToken[] {
  const aliases = [...references]
    .filter((item) => item.alias && item.nodeId)
    .sort((a, b) => b.alias.length - a.alias.length);
  const tokens: PromptToken[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = tokens[tokens.length - 1];
    if (last?.type === "text") last.value += value;
    else tokens.push({ type: "text", value });
  };
  let cursor = 0;
  while (cursor < prompt.length) {
    const at = prompt.indexOf("@", cursor);
    if (at < 0) { pushText(prompt.slice(cursor)); break; }
    const found = aliases.find((item) => prompt.startsWith(`@${item.alias}`, at)
      && !aliasContinuation.test(prompt[at + item.alias.length + 1] || ""));
    if (!found) { pushText(prompt.slice(cursor, at + 1)); cursor = at + 1; continue; }
    pushText(prompt.slice(cursor, at));
    tokens.push({ type: "reference", value: `@${found.alias}`, alias: found.alias, nodeId: found.nodeId });
    cursor = at + found.alias.length + 1;
  }
  return tokens;
}

function tokenText(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).map(tokenText).join("");
  if (node.dataset.refAlias) return `@${node.dataset.refAlias}`;
  if (node.tagName === "BR") return "\n";
  const contents = Array.from(node.childNodes).map(tokenText).join("");
  return node.tagName === "DIV" ? `\n${contents}` : contents;
}

export function editorPrompt(element: HTMLElement): string {
  return Array.from(element.childNodes).map(tokenText).join("").replace(/^\n/, "");
}

function referencePreview(input: WorkflowIncomingInput): string {
  const remote = String(input.previewUrl || input.url || "");
  if (remote) return remote;
  const path = String(input.filePath || input.path || "");
  if (!path) return "";
  try { return convertFileSrc(path); } catch { return ""; }
}

export function referenceLabels(inputs: WorkflowIncomingInput[]) {
  const counts = { image: 0, video: 0, audio: 0 };
  return inputs.filter((input) => input.skipTaskInput !== true).map((input) => {
    const kind = input.inputRole === "referenceImage" ? "image"
      : input.inputRole === "inputVideo" ? "video"
        : input.inputRole === "referenceAudio" ? "audio" : generationMediaKind(input);
    if (kind === "image" || kind === "video" || kind === "audio") {
      counts[kind] += 1;
      return { nodeId: input.nodeId, kind, number: counts[kind], input };
    }
    return { nodeId: input.nodeId, kind, number: 0, input };
  });
}

export function renderPromptEditor(element: HTMLElement, prompt: string, references: PromptReference[], inputs: WorkflowIncomingInput[]) {
  const labels = referenceLabels(inputs);
  const parts: Node[] = [];
  for (const token of tokenizePrompt(prompt, references)) {
    if (token.type === "text") {
      parts.push(document.createTextNode(token.value));
      continue;
    }
    const alias = String(token.alias);
    const linked = labels.find((item) => item.nodeId === token.nodeId);
    const chip = document.createElement("span");
    chip.className = `work-reference-chip${linked ? "" : " work-reference-chip--missing"}`;
    chip.contentEditable = "false";
    chip.dataset.refAlias = alias;
    chip.title = linked?.input.name || t("ui.promptReferenceEditor.text.ffac72d3", { value0: alias });
    const thumb = document.createElement("span");
    thumb.className = "work-reference-chip-thumb";
    const url = linked ? referencePreview(linked.input) : "";
    if (url && linked?.kind === "image") {
      const image = document.createElement("img");
      image.src = url;
      image.alt = "";
      thumb.append(image);
    } else {
      thumb.textContent = linked?.kind === "video" ? "▶" : linked?.kind === "audio" ? "♫" : "▧";
    }
    chip.append(thumb, document.createTextNode(linked
      ? t("ui.promptReferenceEditor.text.dca59cc0", { value0: linked.kind === "image" ? t("ui.canvasMediaActions.text.be8da62e") : linked.kind === "video" ? t("ui.canvasMediaActions.text.fa4e33b6") : t("ui.canvasAdapter.label.461189f1"), value1: linked.number })
      : t("ui.promptReferenceEditor.text.8a53c82e")));
    parts.push(chip);
  }
  element.replaceChildren(...parts);
}

export function editorCaretOffset(element: HTMLElement): number {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !element.contains(selection.anchorNode)) return editorPrompt(element).length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(element);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return Array.from(range.cloneContents().childNodes).map(tokenText).join("").replace(/^\n/, "").length;
}

export function setEditorCaret(element: HTMLElement, offset: number) {
  const leaves: Node[] = [];
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE || (node instanceof HTMLElement && (node.dataset.refAlias || node.tagName === "BR"))) {
      leaves.push(node);
      return;
    }
    node.childNodes.forEach(visit);
  };
  element.childNodes.forEach(visit);
  const range = document.createRange();
  let remaining = Math.max(0, offset);
  let placed = false;
  for (const leaf of leaves) {
    const length = tokenText(leaf).length;
    if (remaining > length) { remaining -= length; continue; }
    if (leaf.nodeType === Node.TEXT_NODE) range.setStart(leaf, Math.min(remaining, length));
    else if (remaining === 0) range.setStartBefore(leaf);
    else range.setStartAfter(leaf);
    placed = true;
    break;
  }
  if (!placed) range.selectNodeContents(element);
  range.collapse(placed ? true : false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}
