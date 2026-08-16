import {
  type CatalogModel,
  getBuiltInCatalogModels,
} from "../../domain/catalog/ModelCatalog";
import type { ProtocolPreset } from "../../domain/provider/ProtocolPresets";

export type NewModelDraft = {
  id: string;
  name: string;
  type: "textGeneration" | "imageGeneration" | "videoGeneration" | "audioGeneration";
  presetId: string;
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

export function builtInProviderModels(providerId?: string): CatalogModel[] {
  return getBuiltInCatalogModels(providerId);
}

export function effectiveProviderModels(
  providerId: string,
  storedModels: CatalogModel[] = [],
): CatalogModel[] {
  const builtIns = builtInProviderModels(providerId);
  const overrides = new Map(storedModels.map((model) => [model.id, model]));
  const builtInIds = new Set(builtIns.map((model) => model.id));
  return [
    ...builtIns.map((model) => clone(overrides.get(model.id) || model)),
    ...storedModels.filter((model) => !builtInIds.has(model.id)).map(clone),
  ];
}

export function sameModelDefinition(left: CatalogModel, right: CatalogModel): boolean {
  const normalize = (model: CatalogModel) => {
    const value = clone(model) as CatalogModel & { overridesBuiltIn?: boolean };
    delete value.overridesBuiltIn;
    return value;
  };
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

export function starterProtocolModel(type: NewModelDraft["type"]): CatalogModel {
  const mode = type === "textGeneration"
    ? { id: "text-generation", label: "文本生成", resultKey: "resultTextPath" }
    : type === "imageGeneration"
    ? { id: "text-to-image", label: "文生图", resultKey: "resultUrlPath" }
    : type === "videoGeneration"
    ? { id: "video-generation", label: "视频生成", resultKey: "resultUrlPath" }
    : { id: "audio-generation", label: "音频生成", resultKey: "resultUrlPath" };
  return {
    id: "",
    name: "",
    provider: "",
    type,
    sortOrder: 900,
    enabled: true,
    defaultMode: mode.id,
    modes: [{
      id: mode.id,
      label: mode.label,
      endpoint: { method: "POST", path: "", scope: "root" },
      inputConstraints: {},
      outputConstraints: {},
      params: [],
      requestTemplate: {},
      [mode.resultKey]: "",
    }],
  };
}

export function presetProtocolModel(preset: ProtocolPreset): CatalogModel {
  const mode = preset.buildMode();
  return {
    id: "",
    name: "",
    provider: "",
    type: preset.type,
    sortOrder: 900,
    enabled: true,
    defaultMode: mode.id,
    modes: [mode],
  };
}

export function testPromptForType(type: string): string {
  if (type === "imageGeneration") return "一只坐在窗边的猫，卡通风格";
  if (type === "videoGeneration") return "一只猫从窗边走过";
  if (type === "audioGeneration") return "轻快、温暖的纯音乐";
  return "你好，请回复「测试成功」。";
}

export function testStatusLabel(status: string): string {
  return ({
    completed: "已完成",
    queued: "任务已提交",
    running: "运行中",
    failed: "失败",
    error: "错误",
    timeout: "超时",
    cancelled: "已取消",
  } as Record<string, string>)[status] || status;
}

export function defaultAgentProtocol(model: CatalogModel) {
  const mode = model.modes.find((item) => item.id === model.defaultMode) || model.modes[0];
  return mode?.agent;
}

export function supportsAgentTools(model: CatalogModel): boolean {
  return model.type === "textGeneration" && defaultAgentProtocol(model)?.supportsTools === true;
}
