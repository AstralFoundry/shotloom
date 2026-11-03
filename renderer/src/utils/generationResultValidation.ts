import { t } from '../i18n/index.ts';
type AnyRecord = Record<string, any>;

export function hasMeaningfulGeneratedOutput(nodeType: string, archived: AnyRecord = {}) {
  if (nodeType === 'textGeneration') return Boolean(String(archived.text || '').trim());
  // 图片/视频/音频必须真的落盘为媒体素材；文本节点不能冒充媒体成功。
  return Boolean(archived.archivedFiles?.length);
}

export function generationOutputIssue(
  nodeType: string,
  remote: AnyRecord = {},
  archived: AnyRecord = {},
): { code: string; message: string } | null {
  if (hasMeaningfulGeneratedOutput(nodeType, archived)) return null;

  const completion = remote.result?.raw || remote.raw?.result?.raw || remote.raw?.raw || remote.raw;
  const choice = completion?.choices?.[0];
  const reasoningTokens = Number(completion?.usage?.completion_tokens_details?.reasoning_tokens) || 0;
  const completionTokens = Number(completion?.usage?.completion_tokens) || 0;
  if (nodeType === 'textGeneration' && choice?.finish_reason === 'length') {
    const tokenDetail = reasoningTokens
      ? t("generation.output.reasoningUsage", { reasoning: reasoningTokens, total: completionTokens || reasoningTokens })
      : t("generation.output.tokenLimit");
    return {
      code: 'empty-text-length',
      message: t("generation.output.emptyAtLimit", { detail: tokenDetail }),
    };
  }
  return nodeType === 'textGeneration'
    ? { code: 'empty-text', message: t("generation.output.emptyText") }
    : { code: 'empty-media', message: t("generation.output.emptyMedia") };
}

export function generationOutputError(nodeType: string, remote: AnyRecord = {}, archived: AnyRecord = {}) {
  return generationOutputIssue(nodeType, remote, archived)?.message || '';
}
