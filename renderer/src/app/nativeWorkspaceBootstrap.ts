// This is a display hint. Cookie authentication and account binding still protect every API request.
export function readNativeWorkspaceBootstrap(): { userId: string; locale?: string } | undefined {
  if (new URLSearchParams(location.search).get('native') !== 'embedded') return;
  try {
    const value = JSON.parse(window.ReactNativeWebView?.injectedObjectJson?.() || 'null');
    if (typeof value?.userId !== 'string' || !value.userId) return;
    return { userId: value.userId, locale: ['zh-CN', 'en-US'].includes(value.locale) ? value.locale : undefined };
  } catch { return; }
}
