import { t } from '@/i18n';
import { InputNumber, Segmented, Select, Slider } from "antd";
import { useState } from "react";
import {
  aspectRatioStyle,
  isAspectRatioParam,
  optionLabel,
  optionValue,
  paramPresentation,
  sliderTrackDomain,
  sliderTrackPosition,
  sliderValueFromTrack,
} from "../../utils/modelPresentation.ts";
import { IconSymbol } from "../components/IconSymbol";
import { VoicePickerDialog } from "../components/VoicePickerDialog";
import type { WorkflowNodeActions } from "./WorkflowCanvas";
import type { GenerationNodeState } from "./generationNodeState";

/**
 * 参数控件的形状只由目录的 presentation 决定：选项少时用分段按钮或选项块，
 * 比例提供方向图形，倍率型滑杆按目录声明的对数分布，其余控件在这里统一渲染，底栏只显示摘要。
 */
export function GenerationSettingsPanel({
  nodeId,
  state,
  actions,
  onConfigChange,
}: {
  nodeId: string;
  state: GenerationNodeState;
  actions: WorkflowNodeActions;
  onConfigChange: (key: string, value: unknown) => void;
}) {
  const { activeInputMode, inputModes, params } = state;
  const [voicePickerKey, setVoicePickerKey] = useState("");
  const voiceParam = params.find((param) => paramPresentation(param).control === "voice");
  return (
    <div
      className="generation-settings-panel nodrag nopan nowheel"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {inputModes.length > 1 && (
        <section>
          <p>{t("ui.GenerationSettingsPanel.text.9d48527d")}</p>
          <Segmented
            size="small"
            value={activeInputMode?.value}
            onChange={(value) => actions.setInputMode(nodeId, String(value))}
            options={inputModes.map((mode) => ({ value: mode.value, label: mode.label }))}
          />
        </section>
      )}
      {params.map((param, paramIndex) => {
        const current = state.config[param.key] ?? param.default;
        const presentation = paramPresentation(param);
        const control = presentation.control || (param.type === "boolean" ? "toggle" : (param.options || []).length ? "segmented" : param.type === "number" ? "number" : "text");
        const previousGroup = paramIndex > 0 ? String(paramPresentation(params[paramIndex - 1]).group || "") : "";
        const group = String(presentation.group || "");
        const groupHeading = group && group !== previousGroup
          ? <h5 className="generation-settings-group-title">{group}</h5>
          : null;
        if (control === "toggle") {
          return (
            <div className="generation-settings-param" key={param.key}>
              {groupHeading}
              <section>
                <p>{param.label}</p>
                <div className="generation-settings-chips">
                  <Segmented
                    size="small"
                    value={Boolean(current) ? "on" : "off"}
                    onChange={(value) => onConfigChange(param.key, value === "on")}
                    options={[
                      { value: "on", label: t("ui.GenerationSettingsPanel.text.256783b7") },
                      { value: "off", label: t("ui.CanvasToolbarCustomizeDialog.arialabel.6c14bd7f") },
                    ]}
                  />
                </div>
              </section>
            </div>
          );
        }
        if (control === "slider") {
          const domain = sliderTrackDomain(param);
          const value = Number(current ?? presentation.min);
          return (
            <div className="generation-settings-param" key={param.key}>
              {groupHeading}
              <section>
                <p>{param.label}</p>
                <div className="generation-settings-slider">
                  <Slider
                    className="nodrag nopan"
                    min={domain.min}
                    max={domain.max}
                    step={domain.step}
                    value={sliderTrackPosition(param, value)}
                    onChange={(next) => onConfigChange(param.key, sliderValueFromTrack(param, next))}
                    tooltip={{ open: false }}
                  />
                  <output>{value}{presentation.unit || ""}</output>
                </div>
              </section>
            </div>
          );
        }
        if (control === "voice") {
          return (
            <div className="generation-settings-param" key={param.key}>
              {groupHeading}
              <section>
                <p>{param.label}</p>
                <button
                  type="button"
                  className="generation-settings-input generation-settings-voice nodrag nopan"
                  onClick={() => setVoicePickerKey(param.key)}
                >
                  <span>{optionLabel(param, current)}</span>
                  <IconSymbol name="chevron-down" />
                </button>
              </section>
            </div>
          );
        }
        if (control === "select") {
          return (
            <div className="generation-settings-param" key={param.key}>
              {groupHeading}
              <section>
                <p>{param.label}</p>
                <Select
                  className="generation-settings-input nodrag nopan"
                  aria-label={param.label}
                  value={String(current ?? "")}
                  onChange={(next) => {
                    const matched = (param.options || []).find((option) => String(optionValue(option)) === next);
                    onConfigChange(param.key, matched === undefined ? next : optionValue(matched));
                  }}
                  options={(param.options || []).map((option) => {
                    const value = optionValue(option);
                    return { value: String(value), label: optionLabel(param, value) };
                  })}
                />
              </section>
            </div>
          );
        }
        if (!(param.options || []).length) {
          const numeric = control === "number";
          return (
            <div className="generation-settings-param" key={param.key}>
              {groupHeading}
              <section>
                <p>
                  <span>{param.label}</span>
                  {numeric && (Number.isFinite(Number(presentation.min)) || Number.isFinite(Number(presentation.max))) && (
                    <small className="generation-settings-range" title={t("ui.GenerationSettingsPanel.text.9c0f4b2a")}>
                      {t("ui.GenerationSettingsPanel.text.9c0f4b2a")} {Number.isFinite(Number(presentation.min)) ? presentation.min : "…"}–{Number.isFinite(Number(presentation.max)) ? presentation.max : "…"}{presentation.unit || ""}
                    </small>
                  )}
                </p>
                {numeric ? (
                  <InputNumber
                    className="generation-settings-input nodrag nopan"
                    {...(Number.isFinite(Number(presentation.min)) ? { min: Number(presentation.min) } : {})}
                    {...(Number.isFinite(Number(presentation.max)) ? { max: Number(presentation.max) } : {})}
                    {...(Number.isFinite(Number(presentation.step)) ? { step: Number(presentation.step) } : {})}
                    value={current === undefined || current === "" ? null : Number(current)}
                    onChange={(value) => onConfigChange(param.key, value === null ? undefined : value)}
                  />
                ) : (
                  <input
                    className="generation-settings-input nodrag nopan"
                    type="text"
                    value={String(current ?? "")}
                    onChange={(event) => onConfigChange(param.key, event.target.value)}
                  />
                )}
                {presentation.limitNoteKey && <small className="generation-settings-limit-hint">{t(presentation.limitNoteKey)}</small>}
              </section>
            </div>
          );
        }
        return (
          <div className="generation-settings-param" key={param.key}>
            {groupHeading}
            <section>
              <p>{param.label}</p>
              <div className={`generation-settings-options${control === "ratio" || isAspectRatioParam(param) ? " ratios" : ""}`}>
                {(param.options || []).map((option) => {
                  const value = optionValue(option);
                  const active = value === current;
                  return (
                    <button
                      key={String(value)}
                      type="button"
                      className={active ? "active" : ""}
                      onClick={() => onConfigChange(param.key, value)}
                    >
                      {(control === "ratio" || isAspectRatioParam(param)) && (
                        <span className="generation-settings-ratio"><span style={aspectRatioStyle(value)} /></span>
                      )}
                      <span>{optionLabel(param, value)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        );
      })}
      {voiceParam && (
        <VoicePickerDialog
          open={voicePickerKey === voiceParam.key}
          value={String(state.config[voiceParam.key] ?? voiceParam.default ?? "")}
          onSelect={(voiceId) => {
            onConfigChange(voiceParam.key, voiceId);
            setVoicePickerKey("");
          }}
          onClose={() => setVoicePickerKey("")}
        />
      )}
    </div>
  );
}
