/**
 * 文本编辑器草稿与 Agent 之间的唯一通道。
 *
 * Agent 不直接写节点：写入只落到编辑器当前的未保存草稿，保存仍由用户在编辑器里完成，
 * 因此编辑器始终是文档内容的权威，用户在草稿里的改动不会被 Agent 覆盖。
 */
export interface TextDraftTarget {
  nodeId: string;
  /** 编辑器当前草稿（Markdown）。 */
  read(): string;
  /**
   * 把内容并入草稿。`replace` 只替换整篇，`append` 追加到末尾；
   * 返回写入后的草稿，工具回执据此说明真实变化。
   */
  apply(content: string, mode: 'replace' | 'append'): string;
}

const targets = new Map<string, TextDraftTarget>();

export function registerTextDraftTarget(target: TextDraftTarget): () => void {
  targets.set(target.nodeId, target);
  return () => {
    if (targets.get(target.nodeId) === target) targets.delete(target.nodeId);
  };
}

export function textDraftTarget(nodeId: string): TextDraftTarget | null {
  return targets.get(String(nodeId || '')) || null;
}
