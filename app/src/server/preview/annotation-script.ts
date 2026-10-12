// Executed only inside the isolated preview origin. No application credential is supplied.
function annotate(
  previewId: string,
  binding: string,
  parentOrigin: string,
  revision: string,
) {
  let enabled = false,
    hover: HTMLElement | null = null;
  const box = document.createElement("div");
  Object.assign(box.style, {
    position: "fixed",
    pointerEvents: "none",
    border: "2px solid #f7b56b",
    zIndex: "2147483647",
    display: "none",
  });
  document.documentElement.append(box);
  addEventListener("message", (e) => {
    if (
      e.source !== parent ||
      e.origin !== parentOrigin ||
      e.data?.type !== "axiom-annotate" ||
      e.data.previewId !== previewId ||
      e.data.binding !== binding
    )
      return;
    enabled = e.data.enabled === true;
    box.style.display = "none";
  });
  function selector(el: Element) {
    const parts: string[] = [];
    for (
      let n: Element | null = el;
      n && parts.length < 6;
      n = n.parentElement
    ) {
      if (n.id && !/token|secret|password|key/i.test(n.id)) {
        parts.unshift("#" + CSS.escape(n.id));
        break;
      }
      const index = n.parentElement
        ? Array.from(n.parentElement.children).indexOf(n) + 1
        : 1;
      parts.unshift(n.localName + `:nth-child(${index})`);
    }
    return parts.join(" > ");
  }
  addEventListener(
    "mousemove",
    (e) => {
      if (!enabled || !(e.target instanceof HTMLElement)) return;
      hover = e.target;
      const r = hover.getBoundingClientRect();
      Object.assign(box.style, {
        display: "block",
        left: r.x + "px",
        top: r.y + "px",
        width: r.width + "px",
        height: r.height + "px",
      });
    },
    true,
  );
  addEventListener(
    "click",
    (e) => {
      if (!enabled || !(e.target instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const el = e.target,
        r = el.getBoundingClientRect(),
        clone = el.cloneNode(true) as HTMLElement;
      const originals = [...el.querySelectorAll("*")],
        copies = [...clone.querySelectorAll("*")];
      for (let i = originals.length - 1; i >= 0; i--) {
        const n = originals[i],
          style = getComputedStyle(n);
        if (
          n.matches(
            "input,textarea,select,script,style,[hidden],[aria-hidden=true],[contenteditable]",
          ) ||
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.opacity === "0"
        )
          copies[i].remove();
      }
      for (const n of [clone, ...clone.querySelectorAll("*")])
        for (const a of [...n.attributes])
          if (
            !["id", "class", "role", "aria-label"].includes(a.name) ||
            /token|secret|password|key/i.test(a.value)
          )
            n.removeAttribute(a.name);
      const sensitive =
        el.matches("input,textarea,select,[hidden],[contenteditable]") ||
        !!el.closest("[hidden],[aria-hidden=true],[contenteditable]");
      parent.postMessage(
        {
          type: "axiom-element",
          previewId,
          binding,
          target: {
            url: location.origin + location.pathname,
            revision,
            selector: selector(el).slice(0, 2000),
            tag: el.localName,
            text: sensitive ? "" : (clone.textContent || "").slice(0, 1000),
            snippet: sensitive
              ? `<${el.localName}>`
              : clone.outerHTML.slice(0, 4000),
            rect: { x: r.x, y: r.y, width: r.width, height: r.height },
            viewport: { width: innerWidth, height: innerHeight },
          },
        },
        parentOrigin,
      );
      enabled = false;
      box.style.display = "none";
    },
    true,
  );
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      enabled = false;
      box.style.display = "none";
    }
  });
}
export function annotationScript(
  id: string,
  binding: string,
  parentOrigin: string,
  revision: string,
) {
  // The source runner preserves function names with this helper; compiled JS needs no helper.
  return `(()=>{const __name=(value)=>value;(${annotate.toString()})(${[id, binding, parentOrigin, revision].map((v) => JSON.stringify(v)).join(",")});})();`;
}
