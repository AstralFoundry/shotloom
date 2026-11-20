/**
 * Engine copy.
 *
 * The previs workbench was written against the open-ai-canvas dictionary. Shotloom has its
 * own keys, so the engine keeps the exact upstream strings for the keys it actually uses and
 * resolves them locally; the embedding app can still override the translator.
 *
 * Placeholders use the upstream `{{name}}` form.
 */
export type PrevisLocale = "zh-CN" | "en-US";

type Catalog = Record<string, string>;

const ZH_CN: Catalog = {
    "canvasC.previsOnboarding.label": "预演台上手引导",
    "canvasC.previsOnboarding.progress": "第 {{position}} 步 / 共 {{total}} 步",
    "canvasC.previsOnboarding.skip": "跳过引导",
    "canvasC.previsOnboarding.back": "上一步",
    "canvasC.previsOnboarding.finish": "结束引导",
    "canvasC.previsOnboarding.next": "下一步",
    "canvasC.previsMini.noShot": "未设置镜头",
    "canvasC.previsMini.objects": "对象",
    "canvasC.previsMini.cameras": "机位",
    "canvasC.previsMini.duration": "时长",
    "canvasC.previsMonitor.mode.beauty": "预览",
    "canvasC.previsMonitor.mode.clay": "白膜",
    "canvasC.previsMonitor.mode.depth": "深度",
    "canvasC.previsMonitor.mode.normal": "法线",
    "canvasC.previsMonitor.mode.pose": "骨骼",
    "canvasC.previsMonitor.popupBlocked": "浏览器拦截了监看窗口，请允许本站弹出窗口后重试",
    "canvasC.previsMonitor.windowTitle": "{{brandName}}预演台 · 镜头监看",
    "canvasC.previsMonitor.tip": "F 全屏 · Esc 退出全屏",
    "canvasC.previsMonitor.unavailable": "监看画面暂不可用",
    "canvasC.previsProps.title": "道具库",
    "canvasC.previsProps.add": "添加 {{name}}（{{size}}）",
    "canvasC.previsProps.upload": "上传本地模型 (.glb / .gltf)",
    "canvasC.previsViewToolbar.label": "预演台取景模式",
};

const EN_US: Catalog = {
    "canvasC.previsOnboarding.label": "Previs getting-started guide",
    "canvasC.previsOnboarding.progress": "Step {{position}} of {{total}}",
    "canvasC.previsOnboarding.skip": "Skip guide",
    "canvasC.previsOnboarding.back": "Back",
    "canvasC.previsOnboarding.finish": "Finish guide",
    "canvasC.previsOnboarding.next": "Next",
    "canvasC.previsMini.noShot": "No shot set",
    "canvasC.previsMini.objects": "Objects",
    "canvasC.previsMini.cameras": "Cameras",
    "canvasC.previsMini.duration": "Duration",
    "canvasC.previsMonitor.mode.beauty": "Preview",
    "canvasC.previsMonitor.mode.clay": "Clay",
    "canvasC.previsMonitor.mode.depth": "Depth",
    "canvasC.previsMonitor.mode.normal": "Normals",
    "canvasC.previsMonitor.mode.pose": "Skeleton",
    "canvasC.previsMonitor.popupBlocked": "The browser blocked the monitor window. Allow pop-ups for this site and try again.",
    "canvasC.previsMonitor.windowTitle": "{{brandName}} Previs · Shot monitor",
    "canvasC.previsMonitor.tip": "F full screen · Esc exit full screen",
    "canvasC.previsMonitor.unavailable": "Monitor feed unavailable",
    "canvasC.previsProps.title": "Prop library",
    "canvasC.previsProps.add": "Add {{name}} ({{size}})",
    "canvasC.previsProps.upload": "Upload local model (.glb / .gltf)",
    "canvasC.previsViewToolbar.label": "Previs view mode",
};

const CATALOGS: Record<PrevisLocale, Catalog> = { "zh-CN": ZH_CN, "en-US": EN_US };

export function normalizePrevisLocale(value: unknown): PrevisLocale {
    return value === "en-US" || String(value).toLowerCase().startsWith("en") ? "en-US" : "zh-CN";
}

export function detectPrevisLocale(): PrevisLocale {
    try {
        const param = new URLSearchParams(window.location.search).get("locale");
        if (param) return normalizePrevisLocale(param);
        const stored = window.localStorage.getItem("shotloom.previs-world:locale");
        if (stored) return normalizePrevisLocale(stored);
        return normalizePrevisLocale(navigator.language);
    } catch {
        return "zh-CN";
    }
}

export function previsMessage(locale: PrevisLocale, key: string, params?: Record<string, string | number>): string {
    const text = CATALOGS[locale][key] ?? CATALOGS["zh-CN"][key];
    if (!text) return key.split(".").pop() || key;
    if (!params) return text;
    return text.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : match));
}
