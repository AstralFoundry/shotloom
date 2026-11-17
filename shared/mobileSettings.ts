export const mobileSettingKeys = ['locale', 'agentCanRunNodes', 'agentAutoEval', 'agentAutoLayout', 'agentPreferredTextModel', 'agentPreferredImageModel', 'agentPreferredVideoModel'] as const;
export type MobileSettings = { locale?: 'zh-CN' | 'en-US'; agentCanRunNodes?: boolean; agentAutoEval?: boolean; agentAutoLayout?: boolean; agentPreferredTextModel?: string; agentPreferredImageModel?: string; agentPreferredVideoModel?: string };
export function pickMobileSettings(value: Record<string, unknown>): MobileSettings {
  return Object.fromEntries(mobileSettingKeys.filter(key => value[key] !== undefined).map(key => [key, value[key]]));
}
