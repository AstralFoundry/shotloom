import { createRoot } from "react-dom/client";
import { EditorInterface } from "../components/editor/EditorInterface";
import { AstryxProvider } from "../components/astryx/AstryxProvider";
import { createEmbeddedRuntime } from "../shotloom-bridge";
import { shotloomMessage } from "../shotloom-mode";
import { installShotloomI18n, stopShotloomI18n } from "../shotloom-i18n";
import type { ClipStudioRuntimeOptions } from "./runtime-types";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "../index.css";
import "../shotloom-theme.css";

export function mountSession(options: ClipStudioRuntimeOptions, releaseEnvironment: () => void) {
  const container = document.createElement("div");
  container.setAttribute("data-editor-react-root", "");
  container.style.cssText = "width:100%;height:100%;position:relative";
  options.root.append(container);
  Object.defineProperty(container, "ownerDocument", { get: () => document });
  const reactRoot = createRoot(container);
  const runtime = createEmbeddedRuntime(options);
  runtime.setPresentation(options.presentation, options.layout);
  runtime.setActive(options.active);
  document.documentElement.lang = options.host.app.locale === 'en-US' ? 'en-US' : 'zh-CN';
  document.title = shotloomMessage('ui.ReactWorkbench.text.3d65ff77');
  // 英文沿用上游原文；中文才安装本地覆盖层，作用域仍限制在当前编辑器。
  if (options.host.app.locale !== 'en-US') installShotloomI18n();
  reactRoot.render(<AstryxProvider><EditorInterface /></AstryxProvider>);
  const dispose = runtime.dispose;
  runtime.dispose = async () => {
    reactRoot.unmount();
    stopShotloomI18n();
    try { await dispose(); } finally { releaseEnvironment(); container.remove(); }
  };
  return runtime;
}

