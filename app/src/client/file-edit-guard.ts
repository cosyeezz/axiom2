const editors = new Set<() => boolean>();
export function registerFileEditor(dirty: () => boolean) {
  editors.add(dirty);
  return () => { editors.delete(dirty); };
}
export const hasUnsavedFileEdits = () => [...editors].some(dirty => dirty());
export function guardFileNavigation(action: () => void) {
  if (!hasUnsavedFileEdits() || window.confirm("文件有未保存的编辑。放弃这些编辑并继续？")) action();
}
