import { t } from '@/i18n';
const labels: Record<string, string> = {
  idle: t("ui.StatusPill.idle.1a0db8dc"),
  queued: t("ui.StatusPill.queued.4dcbbcfa"),
  running: t("ui.StatusPill.running.59424970"),
  completed: t("ui.taskAdapter.label.e99b48a2"),
  failed: t("ui.taskAdapter.label.3e3c8068"),
  timeout: t("ui.StatusPill.timeout.ff06c243"),
  cancelled: t("ui.StatusPill.cancelled.a5ffdc95"),
  error: t("ui.StatusPill.error.b859c7be"),
  partial_failed: t("ui.StatusPill.partialfailed.7912043e"),
  stopped: t("ui.StatusPill.stopped.75dddf52"),
  historical: t("ui.StatusPill.historical.22a5c84f"),
};
const tones: Record<string, string> = {
  queued: "info",
  running: "warn",
  completed: "good",
  failed: "bad",
  timeout: "bad",
  cancelled: "muted",
  error: "bad",
  partial_failed: "warn",
  stopped: "muted",
  historical: "muted",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`pill ${tones[status] || ""}`}>
      {labels[status] || status}
    </span>
  );
}
