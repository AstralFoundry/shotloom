// The pinned adapter labels every HTTP 403 as AUTH, including new-api quota errors.
export function isGatewayQuotaFailure(message) {
  if (typeof message !== 'string') return false;
  const start = message.indexOf('{');
  if (start < 0) return false;
  try {
    const body = JSON.parse(message.slice(start));
    return body?.code === 'insufficient_user_quota' || body?.error?.code === 'insufficient_user_quota';
  } catch { return false; }
}

export function adaptGatewayFailureUi(id, source) {
  const chat = id === '@deepseek-ai/dsh-client-ui-chat';
  if (!chat && id !== '@deepseek-ai/dsh-client-ui-trajectory') return source;
  const key = chat ? 'message.failure' : 'details.failure';
  const marker = chat
    ? 'return code === "AUTH" ? t("message.failure.auth") : message;'
    : 'if (request.errorCode === "AUTH") return t("details.failure.auth");';
  const message = chat ? 'message' : 'request.error';
  const code = chat ? 'code' : 'request.errorCode';
  const projection = 'if (code === "AUTH") return {';
  if (source.split(projection).length !== 2) throw new Error('Official failure projection seam changed; review gateway quota handling');
  source = source.replace('function displayFailure(failure) {', `${isGatewayQuotaFailure.toString()}\nfunction displayFailure(failure) {`);
  source = source.replace(projection, `if (isGatewayQuotaFailure(record.message)) return { code: 'SHOTLOOM_QUOTA', message: '' };\n${projection}`);
  if (source.split(marker).length !== 2) throw new Error('Official failure presentation seam changed; review gateway quota handling');
  source = source.replace(marker, `if (${code} === 'SHOTLOOM_QUOTA' || isGatewayQuotaFailure(${message})) return t('${key}.shotloomQuota');\n${marker}`);
  for (const [auth, quota] of [
    ['API 密钥无效', '账户余额不足，请前往「我的」充值后重试。'],
    ['API key is invalid', 'Insufficient balance. Open My account to top up, then retry.'],
  ]) {
    const entry = `"${key}.auth": "${auth}",`;
    if (source.split(entry).length !== 2) throw new Error('Official failure locale seam changed');
    source = source.replace(entry, `${entry}\n"${key}.shotloomQuota": ${JSON.stringify(quota)},`);
  }
  return source;
}
