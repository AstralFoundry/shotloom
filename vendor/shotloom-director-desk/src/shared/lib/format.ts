/** Format a timeline position as HH:MM:SS:FF, matching the frame-exact readout in the editor. */
export function timecode(seconds: number, fps: number): string {
    const frames = Math.round(seconds * fps);
    const f = frames % fps;
    const s = Math.floor(frames / fps);
    return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60, f]
        .map((part) => String(part).padStart(2, '0'))
        .join(':');
}

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
