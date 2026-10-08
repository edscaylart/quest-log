/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed dev port.
export default defineConfig({
  plugins: [react()],
  // `@/` → src, from the tsconfig `paths`.
  resolve: { tsconfigPaths: true },
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  test: {
    // Only src: git worktrees under .claude/ hold stale copies of the tests.
    dir: "src",
    environment: "jsdom",
    setupFiles: ["./src/tests/support/setup.ts"],
  },
});
