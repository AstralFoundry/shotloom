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
  },
};
