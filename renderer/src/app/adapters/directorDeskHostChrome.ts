import hostChromeCss from './directorDeskHostChrome.css?raw';

export const DIRECTOR_DESK_HOST_CHROME_STYLE_ID = 'shotloom-director-host-chrome';

/**
 * 导演台由 vendor/shotloom-director-desk 独立构建，并通过 iframe 运行。
 * 产品侧的控件尺寸微调写进宿主样式表、在 iframe 加载后注入，避免直接改
 * vendor 源码导致上游同步或 prepare:director-desk 重建时丢失。
 *
 * 注入是幂等的：重复加载/主题切换只会更新同一个 <style>。
 * 非同源 iframe 取不到 contentDocument，此时静默跳过，不影响导演台启动。
 */
export function installDirectorDeskHostChrome(
  frame: HTMLIFrameElement | null | undefined,
): boolean {
  try {
    const document = frame?.contentDocument;
    const head = document?.head;
    if (!document || !head) return false;

    let style = document.getElementById(DIRECTOR_DESK_HOST_CHROME_STYLE_ID);
    if (style?.tagName !== 'STYLE') {
      style?.remove();
      style = document.createElement('style');
      style.id = DIRECTOR_DESK_HOST_CHROME_STYLE_ID;
      head.appendChild(style);
    }
    if (style.textContent !== hostChromeCss) style.textContent = hostChromeCss;
    return true;
  } catch {
    // Safari/WKWebView 在跨域导航瞬间也可能抛 SecurityError。
    return false;
  }
}
