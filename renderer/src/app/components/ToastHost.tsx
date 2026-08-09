import { useOverlayStore } from "../store/overlayStore";

export function ToastHost() {
  const toast = useOverlayStore((state) => state.toast);
  const tone = useOverlayStore((state) => state.toastTone);
  return toast ? (
    <div className={`toast${tone === "success" ? " toast-success" : ""}`} role="status">
      {tone === "success" && <span className="toast-success-mark" aria-hidden="true">✓</span>}
      <span>{toast}</span>
    </div>
  ) : null;
}
