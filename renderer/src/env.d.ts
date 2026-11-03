/// <reference types="vite/client" />

// Tauri 在注入内核时会在 window 上留下 __TAURI_INTERNALS__；桌面桥只用它判断
// 当前是否运行在 Tauri 窗口里，不读取其内部结构。
interface Window {
  __TAURI_INTERNALS__?: unknown;
}

// CSS Module 的类名映射在构建时由 Vite 生成，运行时才存在。
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
