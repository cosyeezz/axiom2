import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { ConfirmDialog } from "./ConfirmDialog.js";

const editors = new Set<() => boolean>();
let confirming = false;
export function registerFileEditor(dirty: () => boolean) {
  editors.add(dirty);
  return () => { editors.delete(dirty); };
}
export const hasUnsavedFileEdits = () => [...editors].some(dirty => dirty());
export function guardFileNavigation(action: () => void) {
  if (confirming) return;
  if (!hasUnsavedFileEdits()) { action(); return; }
  confirming = true;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  root.render(createElement(ConfirmDialog, {
    title: "放弃未保存的文件编辑？",
    description: "文件有未保存的编辑。继续操作将放弃这些修改。",
    confirmLabel: "放弃修改",
    danger: true,
    onConfirm: async () => { action(); },
    onClose: () => {
      queueMicrotask(() => { root.unmount(); host.remove(); confirming = false; });
    },
  }));
}
