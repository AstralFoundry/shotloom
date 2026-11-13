import {
    DownloadOutlined,
    CloseOutlined,
    MessageOutlined,
    MoreOutlined,
    PictureOutlined,
    QuestionCircleOutlined,
    RedoOutlined,
    SettingOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    LeftOutlined,
    MoonOutlined,
    SunOutlined,
    UndoOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Popover, Segmented, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore, type ViewMode } from '@/state/editor-store.ts';
import { useRevision } from '@/state/use-editor.ts';
import { ExportDialog } from '@/features/export/export-dialog.tsx';
import { HelpPanel } from '@/features/dialogs/help-dialog.tsx';
import { ProjectDialog } from '@/features/dialogs/project-dialog.tsx';
import { ResetProjectDialog } from '@/features/dialogs/reset-project-dialog.tsx';
import { SettingsDialog } from '@/features/settings/settings-dialog.tsx';
import { getEditorTheme } from '@/app/providers/theme.ts';
import { requestHostAgentOpen, requestHostClose } from '@/app/host-bridge.ts';

const VIEW_MODES: ViewMode[] = ['stage', 'split', 'shot'];

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
    const status = useEditorStore((state) => state.status);
    const dirty = useEditorStore((state) => state.dirty);

    useRevision();
    const canUndo = session.history.undoStack.length > 0;
    const canRedo = session.history.redoStack.length > 0;
    const anyDialogOpen = exportOpen || resetProjectOpen || projectOpen || settingsOpen;
    const theme = getEditorTheme();

    const labels: Record<ViewMode, string> = {
        stage: t('导演视角'),
        split: t('分屏'),
        shot: t('机位视角'),
    };

    /** Secondary actions live behind one menu so the bar stops overflowing on narrow screens. */
    const moreMenu = {
        items: [
            { key: 'reset-project', icon: <RedoOutlined />, label: t('重置项目'), danger: true },
            { key: 'settings-project', icon: <SettingOutlined />, label: t('项目设置') },
            { key: 'settings', icon: <SettingOutlined />, label: t('设置') },
            { type: 'divider' as const },
            {
                key: 'theme',
                icon: theme === 'dark' ? <SunOutlined /> : <MoonOutlined />,
                label: theme === 'dark' ? t('浅色') : t('深色'),
            },
            { key: 'help', icon: <QuestionCircleOutlined />, label: t('操作与快捷键') },
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
            <Button
                className="topbar__scene-toggle"
                type="default"
                icon={sidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}
                aria-expanded={sidebarOpen}
                aria-label={sidebarOpen ? t('收起场景面板') : t('展开场景面板')}
                onClick={onToggleSidebar}
            >
                {t('场景')}
            </Button>
            <Segmented<ViewMode>
                value={view}
                onChange={(value) => session.setView(value)}
                options={VIEW_MODES.map((mode) => ({ value: mode, label: labels[mode] }))}
            />

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
                        icon={<UndoOutlined />}
                        aria-label={t('撤销')}
                        disabled={!canUndo}
                        onClick={() => session.undo()}
                    />
                </Tooltip>
                <Tooltip title={t('重做 Ctrl+Shift+Z')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<RedoOutlined />}
                        aria-label={t('重做')}
                        disabled={!canRedo}
                        onClick={() => session.redo()}
                    />
                </Tooltip>
                <span className="topbar__divider" />
                <Tooltip title={t('导出图片')}>
                    <Button
                        size="small"
                        icon={<PictureOutlined />}
                        aria-label={t('导出图片')}
                        onClick={() => void session.snapshot()}
                    >
                        <span className="topbar__label">{t('导出图片')}</span>
                    </Button>
                </Tooltip>
                <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={() => setExportOpen(true)}>
                    <span className="topbar__label">{t('导出运镜视频')}</span>
                </Button>
                {exportOpen ? <ExportDialog open onClose={() => setExportOpen(false)} /> : null}
                <Tooltip title={t('设置')}>
                    <Button
                        type="text"
                        size="small"
                        icon={<SettingOutlined />}
                        aria-label={t('设置')}
                        onClick={() => setSettingsOpen(true)}
                    />
                </Tooltip>
                <Popover
                    content={<HelpPanel />}
                    trigger="click"
                    placement="bottomRight"
                    overlayClassName="help-popover"
                    // Dialogs stack above the editor; a help popover floating over them looks
                    // like part of the dialog and steals its clicks.
                    open={helpOpen && !anyDialogOpen}
                    onOpenChange={(open) => setHelpOpen(open && !anyDialogOpen)}
                >
                    <Button type="text" size="small" icon={<QuestionCircleOutlined />} aria-label={t('操作与快捷键')} />
                </Popover>
                <Dropdown menu={moreMenu} placement="bottomRight" trigger={['click']}>
                    <Button type="text" size="small" icon={<MoreOutlined />} aria-label={t('更多')} />
                </Dropdown>
                {!inspectorOpen ? (
                    <Tooltip title={t('显示属性面板')}>
                        <Button
                            type="text"
                            size="small"
                            icon={<LeftOutlined />}
                            aria-label={t('显示属性面板')}
                            aria-expanded={false}
                            aria-controls="director-inspector"
                            onClick={onToggleInspector}
                        />
                    </Tooltip>
                ) : null}
                {window.parent !== window ? (
                    <>
                        <Tooltip title={t('导演助手')}>
                            <Button type="text" size="small" icon={<MessageOutlined />} aria-label={t('导演助手')} onClick={() => requestHostAgentOpen()} />
                        </Tooltip>
                        <Tooltip title={t('返回画布')}>
                            <Button type="text" size="small" icon={<CloseOutlined />} aria-label={t('返回画布')} onClick={requestHostClose} />
                        </Tooltip>
                    </>
                ) : null}
                {resetProjectOpen ? <ResetProjectDialog open onClose={() => setResetProjectOpen(false)} /> : null}
                {projectOpen ? <ProjectDialog open onClose={() => setProjectOpen(false)} /> : null}
                <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </div>
        </header>
    );
}
