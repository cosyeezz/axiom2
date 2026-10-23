// Installed on each workbench document; native calls also work before React mounts.
window.__axiomApplyTheme = (state) => {
  if (!state || !["light", "dark"].includes(state.theme) || !Number.isSafeInteger(state.revision)) return;
  if (state.revision < (window.__axiomThemeRevision ?? -1)) return;
  window.__axiomThemeRevision = state.revision;
  window.__AXIOM_THEME__ = state.theme;
  const apply = () => {
    // A newer native update may have arrived while waiting for the root element.
    const theme = window.__AXIOM_THEME__;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    window.dispatchEvent(new CustomEvent("axiom-theme", { detail: theme }));
  };
  if (document.documentElement) apply();
  else document.addEventListener("DOMContentLoaded", apply, { once: true });
};
