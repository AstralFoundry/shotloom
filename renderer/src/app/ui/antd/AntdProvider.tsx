import { App as AntdApp, ConfigProvider, theme as antdTheme } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useEffect, useState, type ReactNode } from "react";

/**
 * Ant Design 主题桥。
 *
 * 这里是产品里唯一直接依赖 antd 主题 API 的地方：
 * - seed token 用字面量，SeedToken 会被 antd 的色彩算法推导成完整色板，
 *   传 `var(--brand-accent)` 会让推导失效，所以 `colorPrimary` 必须与
 *   `renderer/styles/tokens.css` 的 `--brand-accent` 保持同值。
 * - 暗色由 `.dark` 类驱动，但 antd 6 会在组件作用域上生成一套 `--ant-*` 变量，
 *   只改 `:root` 的别名盖不住它们；所以这里跟随 `.dark` 切换 darkAlgorithm，
 *   让组件级变量也按暗色推导。`antd-theme.css` 继续负责圆角、字体、边框等别名。
 *
 * `App` 只提供 `message` / `modal` / `notification` 的上下文，`component={false}`
 * 让它不额外包一层 div，避免打断 `#app` 的满高布局。
 */
// 与 tokens.css 的 --brand-accent 同值：浅色 #6d6cff，暗色 #8b8aff。
const SHOTLOOM_PRIMARY = { light: "#6d6cff", dark: "#8b8aff" };

function useDarkTheme() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined"
      && (document.documentElement.classList.contains("dark")
        || document.body.classList.contains("dark")),
  );

  useEffect(() => {
    const roots = [document.documentElement, document.body].filter(Boolean);
    const sync = () =>
      setDark(roots.some((root) => root.classList.contains("dark")));
    sync();
    const observers = roots.map((root) => {
      const observer = new MutationObserver(sync);
      observer.observe(root, { attributes: true, attributeFilter: ["class"] });
      return observer;
    });
    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  return dark;
}

export function AntdProvider({ children }: { children: ReactNode }) {
  const dark = useDarkTheme();
  return (
    <ConfigProvider
      locale={zhCN}
      button={{ autoInsertSpace: false }}
      theme={{
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        token: {
          colorPrimary: dark ? SHOTLOOM_PRIMARY.dark : SHOTLOOM_PRIMARY.light,
          colorInfo: dark ? SHOTLOOM_PRIMARY.dark : SHOTLOOM_PRIMARY.light,
          fontFamily: "var(--font-ui)",
          fontSize: 13,
          borderRadius: 12,
          motionDurationMid: "0.16s",
          // 弹层压在画布/工作区之上、Toast 之下；antd 默认 1000 会盖住 Toast。
          zIndexPopupBase: 560,
        },
        components: {
          Modal: {
            borderRadiusLG: 12,
            paddingContentHorizontalLG: 24,
          },
          Button: {
            fontWeight: 500,
          },
        },
      }}
    >
      <AntdApp component={false}>{children}</AntdApp>
    </ConfigProvider>
  );
}
