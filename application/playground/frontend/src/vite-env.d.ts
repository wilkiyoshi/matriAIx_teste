/// <reference types="vite/client" />

/** Build id injected by vite.config.ts (`define`) — see AppFooter. */
declare const __MATRAIX_BUILD_ID__: string;

interface Window {
  /** Same build id, for a quick `window.__MATRAIX_BUILD__` cache check. */
  __MATRAIX_BUILD__?: string;
}

/**
 * Ambient type declarations for the Vite client environment.
 *
 * This pulls in module declarations for CSS side-effect imports
 * (`import "./index.css"`), static assets, and `import.meta.env`, so the
 * TypeScript build (`tsc --noEmit`) accepts the same imports Vite resolves at
 * bundle time.
 */
