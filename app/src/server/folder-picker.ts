import { OpenDialog, OpenDialogError, nativeOpenDialog, openDialogCommand, type PickerSpawn } from "./open-dialog.js";

// Compatibility adapter: authorization remains in the workspace route, all UI/process logic is shared.
export { OpenDialogError as FolderPickerError };
export type PickFolder = (signal: AbortSignal) => Promise<string | null>;
export const folderPickerCommands = (platform: NodeJS.Platform) => [openDialogCommand(platform)];
export function nativeFolderPicker(options: { platform?: NodeJS.Platform; spawn?: PickerSpawn } = {}): PickFolder {
  const pick = nativeOpenDialog(options);
  return async (signal) => (await pick({ kind: "folder", multiple: false, title: "打开工作空间文件夹" }, signal))[0] ?? null;
}
export class FolderPicker {
  constructor(private readonly pick?: PickFolder, timeoutMs = 120_000, private readonly dialog = new OpenDialog(undefined, timeoutMs)) {}
  async select(signal: AbortSignal): Promise<string | null> {
    const paths = await this.dialog.select({ kind: "folder", multiple: false, title: "打开工作空间文件夹" }, signal,
      this.pick ? async (_options, ownedSignal) => { const path = await this.pick!(ownedSignal); return path === null ? [] : [path]; } : undefined);
    return paths[0] ?? null;
  }
  close() { return this.dialog.close(); }
}
