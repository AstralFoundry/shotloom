import { download } from './storage.ts';

/** Deliver rendered media to Shotloom when embedded; standalone desk still downloads it. */
export async function deliverMedia(blob: Blob, fileName: string, kind: 'image' | 'video', directorContext?: unknown): Promise<void> {
    if (window.parent === window) {
        download(blob, fileName);
        return;
    }
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('媒体读取失败'));
        reader.onerror = () => reject(reader.error ?? new Error('媒体读取失败'));
        reader.readAsDataURL(blob);
    });
    await new Promise<void>((resolve, reject) => {
        const requestId = crypto.randomUUID();
        const timeout = window.setTimeout(() => {
            window.removeEventListener('message', onMessage);
            reject(new Error('画布未确认导出结果'));
        }, 120_000);
        const onMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== window.parent) return;
            const message = event.data as { type?: string; payload?: { requestId?: string; success?: boolean; error?: string } };
            if (message?.type !== 'storyai:director-desk-captures-saved' || message.payload?.requestId !== requestId) return;
            window.clearTimeout(timeout);
            window.removeEventListener('message', onMessage);
            if (message.payload.success) resolve();
            else reject(new Error(message.payload.error || '画布保存导出结果失败'));
        };
        window.addEventListener('message', onMessage);
        window.parent.postMessage({
            type: 'storyai:director-desk-captures-sent',
            payload: { requestId, captures: [{ dataUrl, fileName, kind, directorContext }] },
        }, window.location.origin);
    });
}
