import { LiveEditorHost } from "./live-host";

let hostSingleton: LiveEditorHost | null = null;

/** Shared host for interactive creation editing and its transaction history. */
export function getLiveEditorHost(): LiveEditorHost {
  return (hostSingleton ??= new LiveEditorHost());
}

let hostLock: Promise<unknown> = Promise.resolve();

/** Serialize interactive creation edits so their transactions do not overlap. */
export function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = hostLock.then(fn, fn);
  hostLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
