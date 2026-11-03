import { t } from '@/i18n';
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
  notice?: string;
}
export interface UpdateDialogController {
  close: () => void;
  check: () => void | Promise<void>;
  download: () => void | Promise<void>;
  installAndRestart: () => void | Promise<void>;
  cancelDownload: () => void | Promise<void>;
}
function formatBytes(bytes = 0) {
  if (!Number.isFinite(bytes) || bytes <= 0) return t("ui.UpdateDialog.text.23165c3f");
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

function formatReleaseNotes(value = "") {
  const notes = value.trim();
  if (!notes) return t("ui.UpdateDialog.text.cdb284fd");
  if (/^see\s+https?:\/\//i.test(notes)) {
    return t("ui.UpdateDialog.text.f33e1531");
  }
  return notes;
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
  const totalBytes = data.progress?.total || data.info?.fileSize || 0;
  const title = data.checking
    ? t("ui.UpdateDialog.text.ec437645")
    : data.phase === "ready"
    ? t("ui.UpdateDialog.text.8a26edb0")
    : data.phase === "downloading"
    ? t("ui.UpdateDialog.text.e921821c")
    : data.info
    ? t("ui.UpdateDialog.text.01047404")
    : t("ui.UpdateDialog.text.aa9b4729");
  return (
    <div
      className="modal-backdrop open"
      onMouseDown={(event) =>
        event.target === event.currentTarget && closeAllowed &&
        controller.close()}
    >
      <section
        className={`modal update-modal update-${data.phase}${
          data.checking ? " is-checking" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head update-modal-head">
          <h2 className="modal-title">{title}</h2>
          {closeAllowed && (
            <button
              className="icon-btn"
              type="button"
              aria-label={t("ui.UpdateDialog.arialabel.065503f4")}
              onClick={controller.close}
            >
              <IconSymbol name="x" />
            </button>
          )}
        </div>
        <div className="modal-body">
          {data.checking && (
            <div className="update-checking-copy">
              <span className="button-spinner" />
              <div>
                <strong>{t("ui.UpdateDialog.text.b79ffdca")}</strong>
                <span>{t("ui.UpdateDialog.text.e7e3543e")}</span>
              </div>
            </div>
          )}
          {data.notice && (
            <div className="update-current-state" role="status">
              <span className="update-current-icon">
                <IconSymbol name="check" />
              </span>
              <div>
                <strong>{data.notice}</strong>
                <span>{t("ui.UpdateDialog.text.3a1699ec")}</span>
              </div>
            </div>
          )}
          {data.info && (
            <>
              <div className="update-version-card">
                <span className="update-version-icon">
                  <IconSymbol name="package" />
                </span>
                <div>
                  <span>{t("ui.UpdateDialog.text.152dbc57")}</span>
                  <strong>Shotloom {data.info.version}</strong>
                </div>
                <span className="update-size">{formatBytes(totalBytes)}</span>
              </div>
              <div className="update-notes">
                <span>{t("ui.UpdateDialog.text.696d0b6d")}</span>
                <p>{formatReleaseNotes(data.info.releaseNotes)}</p>
              </div>
            </>
          )}
          {data.phase === "downloading" && (
            <div className="update-progress" aria-live="polite">
              <div className="update-progress-head">
                <strong>{t("ui.UpdateDialog.text.837ce675")}</strong>
                <span>{percent}%</span>
              </div>
              <div
                className="progress-track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="progress-meta">
                <span>
                  {formatBytes(data.progress?.received)} /{" "}
                  {formatBytes(totalBytes)}
                </span>
                <span>{t("ui.UpdateDialog.text.5e4b1d49")}</span>
              </div>
            </div>
          )}
          {data.phase === "ready" && (
            <div className="update-ready-copy">
              <IconSymbol name="check" />
              <span>{t("ui.UpdateDialog.text.4f4f8aa3")}</span>
            </div>
          )}
          {data.error && <p className="update-error">{data.error}</p>}
        </div>
        {data.phase === "downloading" && (
          <div className="modal-foot update-modal-foot">
            <button className="button ghost" type="button" onClick={() => void controller.cancelDownload()}>
              {t("ui.UpdateDialog.text.7115f2e2")}</button>
          </div>
        )}
        {!data.checking && data.phase !== "downloading" && (
        <div className="modal-foot update-modal-foot">
          {!force && !data.checking && data.phase !== "downloading" && (
            <button
              className="button ghost"
              type="button"
              onClick={controller.close}
            >
              {data.notice ? t("ui.ReactWorkbench.text.33246f6a") : t("ui.UpdateDialog.text.ac5d03ec")}
            </button>
          )}
          {data.phase === "available" || data.phase === "recovering"
            ? (
              <button
                className="button primary"
                type="button"
                onClick={() => void controller.download()}
              >
                <IconSymbol name="download" />{t("ui.UpdateDialog.text.ab2ea0b5")}</button>
            )
            : data.phase === "ready"
            ? (
              <button
                className="button primary"
                type="button"
                onClick={() => void controller.installAndRestart()}
              >
                {t("ui.UpdateDialog.text.baa56dde")}</button>
            )
            : (
              <button
                className="button primary"
                type="button"
                onClick={() => void controller.check()}
              >
                <IconSymbol name="refresh" />{t("ui.UpdateDialog.text.4fab9865")}</button>
            )}
        </div>
        )}
      </section>
    </div>
  );
}
