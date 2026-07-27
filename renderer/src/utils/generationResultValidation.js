export function hasMeaningfulGeneratedOutput(nodeType, archived = {}) {
  if (nodeType === 'textGeneration') return Boolean(String(archived.text || '').trim());
  // 图片/视频/音频必须真的落盘为媒体素材；文本说明节点不能冒充媒体成功。
  return Boolean(archived.archivedFiles?.length);
}

export function generationOutputIssue(nodeType, remote = {}, archived = {}) {
  if (hasMeaningfulGeneratedOutput(nodeType, archived)) return null;

  const completion = remote.result?.raw || remote.raw?.result?.raw || remote.raw?.raw || remote.raw;
  const choice = completion?.choices?.[0];
  const reasoningTokens = Number(completion?.usage?.completion_tokens_details?.reasoning_tokens) || 0;
  const completionTokens = Number(completion?.usage?.completion_tokens) || 0;
  if (nodeType === 'textGeneration' && choice?.finish_reason === 'length') {
    const tokenDetail = reasoningTokens
      ? `其中 reasoning 使用 ${reasoningTokens}/${completionTokens || reasoningTokens} token`
      : '输出达到 token 上限';
    return {
      code: 'empty-text-length',
      message: `模型因长度上限结束且没有返回可展示正文（${tokenDetail}）。请提高 maxTokens 或改用非 reasoning 模型后重试。`,
    };
  }
  return nodeType === 'textGeneration'
    ? { code: 'empty-text', message: '远程任务已结束，但模型没有返回可展示文本。请调整提示词、maxTokens 或模型后重试。' }
    : { code: 'empty-media', message: '远程任务已结束，但没有返回可归档和展示的媒体文件。请检查模型响应格式后重试。' };
}

export function generationOutputError(nodeType, remote = {}, archived = {}) {
  return generationOutputIssue(nodeType, remote, archived)?.message || '';
}
