import { addCut } from '@/core/timeline.ts';
import { clamp } from '@/shared/lib/format.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';
import { useEditorStore } from '../editor-store.ts';
import type { EditorCommandHost } from './host.ts';

/** Playhead, transport and cut list. */
export class TimelineCommands {
    constructor(private readonly host: EditorCommandHost) {}

    seek(seconds: number, deferSample = false): void {
        if (useEditorStore.getState().busy) return;
        const duration = Math.max(this.host.project.duration, 0);
        this.host.setClock(clamp(Number.isFinite(seconds) ? seconds : 0, 0, duration));
        if (!deferSample) this.host.engine?.sample(this.host.clock);
        this.host.patch({ time: this.host.clock });
    }

    togglePlay(): void {
        const state = useEditorStore.getState();
        if (state.playing) {
            this.host.patch({ playing: false });
            return;
        }
        if (state.time >= state.project.duration) this.seek(0);
        this.host.patch({ playing: true });
    }

    stepFrame(direction: 1 | -1): void {
        const { time, project } = useEditorStore.getState();
        this.seek(time + direction / project.fps);
    }

    setLoop(loop: boolean): void {
        this.host.patch({ loop });
    }

    /** Cut to the selected camera (or the current preview camera) at the playhead. */
    addCutAtPlayhead(): void {
        const state = useEditorStore.getState();
        const selected = this.host.current();
        const cameraId = selected?.kind === 'camera' ? selected.id : state.preview !== 'program' ? state.preview : '';
        if (!cameraId) {
            notifyError('请先添加机位，或在机位视角选择拍摄机位');
            return;
        }
        const name = this.host.project.entities.find((entity) => entity.id === cameraId)?.name ?? cameraId;
        const added = this.host.change(() => {
            this.host.project.duration = Math.max(this.host.project.duration, this.host.clock + 1);
            addCut(this.host.project, this.host.clock, cameraId);
        }, false);
        if (added) notifySuccess(`已在 ${this.host.clock.toFixed(2)} 秒切入 ${name}`);
    }

    removeCut(index: number): void {
        if (index <= 0) {
            notifyError('第一段切镜固定在场景开头');
            return;
        }
        this.host.change(() => {
            this.host.project.cuts.splice(index, 1);
        }, false);
    }

    setDuration(seconds: number): void {
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        this.host.change(() => {
            this.host.project.duration = Math.max(0.1, seconds);
        }, false);
    }
}
