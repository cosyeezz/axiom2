/** Reusable native Open contract; cancellation is an empty selection, not an error. */
export type OpenDialogKind = "file" | "folder" | "mixed";
export interface OpenDialogOptions {
  kind: OpenDialogKind;
  multiple: boolean;
  title?: string;
  initialDirectory?: string;
}
export const openDialogLimit = 50;
