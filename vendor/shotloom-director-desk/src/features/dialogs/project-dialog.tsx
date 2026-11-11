import { Button, Input, Modal, Select } from 'antd';
import { useState } from 'react';
import { ASPECTS, FRAME_RATES } from '@/core/model.ts';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useProject } from '@/state/use-editor.ts';
import './dialogs.css';

/** Project name, aspect and frame rate. */
export function ProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const t = useTranslation();
    const project = useProject();
    const [name, setName] = useState(project.name);
    const [aspect, setAspect] = useState(project.aspect);
    const [fps, setFps] = useState(project.fps);

    const apply = () => {
        if (session.updateProjectSettings({ name, aspect, fps })) onClose();
    };

    return (
        <Modal
            open={open}
            title={t('项目设置')}
            onCancel={onClose}
            width={480}
            footer={
                <>
                    <Button onClick={onClose}>{t('取消')}</Button>
                    <Button type="primary" onClick={apply}>
                        {t('应用')}
                    </Button>
                </>
            }
        >
            <div className="settings-stack">
                <label className="export-field">
                    <span>{t('项目名称')}</span>
                    <Input
                        value={name}
                        maxLength={80}
                        aria-label={t('项目名称')}
                        onChange={(event) => setName(event.target.value)}
                    />
                </label>
                <label className="export-field">
                    <span>{t('画幅')}</span>
                    <Select
                        value={aspect}
                        aria-label={t('画幅')}
                        onChange={(value) => setAspect(value)}
                        options={ASPECTS.map((value) => ({ value, label: value }))}
                    />
                </label>
                <label className="export-field">
                    <span>{t('帧率')}</span>
                    <Select
                        value={fps}
                        aria-label={t('帧率')}
                        onChange={(value) => setFps(value)}
                        options={FRAME_RATES.map((value) => ({ value, label: `${value} fps` }))}
                    />
                </label>
                <p className="muted small">{t('修改画幅或帧率会重建取景画面，时间与关键帧保持不变。')}</p>
            </div>
        </Modal>
    );
}
