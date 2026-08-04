import { IconSymbol } from "./IconSymbol";

export interface UpdateDialogData {
  checking?: boolean;
  phase: "idle" | "available" | "downloading" | "ready" | string;
  info: null | {
    version: string;
    fileSize?: number;
    releaseNotes?: string;
    forceUpdate?: boolean;
  };
  progress: null | { received?: number; total?: number; percent?: number };
  error?: string;
}
export interface UpdateDialogController {
  close: () => void;
  check: () => void | Promise<void>;
  download: () => void | Promise<void>;
  installAndRestart: () => void | Promise<void>;
}
function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "未知大小";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${
    value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)
  } ${units[index]}`;
}

export function UpdateDialog(
  { data, controller }: {
    data: UpdateDialogData;
    controller: UpdateDialogController;
  },
) {
  const force = Boolean(data.info?.forceUpdate);
  const percent = Math.min(100, Math.max(0, data.progress?.percent || 0));
  const closeAllowed = !force && !data.checking && data.phase !== "downloading";
  const title = data.checking
    ? "正在检查更新"
    : data.phase === "ready"
    ? "更新已就绪"
    : data.phase === "downloading"
    ? "正在下载更新"
    : data.info
    ? "发现新版本"
    : "应用更新";
  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(event) =>
        event.target === event.currentTarget && closeAllowed &&
        controller.close()}
    >
      <section
        className="modal update-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <h2 className="modal-title">{title}</h2>
          {!force && (
            <button
              className="icon-btn"
              type="button"
              onClick={controller.close}
            >
              <IconSymbol name="x" />
            </button>
          )}
        </div>
        <div className="modal-body">
          {data.checking && (
            <div className="update-summary">
              <div className="update-icon">
                <span className="button-spinner" />
              </div>
              <div>
                <strong>正在连接更新服务器</strong>
                <span>请稍候…</span>
              </div>
            </div>
          )}
          {data.info && (
            <div className="update-summary">
              <div className="update-icon">
                <IconSymbol name="package" />
              </div>
              <div>
                <strong>v{data.info.version}</strong>
                <span>{formatBytes(data.info.fileSize)}</span>
              </div>
            </div>
          )}
          {data.info?.releaseNotes && (
            <p className="update-notes">{data.info.releaseNotes}</p>
          )}
          {data.phase === "downloading" && (
            <div className="update-progress">
              <div className="progress-track">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-meta">
                <span>
                  {formatBytes(data.progress?.received)} /{" "}
                  {formatBytes(data.progress?.total || data.info?.fileSize)}
                </span>
                <strong>{percent}%</strong>
              </div>
            </div>
          )}
          {data.error && <p className="update-error">{data.error}</p>}
        </div>
        <div className="modal-foot">
          {!force && !data.checking && data.phase !== "downloading" && (
            <button
              className="button ghost"
              type="button"
              onClick={controller.close}
            >
              以后
            </button>
          )}
          {data.checking
            ? (
              <button className="button primary" type="button" disabled>
                <span className="button-spinner" />检查中
              </button>
            )
            : data.phase === "available"
            ? (
              <button
                className="button primary"
                type="button"
                onClick={() => void controller.download()}
              >
                <IconSymbol name="download" />立即下载
              </button>
            )
            : data.phase === "downloading"
            ? (
              <button className="button primary" type="button" disabled>
                下载中
              </button>
            )
            : data.phase === "ready"
            ? (
              <button
                className="button primary"
                type="button"
                onClick={() => void controller.installAndRestart()}
              >
                立即安装并退出
              </button>
            )
            : (
              <button
                className="button primary"
                type="button"
                onClick={() => void controller.check()}
              >
                重新检查
              </button>
            )}
        </div>
      </section>
    </div>
  );
}
