type PreviewJob = {
  cancelled: boolean;
  run: () => Promise<void>;
};

const MAX_CONCURRENT_PREVIEWS = 2;
const queue: PreviewJob[] = [];
let activePreviews = 0;
let pumpScheduled = false;

type IdleWindow = Window & {
  requestIdleCallback?: (
    callback: () => void,
    options?: { timeout: number },
  ) => number;
};

function schedulePump() {
  if (pumpScheduled) return;
  pumpScheduled = true;
  const pump = () => {
    pumpScheduled = false;
    while (activePreviews < MAX_CONCURRENT_PREVIEWS && queue.length) {
      const job = queue.shift()!;
      if (job.cancelled) continue;
      activePreviews += 1;
      void job.run().catch(() => {}).finally(() => {
        activePreviews -= 1;
        schedulePump();
      });
    }
  };
  const requestIdle = (window as IdleWindow).requestIdleCallback;
  if (requestIdle) requestIdle.call(window, pump, { timeout: 250 });
  else window.setTimeout(pump, 16);
}

export function schedulePreviewLoad(run: () => Promise<void>) {
  const job: PreviewJob = { cancelled: false, run };
  queue.push(job);
  schedulePump();
  return () => {
    job.cancelled = true;
  };
}
