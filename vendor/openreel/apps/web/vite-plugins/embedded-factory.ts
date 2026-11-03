import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import type { Plugin } from "vite";
import { pruneFontsCss } from "./prune-fonts";

/** Compile a session closure: module singletons are instantiated per call, without eval. */
export function embeddedFactoryPlugin(enabled: boolean): Plugin {
  return {
    name: "openreel-embedded-session-factory",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (!enabled) return;
      const domPath = path.resolve(import.meta.dirname, "../src/embedded/dom.ts");
      const dom = ts.transpileModule(fs.readFileSync(domPath, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
      const css = Object.values(bundle).filter(item => item.type === "asset" && item.fileName.endsWith(".css"))
        .map(item => item.type === "asset" ? String(item.source) : "").join("\n")
        .replace(/:root\b|\bhtml\b|\bbody\b/g, ".clip-studio-root")
        .replace(/url\((['"]?)(?:\.\/)?(assets\/[^)'"\s]+)\1\)/g, "url(/openreel/$2)");
      const fonts = pruneFontsCss(fs.readFileSync(path.resolve(import.meta.dirname, "../public/fonts/google-fonts.css"), "utf8"), () => {}).replace(/url\(\.\//g, "url(/openreel/fonts/");
      const scopedCss = `.clip-studio-root{all:initial;display:block;position:relative;isolation:isolate;contain:layout style;container-type:size;width:100%;height:100%;overflow:hidden;color-scheme:light} .clip-studio-root *{box-sizing:border-box} [data-editor-react-root]{width:100%;height:100%}\n${fonts}\n${css}`;
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk" || !item.isEntry) continue;
        item.code = `${dom}\nconst actualWindow = globalThis.window;\nexport function createRuntime(options) {\nconst environment = createEmbeddedEnvironment(actualWindow, options.root, options.host.persistenceKey);\nconst URL=environment.window.URL;\nconst window=environment.window, document=environment.document, globalThis=window, self=window, localStorage=environment.localStorage, sessionStorage=environment.sessionStorage;\nconst setTimeout=window.setTimeout, clearTimeout=window.clearTimeout, setInterval=window.setInterval, clearInterval=window.clearInterval, requestAnimationFrame=window.requestAnimationFrame, cancelAnimationFrame=window.cancelAnimationFrame;\nconst style=actualWindow.document.createElement('style'); style.textContent=${JSON.stringify(scopedCss)}; options.shadowRoot.append(style);\n${item.code}\nconst runtime=OpenReelEmbeddedSession.mountSession(options, () => {environment.dispose();style.remove()});\nreturn runtime;\n}\n`;
      }
    },
  };
}
