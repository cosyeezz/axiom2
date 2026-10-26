import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { attachmentName } from "../shared/protocol.js";
import { OpenDialog, OpenDialogError, nativeOpenDialog, openDialogCommand } from "./open-dialog.js";
export { OpenDialogError as AttachmentPickerError };
export const attachmentPickerCommand = openDialogCommand;
export function nativeAttachmentPicker(options = {}) {
    const pick = nativeOpenDialog(options);
    return (initialDirectory, signal) => pick({ kind: "mixed", multiple: true, title: "打开文件或文件夹", initialDirectory }, signal);
}
/** Business adapter only: native selection and lifecycle belong to OpenDialog. */
export class AttachmentPicker {
    pick;
    dialog;
    constructor(pick, timeoutMs = 120_000, dialog = new OpenDialog(undefined, timeoutMs)) {
        this.pick = pick;
        this.dialog = dialog;
    }
    async select(initialDirectory, signal, kind = "mixed", multiple = true) {
        const paths = await this.dialog.select({ kind, multiple, title: "打开文件或文件夹", initialDirectory }, signal, this.pick ? (options, ownedSignal) => this.pick(options.initialDirectory, ownedSignal) : undefined);
        const items = [];
        for (const path of paths) {
            signal.throwIfAborted();
            let name, info;
            try {
                name = attachmentName(basename(path) || "根目录");
                info = await stat(path);
            }
            catch {
                throw new OpenDialogError("所选附件名称无效或无法访问", 400);
            }
            items.push({ name, path, kind: info.isDirectory() ? "folder" : /^(\.png|\.jpe?g|\.gif|\.webp|\.bmp|\.svg|\.avif|\.ico|\.tiff?|\.heic)$/i.test(extname(path)) ? "image" : "file" });
        }
        return items;
    }
    close() { return this.dialog.close(); }
}
//# sourceMappingURL=attachment-picker.js.map