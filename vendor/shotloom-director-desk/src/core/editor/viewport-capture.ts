export const CAPTURE_ASPECTS = ['auto', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
export type CaptureAspect = (typeof CAPTURE_ASPECTS)[number];

/** Center crop shared by the visible frame, screenshots and live recordings. */
export function captureRect(width: number, height: number, aspect: CaptureAspect) {
    const [aw, ah] = aspect === 'auto' ? [width, height] : aspect.split(':').map(Number);
    const ratio = aw / ah;
    const w = Math.min(width, height * ratio);
    const h = w / ratio;
    return { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h };
}

export function captureSize(width: number, height: number, aspect: CaptureAspect, longEdge?: number): [number, number] {
    const rect = captureRect(width, height, aspect);
    const scale = longEdge ? longEdge / Math.max(rect.width, rect.height) : 1;
    return [Math.max(2, Math.round(rect.width * scale / 2) * 2), Math.max(2, Math.round(rect.height * scale / 2) * 2)];
}

function captureSurface(source: HTMLCanvasElement, aspect: CaptureAspect) {
    if (!source.width || !source.height) throw Error('视口尚未准备好');
    const canvas = document.createElement('canvas');
    [canvas.width, canvas.height] = captureSize(source.width, source.height, aspect);
    const context = canvas.getContext('2d');
    if (!context) throw Error('无法创建输出画布');
    const draw = () => {
        const rect = captureRect(source.width, source.height, aspect);
        context.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    };
    return { canvas, draw };
}

export async function captureViewport(source: HTMLCanvasElement, aspect: CaptureAspect): Promise<Blob> {
    const { canvas, draw } = captureSurface(source, aspect);
    draw();
    return new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(Error('截图失败')), 'image/png'));
}

/** Record a fixed-size canvas while the user navigates or plays the scene. */
export function recordViewport(source: HTMLCanvasElement, aspect: CaptureAspect, render: () => void) {
    if (typeof MediaRecorder === 'undefined' || !HTMLCanvasElement.prototype.captureStream) throw Error('当前环境不支持录屏');
    const { canvas, draw } = captureSurface(source, aspect);
    render();
    draw();
    const stream = canvas.captureStream(30);
    let recorder: MediaRecorder;
    try {
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/mp4', 'video/webm']
            .find((type) => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw Error('当前环境没有可用的录屏编码器');
        recorder = new MediaRecorder(stream, { mimeType });
    } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
    }
    const chunks: Blob[] = [];
    let frame = 0;
    let failure: Error | null = null;
    const cleanup = () => {
        cancelAnimationFrame(frame);
        stream.getTracks().forEach((track) => track.stop());
    };
    const result = new Promise<Blob>((resolve, reject) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => { failure = Error('录屏编码失败'); if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.onstop = () => {
            cleanup();
            const blob = new Blob(chunks, { type: recorder.mimeType });
            if (failure) reject(failure);
            else if (!blob.size) reject(Error('录屏没有产生视频数据'));
            else resolve(blob);
        };
    });
    // The UI also observes completion when recording ends due to a render/encoder failure.
    const tick = () => {
        if (recorder.state !== 'recording') return;
        try { render(); draw(); }
        catch (error) {
            failure = error instanceof Error ? error : Error(String(error));
            recorder.stop();
            return;
        }
        frame = requestAnimationFrame(tick);
    };
    try { recorder.start(200); frame = requestAnimationFrame(tick); }
    catch (error) { cleanup(); throw error; }
    return {
        result,
        stop: () => { if (recorder.state !== 'inactive') recorder.stop(); },
        cancel: () => { failure = Error('录屏已取消'); if (recorder.state !== 'inactive') recorder.stop(); cleanup(); },
    };
}
