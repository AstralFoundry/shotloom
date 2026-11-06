/**
 * 非 React 模块（适配器、窗口关闭守卫）触发确认的桥。
 *
 * 这些模块不能调用 App.useApp()，但也不该退化成浏览器原生 confirm：
 * ConfirmHost 挂载后注册一个基于 antd modal.confirm 的处理器，主题、键盘和
 * 焦点行为与视图层一致。宿主尚未挂载时拒绝操作，避免危险动作被静默放行。
 */
export interface ConfirmRequest {
  title: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmHandler = (request: ConfirmRequest) => Promise<boolean>;

let handler: ConfirmHandler | null = null;

/** 返回解绑函数；宿主卸载时调用，避免保留旧的 modal 上下文。 */
export function registerConfirmHandler(next: ConfirmHandler): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

export function confirmAction(request: ConfirmRequest): Promise<boolean> {
  return handler ? handler(request) : Promise.resolve(false);
}
