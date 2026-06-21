import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    // Bundle @northstar/shared (TS workspace pkg); externalize real node deps.
    plugins: [externalizeDepsPlugin({ exclude: ["@northstar/shared"] })],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/main/index.ts") } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@northstar/shared"] })],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/preload/index.ts") } },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    resolve: {
      alias: { "@": resolve(__dirname, "src/renderer/src") },
    },
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, "src/renderer/index.html") } },
    },
  },
});
