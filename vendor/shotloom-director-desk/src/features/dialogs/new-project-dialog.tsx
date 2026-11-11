import { Alert, Button, Modal } from 'antd';
import { useState } from 'react';
import { SCENE_TEMPLATES, type SceneTemplate } from '@/core/scene-templates.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import './dialogs.css';

/** Start a fresh scene from a template; the current scene stays available through undo. */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslation();
    const dirty = useEditorStore((state) => state.dirty);
    const [template, setTemplate] = useState<SceneTemplate>(SCENE_TEMPLATES[0].id as SceneTemplate);

    const create = () => {
        if (session.newProject(template)) onClose();
    };

    return (
        <Modal
            open={open}
            title={t('新建工程')}
            onCancel={onClose}
            width={520}
            footer={
                <>
                    <Button onClick={onClose}>{t('取消')}</Button>
                    <Button type="primary" onClick={create}>
                        {t('新建工程')}
                    </Button>
                </>
            }
        >
            <div className="settings-stack">
                {dirty ? (
                    <Alert
                        type="warning"
                        showIcon
                        title={t('当前工程还有未备份的改动')}
                        description={t('新建后仍可用撤销返回当前场景；建议先确认自动备份已保存。')}
                    />
                ) : null}
                <div className="template-grid">
                    {SCENE_TEMPLATES.map((item) => (
                        <label key={item.id} className={`template-card ${template === item.id ? 'is-selected' : ''}`}>
                            <input
                                type="radio"
                                name="scene-template"
                                value={item.id}
                                checked={template === item.id}
                                onChange={() => setTemplate(item.id as SceneTemplate)}
                            />
                            <small>{t(item.type)}</small>
                            <strong>{t(item.name)}</strong>
                            <span>{t(item.detail)}</span>
                        </label>
                    ))}
                </div>
            </div>
        </Modal>
    );
}
