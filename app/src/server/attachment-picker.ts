import { stat } from "node:fs/promises";
import type { OpenDialogKind } from "../shared/open-dialog.js";
import { basename, extname } from "node:path";
import { attachmentName, type PickedAttachment } from "../shared/protocol.js";
import { OpenDialog, OpenDialogError, nativeOpenDialog, openDialogCommand, type PickerSpawn } from "./open-dialog.js";

export { OpenDialogError as AttachmentPickerError };
export type PickAttachments = (initialDirectory: string, signal: AbortSignal) => Promise<string[]>;
export const attachmentPickerCommand = openDialogCommand;
export function nativeAttachmentPicker(options: { platform?: NodeJS.Platform; spawn?: PickerSpawn } = {}): PickAttachments {
  const pick = nativeOpenDialog(options);
  return (initialDirectory, signal) => pick({ kind: "mixed", multiple: true, title: "打开文件或文件夹", initialDirectory }, signal);
}

/** Business adapter only: native selection and lifecycle belong to OpenDialog. */
export class AttachmentPicker {
  constructor(private readonly pick?: PickAttachments, timeoutMs = 120_000, private readonly dialog = new OpenDialog(undefined, timeoutMs)) {}
  async select(initialDirectory: string, signal: AbortSignal, kind: OpenDialogKind = "mixed", multiple = true): Promise<PickedAttachment[]> {
    const paths = await this.dialog.select({ kind, multiple, title: "打开文件或文件夹", initialDirectory }, signal,
      this.pick ? (options, ownedSignal) => this.pick!(options.initialDirectory!, ownedSignal) : undefined);
    const items: PickedAttachment[] = [];
    for (const path of paths) {
      signal.throwIfAborted();
      let name: string, info;
      try { name = attachmentName(basename(path) || "根目录"); info = await stat(path); }
      catch { throw new OpenDialogError("所选附件名称无效或无法访问", 400); }
      items.push({ name, path, kind: info.isDirectory() ? "folder" : /^(\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.svg|\.avif|\.ico|\.tiff?|\.heic)$/i.test(extname(path)) ? "image" : "file" });
    }
    return items;
  }
  close() { return this.dialog.close(); }
}
