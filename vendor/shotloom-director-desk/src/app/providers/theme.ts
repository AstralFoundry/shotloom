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
    const fieldBorders = {
        hoverBorderColor: tokens['wash-6'],
        activeBorderColor: tokens['text-muted'],
    };
    const fieldSizing = {
        controlHeightSM: 32,
        controlHeight: 36,
        controlHeightLG: 40,
        controlPaddingHorizontalSM: 9,
        controlPaddingHorizontal: 12,
        fontSize: 13,
        fontSizeSM: 13,
    };
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
            colorTextSecondary: tokens['text-secondary'],
            colorTextTertiary: tokens['text-muted'],
            borderRadius: 8,
            borderRadiusLG: 12,
            borderRadiusSM: 6,
            controlHeight: 28,
            controlHeightSM: 24,
            controlHeightLG: 32,
            controlPaddingHorizontal: 9,
            controlPaddingHorizontalSM: 7,
            fontSize: 12,
            fontSizeSM: 11,
            fontSizeLG: 13,
            fontWeightStrong: 500,
            lineHeight: 1.5,
            fontFamily: "'Inter Variable', Inter, 'PingFang SC', 'Microsoft YaHei', system-ui, sans-serif",
            boxShadowSecondary: tokens['float-shadow'],
            motionDurationMid: '0.14s',
        },
        components: {
            Button: {
                colorPrimary: tokens['cta-bg'],
                colorPrimaryHover: tokens['cta-bg-hover'],
                colorPrimaryActive: tokens['cta-bg-active'],
                primaryColor: tokens['cta-text'],
                defaultBg: tokens['gp-field'],
                defaultBorderColor: tokens['line-strong'],
                defaultColor: tokens['text-primary'],
                defaultHoverBg: tokens['gp-card-hover'],
                // Antd derives the hover/active text from colorPrimaryHover; without these
                // the default button's label would match its hover background exactly.
                defaultHoverColor: tokens['text-bright'],
                defaultActiveBg: tokens['gp-selected'],
                defaultActiveColor: tokens['text-bright'],
                defaultHoverBorderColor: tokens['wash-6'],
                primaryShadow: 'none',
                defaultShadow: 'none',
                fontWeight: 400,
                controlHeight: 32,
                controlHeightLG: 36,
                contentFontSize: 13,
                contentFontSizeSM: 12,
                contentFontSizeLG: 14,
            },
            Tabs: {
                itemColor: tokens['text-secondary'],
                itemSelectedColor: tokens['text-strong'],
                inkBarColor: tokens['text-strong'],
                horizontalItemGutter: 12,
                horizontalItemPadding: '5px 0',
                titleFontSize: 12,
            },
            Segmented: {
                trackBg: tokens['gp-surface-sunken'],
                itemSelectedBg: tokens['gp-selected'],
                itemColor: tokens['text-secondary'],
                itemSelectedColor: tokens['text-bright'],
                itemHoverColor: tokens['text-bright'],
                trackPadding: 3,
            },
            Input: {
                ...fieldSizing,
                ...fieldBorders,
                activeShadow: 'none',
                paddingInlineSM: fieldSizing.controlPaddingHorizontalSM,
                paddingInline: fieldSizing.controlPaddingHorizontal,
                inputFontSize: fieldSizing.fontSize,
                inputFontSizeSM: fieldSizing.fontSizeSM,
            },
            InputNumber: {
                ...fieldSizing,
                ...fieldBorders,
                activeShadow: 'none',
                paddingInlineSM: fieldSizing.controlPaddingHorizontalSM,
                paddingInline: fieldSizing.controlPaddingHorizontal,
                inputFontSize: fieldSizing.fontSize,
                inputFontSizeSM: fieldSizing.fontSizeSM,
            },
            Slider: {
                railBg: tokens['wash-3'],
                railHoverBg: tokens['wash-4'],
                trackBg: tokens.accent,
                trackHoverBg: tokens.accent,
                handleColor: tokens.accent,
                handleActiveColor: tokens.accent,
                dotBorderColor: tokens['line-strong'],
                dotActiveBorderColor: tokens.accent,
            },
            Select: {
                ...fieldSizing,
                ...fieldBorders,
                activeOutlineColor: 'transparent',
                optionSelectedColor: tokens['text-strong'],
                optionSelectedBg: tokens['gp-selected'],
                optionActiveBg: tokens['gp-field-hover'],
            },
            Modal: {
                // Keep every surface of the dialog opaque: a transparent body lets the 3D
                // viewport and stray overlays show through the middle of the panel.
                contentBg: tokens['gp-dialog'],
                headerBg: 'transparent',
                titleFontSize: 14,
                borderRadiusLG: 12,
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
