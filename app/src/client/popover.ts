import "./styles/popover.css";

type Layer = { node: HTMLElement; mode: string; dismiss: () => void; dispose: () => void; lightDismiss: (event: PointerEvent) => void };
const layers: Layer[] = [];

/** Some desktop WebViews expose neither the Popover API nor its CSS selector. */
function nativePopovers() {
  return typeof HTMLElement.prototype.showPopover === "function"
    && typeof HTMLElement.prototype.hidePopover === "function"
    && CSS.supports("selector(:popover-open)");
}

export function popoverHost(anchor: Element): Element {
  return anchor.closest("dialog[open], [data-popover-open]") ?? document.body;
}

export function closePopover(node: HTMLElement) {
  layers.find(layer => layer.node === node)?.dispose();
}

/** Keep native top-layer behavior when available; otherwise use a fixed, modal-owned
 * layer with the same light-dismiss and Escape behavior. Call the returned cleanup on unmount. */
export function openPopover(node: HTMLElement, { source, onClose }: { source?: HTMLElement; onClose?: () => void } = {}) {
  closePopover(node);
  const mode = node.getAttribute("popover") ?? "auto";
  // React delegates portal events to this host. Listening there after React lets
  // nested controls consume Escape, even when the sheet stops bubbling to document.
  const keyHost = node.parentElement ?? document;
  let native = false, disposed = false, outsideStart = false;
  const outside = (target: EventTarget | null) => target instanceof Node && !node.contains(target) && !source?.contains(target);
  const topmost = () => layers.findLast(layer => layer.mode === "auto") === layer;
  const modalSelector = CSS.supports("selector(:modal)") ? "dialog:modal" : "dialog[open]:not([data-popover-open])";
  const dismiss = () => { dispose(); onClose?.(); };
  const toggle = (event: Event) => {
    if (event.target === node && (event as ToggleEvent).newState === "closed") dismiss();
  };
  const down = (event: PointerEvent) => { outsideStart = event.button === 0 && outside(event.target); };
  const lightDismiss = (event: PointerEvent) => {
    const shouldDismiss = outsideStart && outside(event.target);
    outsideStart = false;
    if (shouldDismiss) dismiss();
  };
  const up = (event: PointerEvent) => {
    if (!topmost()) return;
    // A click outside a nested chain dismisses inner then outer. Unrelated manual
    // layers keep their own close/unsaved-edit policy without blocking auto layers.
    for (const open of [...layers].reverse()) if (open.mode === "auto") open.lightDismiss(event);
  };
  const cancel = () => { outsideStart = false; };
  const key = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229 || !topmost()) return;
    if (event.target instanceof Element) {
      const modal = event.target.closest(modalSelector);
      if (modal && !modal.contains(node)) return;
      // Manual editors handle Escape themselves, sometimes at document level.
      if (layers.some(open => open.mode === "manual" && open.node.contains(event.target as Node)
        && (!open.node.contains(node) || outside(event.target)))) return;
    }
    event.preventDefault(); event.stopPropagation(); dismiss();
  };
  const modalObserver = new MutationObserver(records => {
    if (records.some(record => record.target instanceof HTMLDialogElement
      && record.target.matches(modalSelector) && !record.target.contains(node))) dismiss();
  });
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    layers.splice(layers.indexOf(layer), 1);
    node.removeEventListener("toggle", toggle);
    modalObserver.disconnect();
    document.removeEventListener("pointerdown", down, true);
    document.removeEventListener("pointerup", up);
    document.removeEventListener("pointercancel", cancel);
    keyHost.removeEventListener("keydown", key as EventListener);
    node.removeAttribute("data-popover-open");
    if (native) {
      // Detached nodes and a browser-initiated light dismissal are already closed.
      if (node.isConnected && node.matches(":popover-open")) node.hidePopover();
    } else {
      node.removeAttribute("data-popover-fallback");
      node.setAttribute("popover", mode);
    }
  };
  const layer: Layer = { node, mode, dismiss, dispose, lightDismiss };
  if (nativePopovers()) {
    try { node.showPopover(source ? { source } : undefined); native = true; }
    catch { /* A partially implemented WebView can still reject showPopover. */ }
  }
  if (!native) {
    if (mode === "auto") {
      for (const previous of [...layers].reverse()) {
        if (previous.mode === "auto" && !previous.node.contains(source ?? node)) previous.dismiss();
      }
    }
    // Removing the native attribute also defeats its UA display:none rule when
    // the API exists but refuses to open this layer.
    node.removeAttribute("popover");
    node.setAttribute("data-popover-fallback", "");
    if (mode === "auto") {
      document.addEventListener("pointerdown", down, true);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", cancel);
      keyHost.addEventListener("keydown", key as EventListener);
      modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] });
    }
  } else node.addEventListener("toggle", toggle);
  node.setAttribute("data-popover-open", "");
  layers.push(layer);
  return dispose;
}
