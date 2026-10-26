// Tailnet HTTP is encrypted by Tailscale but browsers do not classify it as a secure context.
// getRandomValues remains available; never substitute Math.random for request identity.
if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = bytes[6] & 15 | 64; bytes[8] = bytes[8] & 63 | 128;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
} });
if (!navigator.clipboard) Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text: string) => {
  const previous = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea"); field.value = text;
  field.style.cssText = "position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;font-size:16px";
  // A body child is inert while a native modal is open: execCommand may report
  // success without copying. Keep the fallback inside the active dialog instead.
  const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const host = previous?.closest("dialog[open]") ?? dialogs[dialogs.length - 1] ?? document.body;
  host.append(field);
  try {
    field.focus({ preventScroll: true }); field.select();
    if (!document.execCommand("copy")) throw Error("无法复制，请长按文字手动复制。");
  } finally { field.remove(); previous?.focus({ preventScroll: true }); }
} } });
const viewport = window.visualViewport;
if (viewport) {
  let frame = 0;
  const apply = () => {
    frame = 0;
    // Preserve pinch zoom. Mobile inputs stay >=16px so focus need not zoom.
    if (viewport.scale !== 1) return;
    const height = `${Math.round(viewport.height)}px`;
    if (document.documentElement.style.getPropertyValue("--visual-height") !== height)
      document.documentElement.style.setProperty("--visual-height", height);
  };
  viewport.addEventListener("resize", () => { if (!frame) frame = requestAnimationFrame(apply); });
  apply();
}
export {};
