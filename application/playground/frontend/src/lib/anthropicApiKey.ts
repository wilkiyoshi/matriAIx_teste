/**
 * Per-browser Anthropic API key.
 *
 * Each person testing the Playground pastes their own key here; it lives
 * only in this browser's `localStorage`, never in the repo, a config file,
 * or on the server. `api.ts` attaches it as an `X-Anthropic-Api-Key` header
 * on the requests that need it (preflight, job launch); the backend forwards
 * it straight into that one job's trial subprocess env and never persists it
 * (see `launch_harbor_job` in `backend/api/app.py`).
 */
const STORAGE_KEY = "matraix.browserAnthropicApiKey";

const listeners = new Set<() => void>();

export function getStoredAnthropicApiKey(): string {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredAnthropicApiKey(value: string): void {
  const trimmed = value.trim();
  try {
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage disabled (private mode, blocked cookies, …) — the key simply
    // will not persist across reloads; nothing else to do here.
  }
  listeners.forEach((listener) => listener());
}

/** Notify subscribers (e.g. the preflight chip) after the key changes. */
export function subscribeAnthropicApiKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
