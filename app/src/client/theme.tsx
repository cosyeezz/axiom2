import { useEffect, useSyncExternalStore } from "react";
import { desktopInvoke } from "./pages/desktop-bridge.js";

export type Theme = "light" | "dark";
const storageKey = "axiom.theme";
const listeners = new Set<() => void>();
function valid(value: unknown): value is Theme { return value === "light" || value === "dark"; }
function savedTheme(): Theme {
  try { const value = localStorage.getItem(storageKey); if (valid(value)) return value; } catch {}
  return "dark";
}
let theme = savedTheme();
function apply(value: Theme) {
  theme = value;
  document.documentElement.dataset.theme = value;
  document.documentElement.style.colorScheme = value;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", value === "light" ? "#f7f6f3" : "#08090a");
  listeners.forEach(listener => listener());
}
function persist(value: Theme) {
  try { localStorage.setItem(storageKey, value); } catch { /* Still usable when storage is unavailable. */ }
}
let desktopController = false;
// Clients built before native theme sync lack the command; they keep the browser behavior.
let nativeTheme = true;
let pending = 0;
let failure = "";
let revision = -1;
let writes = Promise.resolve();
const notify = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function nativeWorkbench() {
  const native = window as unknown as { __TAURI_INTERNALS__?: unknown; __axiomApplyTheme?: unknown };
  return nativeTheme && !desktopController && !!(native.__TAURI_INTERNALS__ || native.__axiomApplyTheme);
}
// Tauri rejects IPC with plain strings, so read both forms.
function reason(error: unknown) {
  return error instanceof Error ? error.message : typeof error === "string" && error ? error : "主题切换失败，请重试。";
}
const missingCommand = (error: unknown) => reason(error) === "Command axiom_theme not found";
function acceptNative(state: { theme: Theme; revision: number }) {
  if (!valid(state?.theme) || !Number.isSafeInteger(state.revision)) throw Error("主题状态未确认，请重试。");
  const native = window as unknown as { __axiomThemeRevision?: number; __AXIOM_THEME__?: Theme };
  const nativeRevision = Number.isSafeInteger(native.__axiomThemeRevision) ? native.__axiomThemeRevision! : -1;
  if (state.revision < Math.max(revision, nativeRevision)) return;
  revision = state.revision;
  // IPC replies and injected broadcasts must share a watermark before either can paint.
  native.__axiomThemeRevision = revision;
  native.__AXIOM_THEME__ = state.theme;
  persist(state.theme);
  apply(state.theme);
}
export function setTheme(value: Theme): Promise<void> { return updateTheme(value, false); }
// Settings are an explicit user choice; storage events must never write from a native workbench.
export function chooseTheme(value: Theme): Promise<void> { return updateTheme(value, true); }
function updateTheme(value: Theme, explicit: boolean): Promise<void> {
  const workbench = nativeWorkbench();
  if (workbench && !explicit) return Promise.resolve();
  if (!nativeTheme || (!desktopController && !workbench)) { persist(value); apply(value); return Promise.resolve(); }
  // Restore, clicks and storage updates share one queue, including across button remounts.
  pending++;
  notify();
  const next = writes.then(async () => {
    try {
      if (nativeTheme) acceptNative(await desktopInvoke<{ theme: Theme; revision: number }>("axiom_theme", { theme: value }));
      else { persist(value); apply(value); }
      failure = "";
    } catch (error) {
      if (missingCommand(error)) { nativeTheme = false; failure = ""; persist(value); apply(value); return; }
      // A timed-out write may have reached native code; read its authoritative state.
      try { acceptNative(await desktopInvoke<{ theme: Theme; revision: number }>("axiom_theme")); } catch {}
      failure = reason(error);
      throw error;
    } finally { pending--; notify(); }
  });
  writes = next.catch(() => {});
  return next;
}
export function initializeTheme(controller = false) {
  desktopController = controller;
  const native = window as unknown as { __AXIOM_THEME__?: unknown; __axiomThemeRevision?: number };
  if (valid(native.__AXIOM_THEME__) && Number.isSafeInteger(native.__axiomThemeRevision)) {
    acceptNative({ theme: native.__AXIOM_THEME__, revision: native.__axiomThemeRevision! });
  } else apply(valid(native.__AXIOM_THEME__) ? native.__AXIOM_THEME__ : savedTheme());
  if (controller) void setTheme(theme).catch(() => {});
  window.addEventListener("axiom-theme", event => {
    const value: unknown = (event as CustomEvent).detail;
    if (valid(value)) {
      const nativeRevision = (window as unknown as { __axiomThemeRevision?: number }).__axiomThemeRevision;
      if (Number.isSafeInteger(nativeRevision)) acceptNative({ theme: value, revision: nativeRevision! });
      else { persist(value); apply(value); }
    }
  });
  window.addEventListener("storage", event => {
    if (!nativeWorkbench() && (event.key === storageKey || event.key === null)) void setTheme(savedTheme()).catch(() => {});
  });
}
export function useTheme() {
  const current = useSyncExternalStore(subscribe, () => theme);
  const busy = useSyncExternalStore(subscribe, () => pending > 0);
  const error = useSyncExternalStore(subscribe, () => failure);
  return { current, busy, error };
}
export function ThemeToggle() {
  const { current, busy, error } = useTheme();
  useEffect(() => {
    // Replay initialization failures after the controller's error listener has mounted.
    if (error) queueMicrotask(() => window.dispatchEvent(new CustomEvent("axiom-desktop-error", { detail: error })));
  }, [error]);
  const label = current === "dark" ? "切换到白天主题" : "切换到黑夜主题";
  return <button type="button" className="theme-toggle" aria-label={label} title={error || label} disabled={busy} onClick={() => {
    void setTheme(current === "dark" ? "light" : "dark").catch(() => {});
  }}>
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {current === "dark" ? <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></> : <path d="M20.8 13.1A9 9 0 0 1 10.9 3.2a9 9 0 1 0 9.9 9.9Z" />}
    </svg>
  </button>;
}
