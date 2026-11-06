import { App } from "antd";
import { useEffect } from "react";
import { registerConfirmHandler, type ConfirmRequest } from "./confirmService";

/**
 * 把 App.useApp() 的 modal 上下文登记给非 React 模块。
 * 不渲染 DOM；确认框本身仍由 antd 管理。
 */
export function ConfirmHost() {
  const { modal } = App.useApp();

  useEffect(() => registerConfirmHandler((request: ConfirmRequest) =>
    new Promise<boolean>((resolve) => {
      modal.confirm({
        title: request.title,
        ...(request.okText ? { okText: request.okText } : {}),
        ...(request.cancelText ? { cancelText: request.cancelText } : {}),
        ...(request.danger ? { okButtonProps: { danger: true } } : {}),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    })), [modal]);

  return null;
}
