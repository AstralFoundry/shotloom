import {
    AimOutlined,
    CopyOutlined,
    DeleteOutlined,
    EyeInvisibleOutlined,
    EyeOutlined,
    VerticalAlignBottomOutlined,
} from '@ant-design/icons';
import { App, Menu } from 'antd';
import { useEffect } from 'react';
import type { Entity } from '@/core/model.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useProject } from '@/state/use-editor.ts';

export interface ContextMenuTarget {
    entityId: string;
    x: number;
    y: number;
}

interface Props {
    target: ContextMenuTarget | null;
    onClose: () => void;
}

/** Right-click menu for scene objects, anchored inside the stage viewport. */
export function StageContextMenu({ target, onClose }: Props) {
    const t = useTranslation();
    const project = useProject();
    const { modal } = App.useApp();
    const entity: Entity | undefined = target
        ? project.entities.find((item) => item.id === target.entityId)
        : undefined;

    useEffect(() => {
        if (!target) return;
        // Capture-phase outside close must ignore clicks inside the menu, otherwise the
        // menu unmounts on pointerdown and its click handler never runs.
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest('.context-menu')) return;
            onClose();
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };
        document.addEventListener('pointerdown', close, true);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', close, true);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [target, onClose]);

    if (!target || !entity) return null;

    const confirmDelete = () => {
        modal.confirm({
            className: 'delete-confirm',
            icon: <DeleteOutlined />,
            centered: true,
            width: 400,
            title: t('删除对象') + `「${entity.name}」`,
            content: t('删除后可用撤销恢复。'),
            okText: t('删除'),
            okButtonProps: { danger: true },
            cancelText: t('取消'),
            onOk: () => {
                session.deleteSelected();
                onClose();
            },
        });
    };

    return (
        <div
            className="context-menu"
            style={{ left: target.x, top: target.y }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <Menu
                selectable={false}
                onClick={({ key }) => {
                    switch (key) {
                        case 'focus':
                            session.focusSelected();
                            break;
                        case 'duplicate':
                            session.duplicateSelected();
                            break;
                        case 'visibility':
                            session.setEntityFlag('visible', !entity.visible);
                            break;
                        case 'ground':
                            session.groundSelected();
                            break;
                        case 'delete':
                            confirmDelete();
                            return;
                    }
                    onClose();
                }}
                items={[
                    { key: 'focus', icon: <AimOutlined />, label: t('定位对象') },
                    { key: 'duplicate', icon: <CopyOutlined />, label: t('复制') },
                    {
                        key: 'visibility',
                        icon: entity.visible ? <EyeInvisibleOutlined /> : <EyeOutlined />,
                        label: entity.visible ? t('隐藏') : t('显示'),
                    },
                    { key: 'ground', icon: <VerticalAlignBottomOutlined />, label: t('贴地') },
                    { type: 'divider' },
                    { key: 'delete', icon: <DeleteOutlined />, label: t('删除'), danger: true },
                ]}
            />
        </div>
    );
}
