import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

/**
 * Ant Design light theme for the world engine's own dialogs and dropdowns.
 *
 * The workbench is pinned to the light canvas theme regardless of the host's app theme
 * (see `CanvasPrevisWorkbench`), so this file carries the matching light tokens and does
 * not depend on the host's skin system.
 */

const controlTheme = {
    solidBg: "#171717",
    solidHoverBg: "#303030",
    solidActiveBg: "#404040",
    solidFg: "#ffffff",
    selectedBg: "rgba(17, 17, 17, 0.09)",
    selectedHoverBg: "rgba(17, 17, 17, 0.13)",
    controlSurface: "#ffffff",
    controlBorder: "rgba(17, 17, 17, 0.18)",
    success: "#16a34a",
    warning: "#d97706",
    danger: "#dc2626",
    dangerHover: "#b91c1c",
    dangerActive: "#991b1b",
    dangerForeground: "#ffffff",
    info: "#2563eb",
    menuBg: "#f5f5f5",
    selectActiveBg: "rgba(17, 17, 17, 0.035)",
    selectSelectedBg: "rgba(17, 17, 17, 0.065)",
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = controlTheme;
    const elevatedBackground = dark ? "rgba(31, 31, 32, 1)" : "rgba(255, 255, 255, 1)";
    const infoBackground = dark ? "rgba(255, 255, 255, 0.08)" : "rgba(17, 17, 17, 0.045)";
    const infoBorder = dark ? "rgba(255, 255, 255, 0.2)" : "rgba(17, 17, 17, 0.14)";

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: `previs-world-${dark ? "dark" : "light"}` },
        token: {
            colorPrimary: color.solidBg,
            colorPrimaryHover: color.solidHoverBg,
            colorPrimaryActive: color.solidActiveBg,
            colorPrimaryBg: color.selectedBg,
            colorPrimaryBgHover: color.selectedHoverBg,
            colorInfoBg: infoBackground,
            colorInfoBgHover: color.selectedHoverBg,
            colorInfoBorder: infoBorder,
            colorInfo: color.info,
            colorLink: color.solidBg,
            colorLinkHover: color.solidHoverBg,
            colorTextLightSolid: color.solidFg,
            controlOutlineWidth: 0,
            colorSuccess: color.success,
            colorWarning: color.warning,
            colorError: color.danger,
            colorErrorHover: color.dangerHover,
            colorErrorActive: color.dangerActive,
            colorBgElevated: elevatedBackground,
            colorBgContainer: color.controlSurface,
            colorBorderSecondary: dark ? "rgba(255, 255, 255, 0.1)" : "rgba(17, 17, 17, 0.09)",
            boxShadowSecondary: dark ? "0 1px 2px rgba(0, 0, 0, 0.4), 0 24px 64px rgba(0, 0, 0, 0.44)" : "0 1px 2px rgba(15, 23, 42, 0.08), 0 20px 56px rgba(15, 23, 42, 0.12)",
            borderRadius: 8,
            borderRadiusLG: 12,
            borderRadiusSM: 4,
            lineWidth: 1,
            controlHeight: 36,
            controlHeightLG: 42,
            controlHeightSM: 30,
            fontSize: 13,
            fontSizeSM: 12,
        },
        components: {
            Button: {
                defaultShadow: "none",
                primaryShadow: "none",
                dangerShadow: "none",
                fontWeight: 500,
                borderRadius: 8,
                contentFontSize: 13,
                paddingInline: 12,
                iconGap: 6,
                colorPrimary: color.solidBg,
                colorPrimaryHover: color.solidHoverBg,
                colorPrimaryActive: color.solidActiveBg,
                primaryColor: color.solidFg,
                defaultBg: "var(--button-secondary-bg)",
                defaultColor: "var(--button-secondary-fg)",
                defaultBorderColor: "var(--button-secondary-border)",
                defaultHoverBg: "var(--button-secondary-hover-bg)",
                defaultHoverColor: "var(--button-secondary-fg)",
                defaultHoverBorderColor: "var(--button-secondary-hover-border)",
                defaultActiveBg: "var(--button-secondary-active-bg)",
                defaultActiveColor: "var(--button-secondary-fg)",
                defaultActiveBorderColor: "var(--button-secondary-hover-border)",
            },
            Input: { borderRadius: 8, paddingInline: 12, activeBg: elevatedBackground, hoverBg: elevatedBackground, activeBorderColor: "transparent", hoverBorderColor: "transparent", activeShadow: "none" },
            InputNumber: { borderRadius: 8, activeBg: elevatedBackground, hoverBg: elevatedBackground, activeBorderColor: "transparent", hoverBorderColor: "transparent", activeShadow: "none" },
            Select: { optionSelectedBg: color.selectSelectedBg, optionActiveBg: color.selectActiveBg, optionSelectedColor: color.solidBg },
            Dropdown: { colorBgElevated: elevatedBackground },
            Modal: { borderRadiusLG: 16 },
        },
    };
}
