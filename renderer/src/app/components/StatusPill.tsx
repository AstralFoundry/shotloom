const labels: Record<string, string> = {
  idle: "待命",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  timeout: "超时",
  cancelled: "已取消",
  error: "错误",
  partial_failed: "部分失败",
  stopped: "已停止",
  historical: "历史模型",
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
