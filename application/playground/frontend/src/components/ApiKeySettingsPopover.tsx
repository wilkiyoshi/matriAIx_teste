/**
 * ApiKeySettingsPopover: lets each person testing the Playground paste their
 * own Anthropic API key in the browser.
 *
 * The key is stored only in this browser's `localStorage` (see
 * `lib/anthropicApiKey.ts`) — never committed to the repo, never written to
 * a server-side config file. `api.ts` attaches it as a request header only
 * on the calls that need it (preflight, job launch); the backend forwards it
 * straight into that one job's trial subprocess environment and never
 * persists it (see `launch_harbor_job` in `backend/api/app.py`).
 *
 * The panel is portaled to `document.body` (see PreflightChip's popover for
 * the same pattern) so it always paints above page content — un-portaled, it
 * would be trapped in the top bar's own stacking context and a same-or-higher
 * z-index element further down the page (e.g. Persona World's dataset bar)
 * could paint over it despite this panel's higher z-index.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQueryClient } from "@tanstack/react-query";

import { FOCUS_RING, Sym } from "./cockpit/cockpitShared";
import { useI18n } from "@/i18n/I18nProvider";
import {
  getStoredAnthropicApiKey,
  setStoredAnthropicApiKey,
} from "@/lib/anthropicApiKey";

/** Popover width (matches the `w-80` class below) — used to place it. */
const POPOVER_WIDTH = 320;

export function ApiKeySettingsPopover() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [savedFlash, setSavedFlash] = useState<"saved" | "cleared" | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 12, top: 56 });

  useEffect(() => {
    setHasKey(Boolean(getStoredAnthropicApiKey()));
  }, []);

  useEffect(() => {
    if (!open) return;
    setDraft(getStoredAnthropicApiKey());
    setSavedFlash(null);
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const panelHeight = panelRef.current?.getBoundingClientRect().height || 260;
    const margin = 12;
    const alignToLogicalEnd = document.documentElement.dir !== "rtl";
    const preferredLeft = alignToLogicalEnd ? rect.right - POPOVER_WIDTH : rect.left;
    const left = Math.min(
      window.innerWidth - POPOVER_WIDTH - margin,
      Math.max(margin, preferredLeft),
    );
    const below = rect.bottom + 8;
    const top =
      below + panelHeight <= window.innerHeight - margin
        ? below
        : Math.max(margin, rect.top - panelHeight - 8);
    setPosition({ left, top });
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) {
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  function persist(value: string) {
    setStoredAnthropicApiKey(value);
    setHasKey(Boolean(value.trim()));
    setSavedFlash(value.trim() ? "saved" : "cleared");
    // The preflight chip polls every 20s; refetch now so the change is
    // reflected immediately.
    void queryClient.invalidateQueries({ queryKey: ["preflight"] });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("apiKey.buttonLabel")}
        title={t("apiKey.buttonLabel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="api-key-popover"
        className={`nasa-glass-pill grid h-9 w-9 flex-none place-items-center rounded-full transition hover:bg-surface-high/40 active:scale-95 ${FOCUS_RING} ${
          hasKey ? "text-secondary" : "text-text-variant hover:text-text-main"
        }`}
      >
        <Sym name="key" size={18} fill={hasKey ? 1 : 0} />
      </button>

      {open
        ? createPortal(
            <div
              id="api-key-popover"
              ref={panelRef}
              role="dialog"
              aria-label={t("apiKey.popoverTitle")}
              style={{ left: position.left, top: position.top }}
              className="pop-in fixed z-30 w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border border-outline bg-surface-lowest p-3 shadow-2xl"
            >
              <p className="hud mb-2 text-[12px] text-text-dim">{t("apiKey.popoverTitle")}</p>

              <label
                className="mb-1 block text-[13px] font-medium text-text-main"
                htmlFor="anthropic-api-key-input"
              >
                {t("apiKey.inputLabel")}
              </label>
              <input
                ref={inputRef}
                id="anthropic-api-key-input"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") persist(draft);
                }}
                placeholder={t("apiKey.placeholder")}
                className={`w-full rounded-lg border border-outline bg-surface-low px-3 py-2 text-[13px] text-text-main placeholder:text-text-dim ${FOCUS_RING}`}
              />

              <p className="mt-2 text-[12px] leading-relaxed text-text-variant">
                {t("apiKey.helpText")}
              </p>

              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[12px] text-text-dim">
                  {hasKey ? t("apiKey.statusSet") : t("apiKey.statusUnset")}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setDraft("");
                      persist("");
                    }}
                    className={`rounded-full px-3 py-1.5 text-[13px] font-medium text-text-variant transition hover:bg-surface-high/70 hover:text-text-main ${FOCUS_RING}`}
                  >
                    {t("apiKey.clear")}
                  </button>
                  <button
                    type="button"
                    onClick={() => persist(draft)}
                    className={`rounded-full bg-primary px-3 py-1.5 text-[13px] font-semibold text-on-primary transition hover:opacity-90 active:scale-[0.98] ${FOCUS_RING}`}
                  >
                    {t("apiKey.save")}
                  </button>
                </div>
              </div>

              {savedFlash ? (
                <p className="mt-2 text-[12px] text-secondary" role="status">
                  {savedFlash === "saved" ? t("apiKey.saved") : t("apiKey.cleared")}
                </p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
