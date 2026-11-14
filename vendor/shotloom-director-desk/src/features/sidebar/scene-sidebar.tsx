import { LayersIcon, LayoutGridIcon, LightbulbIcon, CameraIcon, ChevronDownIcon, EyeOffIcon, EyeIcon, ImportIcon, PlusIcon, ChevronRightIcon, SearchIcon, UserRoundIcon, ClapperboardIcon } from '@/shared/ui/icons.tsx';
import { Button, Dropdown, Input, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';
import { CAMERA_PLACEMENTS } from '@/core/cinematography/camera-placements.ts';
import type { SidebarTab } from '@/state/editor-store.ts';
import type { Entity } from '@/core/model.ts';
import { AssetBrowser } from './asset-browser.tsx';
import { ModelImportDialog } from '@/features/model-import/model-import-dialog.tsx';
import { ShotList } from '@/features/shots/shot-list.tsx';

const KIND_LABELS: Partial<Record<Entity['kind'], string>> = {
    actor: '人物',
    camera: '摄影机',
    prop: '道具',
    crowd: '群演',
};

/** Panel switch only: one rail item per panel, each with a two-character label. */
const RAIL_TABS = [
    { key: 'scene', label: '场景', icon: <LayersIcon /> },
    { key: 'assets', label: '资产', icon: <LayoutGridIcon /> },
    { key: 'cameras', label: '添加机位', icon: <CameraIcon /> },
    { key: 'shots', label: '镜头', icon: <ClapperboardIcon /> },
] as const;

const PANEL_TITLES = { scene: '场景', assets: '资产', cameras: '添加机位', shots: '镜头' } as const;

const SCENE_GROUPS = [
    { key: 'camera', label: '机位', icon: <CameraIcon /> },
    { key: 'actor', label: '角色', icon: <UserRoundIcon /> },
    { key: 'light', label: '灯光', icon: <LightbulbIcon /> },
    { key: 'prop', label: '道具', icon: <LayoutGridIcon /> },
] as const;

function sceneGroup(entity: Entity): (typeof SCENE_GROUPS)[number]['key'] {
    if (entity.light) return 'light';
    if (entity.kind === 'camera') return 'camera';
    if (entity.kind === 'actor' || entity.kind === 'crowd') return 'actor';
    return 'prop';
}

/** The navigation stays reachable when the content panel is collapsed. */
export function SceneRail({ open, onSelect }: { open: boolean; onSelect: (tab: SidebarTab) => void }) {
    const t = useTranslation();
    const tab = useEditorStore((state) => state.sidebarTab);
    return (
        <nav className="sidebar__rail" aria-label={t('侧栏面板')}>
            {RAIL_TABS.map((item) => (
                <Tooltip key={item.key} title={t(item.label)} placement="right">
                    <button
                        type="button"
                        className={`sidebar__rail-item ${open && tab === item.key ? 'is-active' : ''}`}
                        aria-pressed={open && tab === item.key}
                        aria-expanded={open && tab === item.key}
                        aria-controls="director-sidebar"
                        aria-label={t(item.label)}
                        onClick={() => onSelect(item.key)}
                    >
                        {item.icon}
                        <span>{t(item.label)}</span>
                    </button>
                </Tooltip>
            ))}
        </nav>
    );
}

export function SceneSidebar({ resize }: { resize?: React.ReactNode }) {
    const t = useTranslation();
    const project = useProject();
    const selected = useEditorStore((state) => state.selected);
    const tab = useEditorStore((state) => state.sidebarTab);
    const query = useEditorStore((state) => state.query);
    const [modelImportOpen, setModelImportOpen] = useState(false);
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    const needle = query.trim().toLowerCase();
    const entities = project.entities.filter((entity) => !needle || entity.name.toLowerCase().includes(needle));

    return (
        <aside id="director-sidebar" className="sidebar" aria-label={t('侧栏')}>
            {resize}

            <div className="sidebar__panel">
                <header className="sidebar__header">
                    <span className="sidebar__title">{t(PANEL_TITLES[tab])}</span>
                    {tab !== 'shots' && tab !== 'cameras' ? (
                        <Dropdown
                            trigger={['click']}
                            placement="bottomRight"
                            menu={{
                                items: [
                                    { key: 'camera', icon: <CameraIcon />, label: t('添加机位') },
                                    { key: 'import', icon: <ImportIcon />, label: t('导入模型') },
                                ],
                                onClick: ({ key }) => {
                                    if (key === 'camera') session.addCamera();
                                    else setModelImportOpen(true);
                                },
                            }}
                        >
                            <Button type="text" size="small" icon={<PlusIcon />} aria-label={t('添加')} />
                        </Dropdown>
                    ) : null}
                </header>

                {tab !== 'shots' && tab !== 'cameras' ? (
                    <Input
                        id="scene-search"
                        size="small"
                        allowClear
                        prefix={<SearchIcon />}
                        placeholder={tab === 'assets' ? t('搜索白模资产') : t('搜索场景对象')}
                        value={query}
                        onChange={(event) => useEditorStore.getState().patch({ query: event.target.value })}
                    />
                ) : null}

                <div className="sidebar__body">
                    {tab === 'cameras' ? (
                        <div className="camera-placement-grid">
                            {CAMERA_PLACEMENTS.map((preset) => (
                                <Button
                                    key={preset.id}
                                    className="camera-placement-card"
                                    aria-label={t(preset.label)}
                                    onClick={() => session.addCameraPlacement(preset.id)}
                                >
                                    <CameraIcon />
                                    <span>{t(preset.label)}</span>
                                </Button>
                            ))}
                        </div>
                    ) : tab === 'shots' ? (
                        <ShotList onExport={(shot) => session.exportShot(shot)} />
                    ) : tab === 'assets' ? (
                        <AssetBrowser />
                    ) : (
                        <div className="scene-groups">
                            {SCENE_GROUPS.map((group) => {
                                const members = entities.filter((entity) => sceneGroup(entity) === group.key);
                                if (!members.length) return null;
                                const expanded = Boolean(needle) || !collapsedGroups[group.key];
                                return (
                                    <section className="scene-group" key={group.key}>
                                        <button
                                            type="button"
                                            className="scene-group__heading"
                                            aria-expanded={expanded}
                                            onClick={() =>
                                                setCollapsedGroups((current) => ({
                                                    ...current,
                                                    [group.key]: !current[group.key],
                                                }))
                                            }
                                        >
                                            {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                                            <span>{t(group.label)}</span>
                                            <small>{members.length}</small>
                                        </button>
                                        {expanded ? (
                                            <ul className="scene-list">
                                                {members.map((entity) => (
                                                    <li key={entity.id}>
                                                        <button
                                                            type="button"
                                                            className={`scene-list__item ${entity.id === selected ? 'is-selected' : ''}`}
                                                            onClick={() => session.selectEntity(entity.id)}
                                                        >
                                                            <span
                                                                className="scene-list__icon"
                                                                style={{ color: entity.light ? '#d9b26a' : entity.color }}
                                                            >
                                                                {group.icon}
                                                            </span>
                                                            <span className="scene-list__name" title={entity.name}>
                                                                {entity.name}
                                                            </span>
                                                            <small>
                                                                {t(
                                                                    entity.light
                                                                        ? '灯光'
                                                                        : (KIND_LABELS[entity.kind] ?? '对象'),
                                                                )}
                                                            </small>
                                                        </button>
                                                        <Tooltip title={entity.visible ? t('隐藏') : t('显示')}>
                                                            <button
                                                                type="button"
                                                                className={`scene-list__visibility ${entity.visible ? '' : 'is-off'}`}
                                                                aria-label={entity.visible ? t('隐藏') : t('显示')}
                                                                onClick={() => {
                                                                    session.selectEntity(entity.id);
                                                                    session.setEntityFlag('visible', !entity.visible);
                                                                }}
                                                            >
                                                                {entity.visible ? (
                                                                    <EyeIcon />
                                                                ) : (
                                                                    <EyeOffIcon />
                                                                )}
                                                            </button>
                                                        </Tooltip>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </section>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
            {modelImportOpen ? <ModelImportDialog open onClose={() => setModelImportOpen(false)} /> : null}
        </aside>
    );
}
