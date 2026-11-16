/// <reference types="vite/client" />

// 桌面壳由 Electron preload 注入 window.shotloomDesktop；浏览器预览里这个字段不存在，
// desktopApi 据此退回浏览器替身。
interface Window {
  shotloomDesktop?: import('./desktop/types.ts').ShotloomDesktopBridge;
}

// CSS Module 的类名映射在构建时由 Vite 生成，运行时才存在。
declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}
