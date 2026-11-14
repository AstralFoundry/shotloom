import { ChevronDownIcon, XIcon, EllipsisVerticalIcon, CircleHelpIcon, Redo2Icon, Settings2Icon, PanelLeftCloseIcon, PanelLeftOpenIcon, ChevronLeftIcon, MoonIcon, SunIcon, Undo2Icon } from '@/shared/ui/icons.tsx';
import { Button, Dropdown, Modal, Popover, Select, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { CAPTURE_ASPECTS } from '@/core/editor/viewport-capture.ts';
import { editorPreferences } from '@/core/editor/preferences.ts';
import { usePreferences } from '@/state/use-preferences.ts';
import { AspectIcon } from '@/shared/ui/aspect-icon.tsx';
import { ViewportOutputMenu } from './viewport-output-menu.tsx';
import { useRevision } from '@/state/use-editor.ts';
import { ExportDialog } from '@/features/export/export-dialog.tsx';
import { HelpPanel } from '@/features/dialogs/help-dialog.tsx';
import { ProjectDialog } from '@/features/dialogs/project-dialog.tsx';
import { ResetProjectDialog } from '@/features/dialogs/reset-project-dialog.tsx';
import { SettingsDialog } from '@/features/settings/settings-dialog.tsx';
import { getEditorTheme } from '@/app/providers/theme.ts';
import { requestHostClose } from '@/app/host-bridge.ts';


export function TopBar({ sidebarOpen, onToggleSidebar, inspectorOpen, onToggleInspector }: {
    sidebarOpen: boolean;
    onToggleSidebar: () => void;
    inspectorOpen: boolean;
    onToggleInspector: () => void;
}) {
    const t = useTranslation();
    const [exportOpen, setExportOpen] = useState(false);
    const [projectOpen, setProjectOpen] = useState(false);
    const [resetProjectOpen, setResetProjectOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const view = useEditorStore((state) => state.view);
    const { captureAspect } = usePreferences();
    const [aspectOpen, setAspectOpen] = useState(false);
    const [outputActive, setOutputActive] = useState(false);
    const status = useEditorStore((state) => state.status);
    const dirty = useEditorStore((state) => state.dirty);

    useRevision();
    const canUndo = session.history.undoStack.length > 0;
    const canRedo = session.history.redoStack.length > 0;
    const theme = getEditorTheme();

    /** Secondary actions live behind one menu so the bar stops overflowing on narrow screens. */
    const moreMenu = {
        items: [
            { key: 'reset-project', icon: <Redo2Icon />, label: t('重置项目'), danger: true },
            { key: 'settings-project', icon: <Settings2Icon />, label: t('项目设置') },
            { key: 'settings', icon: <Settings2Icon />, label: t('设置') },
            { type: 'divider' as const },
            {
                key: 'theme',
                icon: theme === 'dark' ? <SunIcon /> : <MoonIcon />,
                label: theme === 'dark' ? t('浅色') : t('深色'),
            },
            { key: 'help', icon: <CircleHelpIcon />, label: t('操作与快捷键') },
        ],
        onClick: ({ key }: { key: string }) => {
            if (key === 'reset-project') setResetProjectOpen(true);
            else if (key === 'settings-project') setProjectOpen(true);
            else if (key === 'settings') setSettingsOpen(true);
            else if (key === 'theme') session.setTheme(theme === 'dark' ? 'light' : 'dark');
            else if (key === 'help') setHelpOpen(true);
        },
    };

    return (
        <header className="topbar">
            <Tooltip title={sidebarOpen ? t('收起侧栏') : t('展开侧栏')}>
                <Button
                    className="topbar__scene-toggle"
                    type="default"
                    icon={sidebarOpen ? <PanelLeftCloseIcon /> : <PanelLeftOpenIcon />}
                    aria-expanded={sidebarOpen}
                    aria-label={sidebarOpen ? t('收起侧栏') : t('展开侧栏')}
                    onClick={onToggleSidebar}
                />
            </Tooltip>


            <div className="topbar__workspace" role="group" aria-label={t('取景工具')}>
                <Select<'stage' | 'shot'>
                    className="topbar__view-select"
                    classNames={{ popup: { root: 'topbar__view-popup' } }}
                    variant="borderless"
                    aria-label={t('视角')}
                    disabled={outputActive}
                    value={view === 'shot' ? 'shot' : 'stage'}
                    onChange={(value) => session.setView(value)}
                    options={[
                        { value: 'stage', label: t('导演视角') },
                        { value: 'shot', label: t('机位视角') },
                    ]}
                />
                <Popover
                    trigger="click"
                    open={aspectOpen && !outputActive}
                    onOpenChange={setAspectOpen}
                    placement="bottomLeft"
                    content={
                        <div className="capture-aspects">
                            <div className="capture-aspects__title">{t('比例')}</div>
                            <div className="capture-aspects__grid">
                                {CAPTURE_ASPECTS.map((aspect) => (
                                    <Button
                                        key={aspect}
                                        className="capture-aspects__item"
                                        aria-label={aspect === 'auto' ? 'Auto' : aspect}
                                        aria-pressed={captureAspect === aspect}
                                        onClick={() => { editorPreferences.set('captureAspect', aspect); setAspectOpen(false); }}
                                    >
                                        <AspectIcon aspect={aspect} />
                                        <span>{aspect === 'auto' ? 'Auto' : aspect}</span>
                                    </Button>
                                ))}
                            </div>
                        </div>
                    }
                >
                    <Button disabled={outputActive} className="topbar__aspect" type="text" icon={<AspectIcon aspect={captureAspect} size={18} />} aria-label={t('输出比例')}>
                        {captureAspect === 'auto' ? 'Auto' : captureAspect}<ChevronDownIcon />
                    </Button>
                </Popover>
                <ViewportOutputMenu onActiveChange={setOutputActive} onExportVideo={() => setExportOpen(true)} />
            </div>
            <div className="topbar__actions">
                {/* Fixed-width status slot: the label used to unmount when clean, which shifted
                    every following button sideways on each autosave. */}
                <span
                    className={`save-status ${dirty ? 'save-status--dirty' : ''}`}
                    title={status || t('自动保存')}
                    aria-live="polite"
                >
                    <i className="save-status__dot" />
                    <span className="save-status__text">{dirty ? status || t('自动保存') : t('已保存')}</span>
                </span>
                <Tooltip title={t('撤销 Ctrl+Z')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<Undo2Icon />}
                        aria-label={t('撤销')}
                        disabled={!canUndo}
                        onClick={() => session.undo()}
                    />
                </Tooltip>
                <Tooltip title={t('重做 Ctrl+Shift+Z')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<Redo2Icon />}
                        aria-label={t('重做')}
                        disabled={!canRedo}
                        onClick={() => session.redo()}
                    />
                </Tooltip>
                <span className="topbar__divider" />
                <Dropdown menu={moreMenu} placement="bottomRight" trigger={['click']}>
                    <Button type="text" size="small" icon={<EllipsisVerticalIcon />} aria-label={t('更多')} />
                </Dropdown>
                {!inspectorOpen ? (
                    <Tooltip title={t('显示属性面板')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<ChevronLeftIcon />}
                            aria-label={t('显示属性面板')}
                            aria-expanded={false}
                            aria-controls="director-inspector"
                            onClick={onToggleInspector}
                        />
                    </Tooltip>
                ) : null}
                {window.parent !== window ? (
                    <>
                        <Tooltip title={t('返回画布')}>
                            <Button type="text" size="small" icon={<XIcon />} aria-label={t('返回画布')} onClick={requestHostClose} />
                        </Tooltip>
                    </>
                ) : null}
                {exportOpen ? <ExportDialog open onClose={() => setExportOpen(false)} /> : null}
                {resetProjectOpen ? <ResetProjectDialog open onClose={() => setResetProjectOpen(false)} /> : null}
                {projectOpen ? <ProjectDialog open onClose={() => setProjectOpen(false)} /> : null}
                <Modal destroyOnHidden open={helpOpen} onCancel={() => setHelpOpen(false)} footer={null} width={640} aria-label={t('操作与快捷键')}><HelpPanel /></Modal>
                <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </div>
        </header>
    );
}
