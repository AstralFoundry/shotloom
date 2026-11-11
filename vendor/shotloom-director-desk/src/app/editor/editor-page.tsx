import { DeleteOutlined } from '@ant-design/icons';
import { App } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { InspectorPanel } from '@/features/inspector/inspector-panel.tsx';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { hasBlockingLayer, shouldIgnoreShortcut, isTypingTarget } from '@/shared/lib/keyboard.ts';
import { notify } from '@/shared/ui/feedback.ts';
import { SceneSidebar } from '@/features/sidebar/scene-sidebar.tsx';
import { StageViewport } from '@/features/stage/stage-viewport.tsx';
import { TimelinePanel } from '@/features/timeline/timeline-panel.tsx';
import { TopBar } from '@/features/top-bar/top-bar.tsx';
import { PanelResize } from '@/features/shell/panel-resize.tsx';
import { editorPreferences } from '@/core/editor/preferences.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { usePreferences } from '@/state/use-preferences.ts';
import './editor-page.css';

/**
 * Delete the clip the user has selected, when there is one. Returns false when no clip is
 * selected so the caller can fall back to deleting the whole entity.
 */
function deleteSelectedClip(onDeleted: () => void): boolean {
    const { selected, selectedClipId } = useEditorStore.getState();
    if (!selectedClipId) return false;
    const entity = session.project.entities.find((item) => item.id === selected);
    if (!entity || !entity.clips.some((clip) => clip.id === selectedClipId)) {
        session.selectClip(null);
        return false;
    }
    if (entity.locked) return false;
    session.removeClip(selectedClipId);
    onDeleted();
    return true;
}

export function EditorPage() {
    const t = useTranslation();
    const { modal } = App.useApp();
    const preferences = usePreferences();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [inspectorOpen, setInspectorOpen] = useState(true);
    /**
     * One frame loop for the whole editor: advance playback, let the engine draw, then
     * publish the playhead at ~20 Hz so React is not re-rendered on every frame.
     */
    useEffect(() => {
        let previous = performance.now();
        let request = 0;
        const tick = (now: number) => {
            const delta = Math.min((now - previous) / 1000, 0.1);
            previous = now;
            session.frame(delta, now);
            request = requestAnimationFrame(tick);
        };
        request = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(request);
    }, []);

    // Panel geometry lives in preferences so it survives a reload; the shell reads it as
    // CSS variables and falls back to the responsive defaults when a value is null.
    const shellStyle = useMemo(() => {
        const style: Record<string, string> = {};
        if (preferences.sidebarWidth !== null) style['--sidebar-width'] = `${preferences.sidebarWidth}px`;
        if (preferences.inspectorWidth !== null) style['--inspector-width'] = `${preferences.inspectorWidth}px`;
        if (preferences.timelineHeight !== null) style['--timeline-height'] = `${preferences.timelineHeight}px`;
        return style as React.CSSProperties;
    }, [preferences.sidebarWidth, preferences.inspectorWidth, preferences.timelineHeight]);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            // A path draft is a modal-ish interaction: Enter/Esc finish or cancel it even when a
            // toolbar button still holds focus from the click that started the draft.
            const drafting = useEditorStore.getState().pathDraft !== null;
            if (drafting && (event.key === 'Enter' || event.key === 'Escape') && !isTypingTarget(event.target)) {
                event.preventDefault();
                if (event.key === 'Enter') session.finishPath();
                else session.cancelPath();
                return;
            }
            const deleteKey = event.key === 'Delete' || event.key === 'Backspace';
            const { selectedClipId, selectedPathSection } = useEditorStore.getState();
            const focusedWidget =
                event.target instanceof Element &&
                event.target.closest('[role="slider"], [role="combobox"], [role="listbox"], [role="option"]');
            if (
                deleteKey &&
                (selectedClipId || selectedPathSection) &&
                !isTypingTarget(event.target) &&
                !hasBlockingLayer() &&
                !focusedWidget
            ) {
                event.preventDefault();
                if (selectedClipId) deleteSelectedClip(() => notify(t('已删除动作片段，可用撤销恢复')));
                else if (session.removeSelectedPathSection()) notify(t('已删除路径片段，可用撤销恢复'));
                return;
            }
            // Typing, open dialogs/menus and focused buttons or sliders own the keyboard first.
            if (shouldIgnoreShortcut(event)) return;
            if (event.metaKey || event.ctrlKey) {
                const key = event.key.toLowerCase();
                if (key === 'z') {
                    event.preventDefault();
                    if (event.shiftKey) session.redo();
                    else session.undo();
                    return;
                }
                if (key === 'b') {
                    event.preventDefault();
                    session.splitSelectedClip();
                    return;
                }
                if (key === 'd') {
                    event.preventDefault();
                    session.duplicateSelected();
                }
                return;
            }
            if (event.altKey) return;
            if (event.key === 'Escape' && session.timelineDragging) {
                event.preventDefault();
                session.cancelTimelineDrag();
                return;
            }
            if (event.key === '/') {
                const search = document.querySelector<HTMLInputElement>('#scene-search');
                if (search) {
                    event.preventDefault();
                    setSidebarOpen(true);
                    requestAnimationFrame(() => search.focus());
                    return;
                }
            }
            if (event.code === 'Space') {
                event.preventDefault();
                session.togglePlay();
                return;
            }
            if (event.key === '1') session.setTransformMode('translate');
            if (event.key === '2') session.setTransformMode('rotate');
            if (event.key === '3') session.setTransformMode('scale');
            const canvasFocused = document.activeElement instanceof HTMLCanvasElement;
            if ((event.key === 'f' || event.key === 'F') && !canvasFocused) session.focusSelected();
            if (event.key === 'Delete' || event.key === 'Backspace') {
                const entity = session.current();
                if (!entity) return;
                event.preventDefault();
                modal.confirm({
                    className: 'delete-confirm',
                    icon: <DeleteOutlined />,
                    centered: true,
                    width: 400,
                    title: `${t('删除对象')}「${entity.name}」`,
                    content: t('删除后可用撤销恢复。'),
                    okText: t('删除'),
                    okButtonProps: { danger: true },
                    cancelText: t('取消'),
                    onOk: () => {
                        session.deleteSelected();
                    },
                });
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [modal, t]);

    return (
        <div className={`editor ${sidebarOpen ? 'editor--sidebar-open' : 'editor--sidebar-closed'} ${inspectorOpen ? '' : 'editor--inspector-closed'}`} style={shellStyle}>
            <TopBar
                sidebarOpen={sidebarOpen}
                onToggleSidebar={() => setSidebarOpen((open) => !open)}
                inspectorOpen={inspectorOpen}
                onToggleInspector={() => setInspectorOpen((open) => !open)}
            />
            <div className="editor__body">
                <SceneSidebar
                    resize={
                        <PanelResize
                            side="right"
                            preferenceKey="sidebarWidth"
                            label={t('左侧资源栏宽度')}
                            min={200}
                            max={520}
                        />
                    }
                />
                <StageViewport />
                <InspectorPanel
                    onHide={() => setInspectorOpen(false)}
                    resize={
                        <PanelResize
                            side="left"
                            preferenceKey="inspectorWidth"
                            label={t('右侧属性栏宽度')}
                            min={240}
                            max={560}
                            invert
                        />
                    }
                />
            </div>
            <TimelinePanel
                onHeightChange={(height) => editorPreferences.set('timelineHeight', height)}
                onHeightReset={() => editorPreferences.set('timelineHeight', null)}
            />
        </div>
    );
}
