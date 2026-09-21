import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * Vite config for the Playground SPA.
 *
 * - React plugin (Fast Refresh + JSX).
 * - `@` path alias -> `src/` (mirrors the `paths` entry in tsconfig.json so
 *   `import { api } from "@/lib/api"` resolves identically in the editor,
 *   the type-checker, and the Rollup bundle).
 * - Dev proxy: every `/api/*` request is forwarded to the FastAPI app on
 *   port 8765 (see `uvicorn backend.api.app:app`), so the browser talks to a
 *   single origin during development. Override the target with the
 *   `VITE_API_TARGET` env var when the backend runs on another port.
 * - `build.outDir` is `dist`; the API mounts that directory as StaticFiles
 *   when it exists, serving the built SPA from the same origin in production.
 * - `base`: set `VITE_BASE_PATH` (e.g. `/playground/`) when the built SPA is
 *   served from a sub-path, such as a GitHub Pages project site, so asset
 *   URLs resolve correctly. Defaults to `/` (same-origin root deploy).
 */
const API_TARGET = process.env.VITE_API_TARGET ?? "http://localhost:8765";

/**
 * Short build id shown in the footer and on `window.__MATRAIX_BUILD__`, so a
 * stale browser cache is trivial to spot: compare what two browsers report.
 * CI passes the commit sha; local builds fall back to a timestamp.
 */
const BUILD_ID =
  process.env.GITHUB_SHA?.slice(0, 7) ??
  new Date().toISOString().slice(0, 16).replace("T", " ");

export default defineConfig({
  base: process.env.VITE_BASE_PATH ?? "/",
  define: {
    __MATRAIX_BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
