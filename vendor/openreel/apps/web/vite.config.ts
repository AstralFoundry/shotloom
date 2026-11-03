import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { stripFfmpegPlugin } from "./vite-plugins/strip-ffmpeg";
import { pruneFontsPlugin } from "./vite-plugins/prune-fonts";
import { embeddedCoordinatesPlugin } from "./vite-plugins/embedded-coordinates";
import { embeddedFactoryPlugin } from "./vite-plugins/embedded-factory";

const isDesktop = process.env.OPENREEL_DESKTOP === "1";
const isEmbedded = process.env.OPENREEL_EMBEDDED === "1";

function desktopHtmlPlugin() {
  return {
    name: "openreel-desktop-html",
    transformIndexHtml(html: string) {
      if (!isDesktop) return html;
      let out = html
        .replace(/href="\/favicon\.svg"/g, 'href="./favicon.svg"')
        .replace(/href="\/manifest\.json"/g, 'href="./manifest.json"')
        .replace(/href="\/icons\/icon-192\.png"/g, 'href="./icons/icon-192.png"');
      out = out.replace(
        /<link rel="preconnect"[^>]*>\s*/g,
        "",
      );
      out = out.replace(
        /<link href="https:\/\/fonts\.googleapis\.com[^>]*>\s*/g,
        '<link href="./fonts/google-fonts.css" rel="stylesheet" />',
      );
      return out;
    },
  };
}

export default defineConfig({
  base: isEmbedded ? "/openreel/" : isDesktop ? "./" : "/",
  plugins: [embeddedCoordinatesPlugin(isEmbedded), react(), desktopHtmlPlugin(), stripFfmpegPlugin(isDesktop), pruneFontsPlugin(isDesktop), embeddedFactoryPlugin(isEmbedded)],
  assetsInclude: ["**/*.wasm"],
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: {
      react: path.resolve(__dirname, "./node_modules/react"),
      "react-dom": path.resolve(__dirname, "./node_modules/react-dom"),
      "@": path.resolve(__dirname, "./src"),
      "@openreel/core": path.resolve(__dirname, "../../packages/core/src"),
      "@openreel/agent": path.resolve(__dirname, "../../packages/agent/src"),
      "@openreel/ui": path.resolve(__dirname, "../../packages/ui/src"),
    },
  },
  worker: { format: "es" },
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util", "@ffmpeg/core", "@ffmpeg/core-mt"],
  },
  build: {
    target: "esnext",
    cssCodeSplit: !isEmbedded,
    outDir: isEmbedded ? "dist-embedded" : "dist",
    rollupOptions: {
      preserveEntrySignatures: isEmbedded ? "strict" : false,
      input: isEmbedded ? path.resolve(__dirname, "src/embedded/session.tsx") : path.resolve(__dirname, "index.html"),
      output: {
        format: isEmbedded ? "iife" : "es",
        name: isEmbedded ? "OpenReelEmbeddedSession" : undefined,
        entryFileNames: isEmbedded ? "embedded-runtime.js" : "assets/[name]-[hash].js",
        inlineDynamicImports: isEmbedded,
        manualChunks: isEmbedded ? undefined : (id) => {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) return "react";
          if (id.includes("node_modules/zustand")) return "zustand";
          if (id.includes("node_modules/three")) return "three";
          if (id.includes("node_modules/@radix-ui")) return "radix";
        },
      },
    },
  },
  /* Keep manual chunks for the browser editor; the embedded controller is a
     named local entry so the host never imports vendor source at runtime. */
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
