import { useState } from 'react';
import { Modal, Select } from 'antd';
import { t } from '@/i18n';
import { getAvailableModelIdsByType } from '@/store/settingsStore';
import {
  getGenerationInputModes,
  getModelInfo,
  getModelSchema,
  resolveModeIdForInputMode,
} from '@/domain/catalog/ModelCatalog';
import { compileGenerationNodeConfig } from '@/domain/graph/GenerationNodeContract';
import { GenerationSettingsPanel } from './GenerationSettingsPanel';
import { generationNodeState, toGenerationConfigParam } from './generationNodeState';

export interface BatchGenerationSettings {
  model: string;
  inputMode: string;
  config: Record<string, unknown>;
}

/** 本地草稿确认后才写入表格；模型参数使用现有目录控件和编译器。 */
export function BatchGenerationSettingsDialog({
  initial,
  count,
  concurrency,
  onClose,
  onConfirm,
}: {
  initial?: BatchGenerationSettings;
  count: number;
  concurrency: number;
  onClose: () => void;
  onConfirm: (settings: BatchGenerationSettings) => void;
}) {
  const models = getAvailableModelIdsByType('imageGeneration');
  const [settings, setSettings] = useState<BatchGenerationSettings>(() => {
    const model = initial?.model && models.includes(initial.model) ? initial.model : models[0] || '';
    const modes = getGenerationInputModes(model);
    const mode = modes.find((mode) => mode.value === initial?.inputMode) || modes.find((mode) => mode.maxImages > 0);
    const inputMode = mode?.value || '';
    return {
      model,
      inputMode,
      config: compileGenerationNodeConfig(
        initial?.config || {},
        getModelSchema('imageGeneration', model, resolveModeIdForInputMode(model, inputMode)).params.map(
          toGenerationConfigParam,
        ),
      ),
    };
  });
  const state = generationNodeState(
    { id: 'batch-generation-settings', type: 'imageGeneration', ...settings },
    true,
    [],
  );
  function setMode(inputMode: string, model = settings.model) {
    const params = getModelSchema('imageGeneration', model, resolveModeIdForInputMode(model, inputMode)).params.map(
      toGenerationConfigParam,
    );
    setSettings((current) => ({ model, inputMode, config: compileGenerationNodeConfig(current.config, params) }));
  }
  return (
    <Modal
      open
      centered
      title={t('canvas.batch.generationSettings')}
      width={480}
      onCancel={onClose}
      okText={t('canvas.batch.startGeneration')}
      okButtonProps={{ disabled: !settings.model }}
      onOk={() => onConfirm(settings)}
    >
      <div className="batch-generation-settings">
        <p>{t('canvas.batch.generationSummary', { count, concurrency })}</p>
        <label>
          {t('ui.SettingsPanel.text.f581bd77')}
          <Select
            value={settings.model || undefined}
            showSearch
            optionFilterProp="label"
            options={models.map((model) => ({ value: model, label: getModelInfo(model)?.name || model }))}
            onChange={(model) => {
              if (model) setMode(getGenerationInputModes(model).find((mode) => mode.maxImages > 0)?.value || '', model);
            }}
          />
        </label>
        <GenerationSettingsPanel
          nodeId="batch-generation-settings"
          state={state}
          actions={{ setInputMode: (_id, mode) => setMode(mode || '') }}
          onConfigChange={(key, value) =>
            setSettings((current) => ({ ...current, config: { ...current.config, [key]: value } }))
          }
        />
      </div>
    </Modal>
  );
}
