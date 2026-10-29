import { defineConfig } from "vitest/config";
// Arquivos em série: o e2e dirige um Electron real e não pode disputar CPU com os runtimes de integração.
export default defineConfig({ test: { include: ["packages/*/src/**/*.test.ts", "apps/*/src/**/*.test.ts", "tests/**/*.test.ts"], exclude: ["**/dist/**", "**/node_modules/**"], fileParallelism: false, testTimeout: 20_000 } });
