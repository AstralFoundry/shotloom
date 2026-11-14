import { CameraIcon, DownloadIcon, ImageIcon, SquareIcon, ClapperboardIcon } from '@/shared/ui/icons.tsx';
import { Button, Dropdown, Tooltip } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { captureSize, captureViewport, recordViewport } from '@/core/editor/viewport-capture.ts';
import { deliverMedia } from '@/core/host-delivery.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { usePreferences } from '@/state/use-preferences.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { notifyError, notifySuccess } from '@/shared/ui/feedback.ts';

export function ViewportOutputMenu({ onActiveChange, onExportVideo }: { onActiveChange: (active: boolean) => void; onExportVideo: () => void }) {
    const t = useTranslation();
    const { captureAspect } = usePreferences();
    const busy = useEditorStore((state) => state.busy);
    const [active, setActive] = useState(false);
    const [recording, setRecording] = useState(false);
    const recorder = useRef<ReturnType<typeof recordViewport> | null>(null);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; recorder.current?.cancel(); };
    }, []);

    const output = async (kind: 'screenshot' | 'render' | 'record') => {
        const engine = session.engineOrNull;
        if (!engine || active || busy) return;
        const state = useEditorStore.getState();
        const source = state.view === 'shot' ? engine.shotRenderer.domElement : engine.editorRenderer.domElement;
        const projectName = session.project.name;
        const time = state.time;
        const view = state.view === 'shot' ? 'camera' : 'director';
        let video = false;
        setActive(true);
        onActiveChange(true);
        try {
            engine.render();
            if (kind === 'render') {
                await session.snapshot(captureSize(source.width, source.height, captureAspect, 1920));
                return;
            }
            let blob: Blob;
            if (kind === 'record') {
                video = true;
                const job = recordViewport(source, captureAspect, () => {
                    if (engine.exporting) throw Error(t('录屏期间发生了其他渲染任务，请重新录制'));
                    if (session.engineOrNull !== engine) throw Error(t('场景已切换，录屏已停止'));
                    engine.render();
                });
                recorder.current = job;
                setRecording(true);
                blob = await job.result;
                recorder.current = null;
            } else blob = await captureViewport(source, captureAspect);
            if (!mounted.current) return;
            setRecording(false);
            const extension = video ? (blob.type.includes('mp4') ? 'mp4' : 'webm') : 'png';
            await deliverMedia(blob, `${projectName}-${video ? 'recording' : 'screenshot'}-${Date.now()}.${extension}`, video ? 'video' : 'image', {
                source: 'director-desk-viewport', view, startTime: time,
                endTime: useEditorStore.getState().time,
                aspect: captureAspect,
            });
            if (mounted.current) notifySuccess(t(video ? '录屏已保存' : '截图已保存'));
        } catch (error) {
            if (mounted.current) notifyError((error as Error).message);
        } finally {
            recorder.current = null;
            if (mounted.current) { setRecording(false); setActive(false); onActiveChange(false); }
        }
    };

    if (recording) return (
        <Tooltip title={t('停止并保存录屏')}>
            <Button className="topbar__record-stop" type="text" icon={<SquareIcon />} aria-label={t('停止并保存录屏')} onClick={() => recorder.current?.stop()}>
                {t('停止录屏')}
            </Button>
        </Tooltip>
    );
    return (
        <Dropdown trigger={['click']} menu={{ items: [
            { key: 'screenshot', icon: <CameraIcon aria-hidden="true" />, label: t('截图'), title: t('保存当前视图'), disabled: active || busy },
            { key: 'render', icon: <ImageIcon aria-hidden="true" />, label: t('渲染'), title: t('导出当前机位高清图'), disabled: active || busy },
            { key: 'record', icon: <ClapperboardIcon aria-hidden="true" />, label: t('录屏'), title: t('录制当前视图'), disabled: active || busy },
            { type: 'divider' },
            { key: 'video', icon: <DownloadIcon aria-hidden="true" />, label: t('导出运镜视频'), disabled: active || busy },
        ], onClick: ({ key }) => {
            if (key === 'video') onExportVideo();
            else void output(key as 'screenshot' | 'render' | 'record');
        } }}>
            <Button className="topbar__output-menu" type="text" icon={<CameraIcon />} loading={active} disabled={busy || active} aria-label={t('输出')}>

            </Button>
        </Dropdown>
    );
}
