import {
    AppstoreOutlined,
    BulbOutlined,
    CameraOutlined,
    DownOutlined,
    EyeInvisibleOutlined,
    EyeOutlined,
    ImportOutlined,
    RightOutlined,
    SearchOutlined,
    UserOutlined,
} from '@ant-design/icons';
import { Button, Input, Tabs, Tooltip } from 'antd';
import { useState } from 'react';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';
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

const SCENE_GROUPS = [
    { key: 'camera', label: '机位', icon: <CameraOutlined /> },
    { key: 'actor', label: '角色', icon: <UserOutlined /> },
    { key: 'light', label: '灯光', icon: <BulbOutlined /> },
    { key: 'prop', label: '道具', icon: <AppstoreOutlined /> },
] as const;

function sceneGroup(entity: Entity): (typeof SCENE_GROUPS)[number]['key'] {
    if (entity.light) return 'light';
    if (entity.kind === 'camera') return 'camera';
    if (entity.kind === 'actor' || entity.kind === 'crowd') return 'actor';
    return 'prop';
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
        <aside className="sidebar" aria-label={t('场景面板')}>
            {resize}
            <Tabs
                size="small"
                activeKey={tab}
                onChange={(key) =>
                    useEditorStore
                        .getState()
                        .patch({ sidebarTab: key === 'assets' ? 'assets' : key === 'shots' ? 'shots' : 'scene' })
                }
                items={[
                    { key: 'scene', label: t('场景') },
                    { key: 'assets', label: t('添加') },
                    { key: 'shots', label: t('镜头') },
                ]}
            />

            {tab !== 'shots' ? (
                <Input
                    id="scene-search"
                    size="small"
                    allowClear
                    prefix={<SearchOutlined />}
                    placeholder={tab === 'assets' ? t('搜索白模资产') : t('搜索场景对象')}
                    value={query}
                    onChange={(event) => useEditorStore.getState().patch({ query: event.target.value })}
                />
            ) : null}

            <div className="sidebar__body">
                {tab === 'shots' ? (
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
                                        {expanded ? <DownOutlined /> : <RightOutlined />}
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
                                                                <EyeOutlined />
                                                            ) : (
                                                                <EyeInvisibleOutlined />
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

            <div className="sidebar__footer">
                <Button size="small" block icon={<CameraOutlined />} onClick={() => session.addCamera()}>
                    {t('添加机位')}
                </Button>
                <Button size="small" block icon={<ImportOutlined />} onClick={() => setModelImportOpen(true)}>
                    {t('导入模型')}
                </Button>
            </div>
            {modelImportOpen ? <ModelImportDialog open onClose={() => setModelImportOpen(false)} /> : null}
        </aside>
    );
}
