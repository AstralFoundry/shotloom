/**
 * Persistence host port.
 *
 * The embedding application owns project storage. After the engine hands over new files the
 * host gets a chance to flush them; a failed flush must not lose the user's edits, so the
 * engine keeps them in memory and reports the failure instead of rolling back.
 */
export type PrevisPersistResult = { ok: true } | { ok: false; message: string };

let flush: (() => Promise<PrevisPersistResult | void>) | null = null;

export function setPrevisPersistHook(next: (() => Promise<PrevisPersistResult | void>) | null) {
    flush = next;
}

export async function saveRemoteUserDataNow(): Promise<PrevisPersistResult> {
    if (!flush) return { ok: true };
    try {
        const result = await flush();
        return result && "ok" in result ? result : { ok: true };
    } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
}

/** Copy shown when a save only reached local storage. */
export function localSavedRemotePendingMessage(done: string, error: unknown): string {
    const detail = error instanceof Error ? error.message : String(error ?? "");
    return detail ? `${done}，云端同步待重试：${detail}` : `${done}，云端同步待重试`;
}
