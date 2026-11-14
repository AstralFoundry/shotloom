import { worldContactAnchors } from '@/core/assets/contact-anchors.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { FocusIcon, CopyIcon, Trash2Icon, EyeOffIcon, EyeIcon, MessageCircleIcon, ArrowDownToLineIcon } from '@/shared/ui/icons.tsx';
import { App, Menu } from 'antd';
import { useEffect } from 'react';
import type { Entity } from '@/core/model.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { requestHostAgentOpen } from '@/app/host-bridge.ts';
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
            icon: <Trash2Icon />,
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
                    if (key.startsWith('normal:')) {
                        const [targetId, anchorId] = JSON.parse(key.slice(7)) as [string, string];
                        try { session.applyBatch([{ operation: 'align_surface', entityId: entity.id, targetEntityId: targetId, ...(anchorId ? { anchorId } : {}) }], useEditorStore.getState().revision); } catch (error) { modal.error({ content: String(error) }); }
                        onClose(); return;
                    }
                    if (key.startsWith('surface:')) {
                        try { session.applyBatch([{ operation: 'place_on_surface', entityId: entity.id, targetEntityId: key.slice(8) }], useEditorStore.getState().revision); } catch (error) { modal.error({ content: String(error) }); }
                        onClose(); return;
                    }
                    switch (key) {
                        case 'focus':
                            session.focusSelected();
                            break;
                        case 'send-to-agent':
                            requestHostAgentOpen(entity.id);
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
                    { key: 'focus', icon: <FocusIcon />, label: t('定位对象') },
                    { key: 'send-to-agent', icon: <MessageCircleIcon />, label: t('发送给导演助手') },
                    { key: 'duplicate', icon: <CopyIcon />, label: t('复制') },
                    {
                        key: 'visibility',
                        icon: entity.visible ? <EyeOffIcon /> : <EyeIcon />,
                        label: entity.visible ? t('隐藏') : t('显示'),
                    },
                    { key: 'normal', label: t('按接触点贴面'), children: project.entities.filter(e => e.kind === 'prop' && e.id !== entity.id).flatMap(e => {
                        const root = session.engineOrNull?.models.get(e.id);
                        return root ? [{ key: `normal:${JSON.stringify([e.id, ''])}`, label: `${e.name} · ${t('最近表面')}` }, ...worldContactAnchors(e, root).map(a => ({ key: `normal:${JSON.stringify([e.id, a.id])}`, label: `${e.name} · ${a.id}` }))] : [];
                    }) },
                    { key: 'surface', label: t('落到物体表面'), children: project.entities.filter(e => e.kind === 'prop' && e.id !== entity.id && e.visible).map(e => ({ key: `surface:${e.id}`, label: e.name })) },
                    { key: 'ground', icon: <ArrowDownToLineIcon />, label: t('贴地') },
                    { type: 'divider' },
                    { key: 'delete', icon: <Trash2Icon />, label: t('删除'), danger: true },
                ]}
            />
        </div>
    );
}
