import { useState } from 'react';
import { Empty, Select } from 'antd';
import { CameraPresetPicker } from '@/features/timeline/preset-picker.tsx';
import { useTranslation } from '@/shared/i18n/use-translation.ts';
import { session } from '@/state/editor-session.ts';
import { useEditorStore } from '@/state/editor-store.ts';
import { useProject } from '@/state/use-editor.ts';

/** Camera moves edit an existing camera; placement presets create a new one. */
export function CameraMovesPanel() {
    const t = useTranslation();
    const [chosenSubject, setSubject] = useState<string>();
    const [chosenForeground, setForeground] = useState<string>();
    const project = useProject();
    const selected = useEditorStore((state) => state.selected);
    const preview = useEditorStore((state) => state.preview);
    const cameras = project.entities.filter((entity) => entity.camera);
    const camera =
        cameras.find((entity) => entity.id === selected) ??
        cameras.find((entity) => entity.id === preview) ??
        cameras[0];

    const subjects = project.entities.filter((entity) => !entity.camera && !entity.light && entity.visible);
    const subjectId =
        subjects.find((entity) => entity.id === chosenSubject)?.id ??
        subjects.find((entity) => entity.id === camera?.camera?.targetId)?.id ??
        subjects.find((entity) => entity.kind === 'actor')?.id;
    const foregrounds = subjects.filter((entity) => entity.id !== subjectId);
    const foregroundId = foregrounds.find((entity) => entity.id === chosenForeground)?.id;

    if (!camera)
        return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('先添加一个机位，再为它设置运镜')} />;

    return (
        <div className="camera-moves-panel stack">
            <label className="field-row">
                <span className="field-row__label">{t('拍摄机位')}</span>
                <Select
                    size="small"
                    aria-label={t('运镜机位')}
                    value={camera.id}
                    options={cameras.map((entity) => ({ value: entity.id, label: entity.name }))}
                    onChange={(id) => {
                        session.selectEntity(id);
                        session.setPreview(id);
                    }}
                />
            </label>
            <label className="field-row">
                <span className="field-row__label">{t('跟拍主体')}</span>
                <Select
                    size="small"
                    aria-label={t('跟拍主体')}
                    value={subjectId}
                    placeholder={t('请选择主体')}
                    options={subjects.map((entity) => ({ value: entity.id, label: entity.name }))}
                    onChange={setSubject}
                />
            </label>
            <label className="field-row">
                <span className="field-row__label">{t('前景遮挡物')}</span>
                <Select
                    size="small"
                    allowClear
                    aria-label={t('前景遮挡物')}
                    value={foregroundId}
                    placeholder={t('前景运镜需要选择遮挡物')}
                    options={foregrounds.map((entity) => ({ value: entity.id, label: entity.name }))}
                    onChange={setForeground}
                />
            </label>
            <p className="muted small camera-moves-panel__hint">
                {camera.locked ? t('当前机位已锁定，解锁后可应用运镜') : t('从当前时间开始，时长 4 秒')}
                {!camera.locked && camera.path ? (
                    <>
                        <br />
                        {t('应用预设会替换此机位的现有运镜')}
                    </>
                ) : null}
            </p>
            <CameraPresetPicker
                inline
                disabled={camera.locked}
                hasSubject={!!subjectId}
                hasForeground={!!foregroundId}
                onChoose={(id) => {
                    if (session.applyCameraPreset(id, camera.id, { subjectId, foregroundId })) {
                        session.selectEntity(camera.id);
                        session.setInspectorTab('camera');
                        if (useEditorStore.getState().view === 'stage') session.setView('pip');
                    }
                }}
            />
        </div>
    );
}
