import { theme as antdTheme, type ThemeConfig } from 'antd';
import { editorThemeTokens, type EditorTheme } from '@/shared/styles/theme-tokens.ts';

export type { EditorTheme };
// Theme state lives in core/ so the engine can read it without importing antd; these
// re-exports keep the shell's existing import sites unchanged.
export {
    getEditorTheme,
    initializeEditorTheme,
    onEditorThemeChange,
    setEditorTheme,
} from '@/core/editor/theme-state.ts';

/** Theme-aware antd configuration. */
export function editorThemeConfig(value: EditorTheme): ThemeConfig {
    const tokens = editorThemeTokens[value];
    const dark = value === 'dark';
    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
            colorPrimary: tokens.accent,
            colorTextLightSolid: tokens['text-on-accent'],
            colorBgBase: tokens['app-bg'],
            colorBgContainer: tokens['gp-surface'],
            colorBgElevated: tokens['gp-popover'],
            colorBgLayout: tokens['gp-surface-sunken'],
            colorBorder: tokens['line-strong'],
            colorBorderSecondary: tokens['line-soft'],
            colorText: tokens['text-primary'],
            colorTextSecondary: tokens['text-a62'],
            colorTextTertiary: tokens['text-a42'],
            borderRadius: 8,
            borderRadiusLG: 10,
            borderRadiusSM: 6,
            controlHeight: 34,
            controlHeightSM: 30,
            controlHeightLG: 38,
            controlPaddingHorizontal: 11,
            controlPaddingHorizontalSM: 9,
            fontSize: 13,
            fontFamily: "'Inter Variable', Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
            boxShadowSecondary: `0 18px 44px ${tokens['shadow-strong']}`,
            motionDurationMid: '0.14s',
        },
        components: {
            Button: {
                colorPrimary: tokens['gp-selected'],
                colorPrimaryHover: tokens['gp-card-hover'],
                colorPrimaryActive: tokens['gp-surface-raised'],
                primaryColor: tokens['text-bright'],
                defaultBg: tokens['gp-field'],
                defaultBorderColor: tokens['line-strong'],
                defaultColor: tokens['text-primary'],
                defaultHoverBg: tokens['gp-card-hover'],
                defaultHoverBorderColor: tokens['wash-6'],
                primaryShadow: 'none',
                defaultShadow: 'none',
                fontWeight: 500,
            },
            Tabs: {
                itemColor: tokens['text-a50'],
                itemSelectedColor: tokens['text-strong'],
                inkBarColor: tokens['text-strong'],
                horizontalItemGutter: 12,
                horizontalItemPadding: '9px 0',
                titleFontSize: 13,
            },
            Segmented: {
                trackBg: tokens['gp-surface-sunken'],
                itemSelectedBg: tokens['gp-selected'],
                itemColor: tokens['text-a62'],
                itemSelectedColor: tokens['text-bright'],
                itemHoverColor: tokens['text-bright'],
                trackPadding: 3,
            },
            Input: {
                activeBorderColor: tokens.accent,
                hoverBorderColor: tokens['wash-6'],
                activeShadow: 'none',
                paddingInline: 9,
            },
            InputNumber: {
                activeBorderColor: tokens.accent,
                hoverBorderColor: tokens['wash-6'],
                activeShadow: 'none',
                paddingInline: 9,
            },
            Select: {
                optionSelectedBg: tokens['gp-selected'],
                optionActiveBg: tokens['gp-field-hover'],
            },
            Modal: {
                // Keep every surface of the dialog opaque: a transparent body lets the 3D
                // viewport and stray overlays show through the middle of the panel.
                contentBg: tokens['gp-dialog'],
                headerBg: 'transparent',
                titleFontSize: 16,
                borderRadiusLG: 14,
            },
            Tooltip: {
                colorBgSpotlight: tokens['gp-surface-raised'],
                colorTextLightSolid: tokens['text-strong'],
            },
            Menu: {
                itemBg: 'transparent',
                itemSelectedBg: tokens['gp-field-hover'],
                itemHoverBg: tokens['wash-2'],
                itemBorderRadius: 8,
            },
            Empty: {
                colorTextDescription: tokens['text-a42'],
            },
            Alert: {
                borderRadiusLG: 10,
            },
        },
    };
}
