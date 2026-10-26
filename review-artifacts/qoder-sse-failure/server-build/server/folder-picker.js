import { OpenDialog, OpenDialogError, nativeOpenDialog, openDialogCommand } from "./open-dialog.js";
// Compatibility adapter: authorization remains in the workspace route, all UI/process logic is shared.
export { OpenDialogError as FolderPickerError };
export const folderPickerCommands = (platform) => [openDialogCommand(platform)];
export function nativeFolderPicker(options = {}) {
    const pick = nativeOpenDialog(options);
    return async (signal) => (await pick({ kind: "folder", multiple: false, title: "打开工作空间文件夹" }, signal))[0] ?? null;
}
export class FolderPicker {
    pick;
    dialog;
    constructor(pick, timeoutMs = 120_000, dialog = new OpenDialog(undefined, timeoutMs)) {
        this.pick = pick;
        this.dialog = dialog;
    }
    async select(signal) {
        const paths = await this.dialog.select({ kind: "folder", multiple: false, title: "打开工作空间文件夹" }, signal, this.pick ? async (_options, ownedSignal) => { const path = await this.pick(ownedSignal); return path === null ? [] : [path]; } : undefined);
        return paths[0] ?? null;
    }
    close() { return this.dialog.close(); }
}
//# sourceMappingURL=folder-picker.js.map