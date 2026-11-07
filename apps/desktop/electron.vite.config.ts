import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()], build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } } },
  // dev em 127.0.0.1: a CSP do index.html só libera ws://127.0.0.1:* — em "localhost" o HMR do Vite ficava em loop de erro de CSP
  renderer: { plugins: [react()], server: { host: "127.0.0.1" } },
});
