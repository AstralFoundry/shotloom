import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default {
  base: "./",
  plugins: [react(), tailwindcss()],
  resolve: {
    // The shotloom product also has React/three installed; the desk must use its own copies.
    dedupe: ["react", "react-dom", "three"],
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      // The workbench is the full editor; the card entry only renders the node thumbnail.
      input: {
        index: fileURLToPath(new URL("./index.html", import.meta.url)),
        card: fileURLToPath(new URL("./card.html", import.meta.url)),
        "previs-agent": fileURLToPath(new URL("./src/host/agent.ts", import.meta.url)),
      },
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: (entry) => entry.name === "previs-agent" ? "previs-agent.js" : "assets/[name]-[hash].js",
      },
    },
  },
};
