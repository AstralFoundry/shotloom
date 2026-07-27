import { useOverlayStore } from "../store/overlayStore";

export function ToastHost() {
  const toast = useOverlayStore((state) => state.toast);
  return toast ? <div className="toast" role="status">{toast}</div> : null;
}
