import {
    DownloadOutlined,
    FileAddOutlined,
    MoreOutlined,
    PictureOutlined,
    QuestionCircleOutlined,
    RedoOutlined,
    SettingOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    MoonOutlined,
    SunOutlined,
    UndoOutlined,
} from '@ant-design/icons';
import { Button, Dropdown, Popover, Segmented, Tooltip } from 'antd';
import { useState } from 'react';
import { useLanguage, useTranslation } from '@/shared/i18n/use-translation.ts';
import { setLanguage } from '@/shared/i18n/locale.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore, type ViewMode } from '@/state/editor-store.ts';
import { useProject, useRevision } from '@/state/use-editor.ts';
import { ExportDialog } from '@/features/export/export-dialog.tsx';
import { HelpPanel } from '@/features/dialogs/help-dialog.tsx';
import { ProjectDialog } from '@/features/dialogs/project-dialog.tsx';
import { NewProjectDialog } from '@/features/dialogs/new-project-dialog.tsx';
import { SettingsDialog } from '@/features/settings/settings-dialog.tsx';
import { getEditorTheme } from '@/app/providers/theme.ts';

const VIEW_MODES: ViewMode[] = ['stage', 'split', 'shot'];

export function TopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const t = useTranslation();
    // Subscribe to the language itself so the toggle label re-renders on switch.
    const language = useLanguage();
    const [exportOpen, setExportOpen] = useState(false);
    const [projectOpen, setProjectOpen] = useState(false);
    const [newProjectOpen, setNewProjectOpen] = useState(false);
    const [helpOpen, setHelpOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const project = useProject();
    const view = useEditorStore((state) => state.view);
    const status = useEditorStore((state) => state.status);
    const dirty = useEditorStore((state) => state.dirty);

    useRevision();
    const canUndo = session.history.undoStack.length > 0;
    const canRedo = session.history.redoStack.length > 0;
    const anyDialogOpen = exportOpen || newProjectOpen || projectOpen || settingsOpen;
    const theme = getEditorTheme();

    const labels: Record<ViewMode, string> = {
        stage: t('导演视角'),
        split: t('分屏'),
        shot: t('机位视角'),
    };

    /** Secondary actions live behind one menu so the bar stops overflowing on narrow screens. */
    const moreMenu = {
        items: [
            { key: 'new', icon: <FileAddOutlined />, label: t('新建工程') },
            { key: 'settings-project', icon: <SettingOutlined />, label: t('项目设置') },
            { key: 'settings', icon: <SettingOutlined />, label: t('设置') },
            { type: 'divider' as const },
            {
                key: 'theme',
                icon: theme === 'dark' ? <SunOutlined /> : <MoonOutlined />,
                label: theme === 'dark' ? t('浅色') : t('深色'),
            },
            { key: 'language', label: language === 'en' ? '中文' : 'English' },
            { key: 'help', icon: <QuestionCircleOutlined />, label: t('操作与快捷键') },
        ],
        onClick: ({ key }: { key: string }) => {
            if (key === 'new') setNewProjectOpen(true);
            else if (key === 'settings-project') setProjectOpen(true);
            else if (key === 'settings') setSettingsOpen(true);
            else if (key === 'theme') session.setTheme(theme === 'dark' ? 'light' : 'dark');
            else if (key === 'language') setLanguage(language === 'en' ? 'zh-CN' : 'en');
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
            <div className="topbar__brand">
                <span className="topbar__logo">D</span>
                <div className="topbar__title">
                    <strong>{t('导演台')}</strong>
                    <small title={project.name}>{project.name}</small>
                </div>
            </div>

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
                {newProjectOpen ? <NewProjectDialog open onClose={() => setNewProjectOpen(false)} /> : null}
                {projectOpen ? <ProjectDialog open onClose={() => setProjectOpen(false)} /> : null}
                <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </div>
        </header>
    );
}
