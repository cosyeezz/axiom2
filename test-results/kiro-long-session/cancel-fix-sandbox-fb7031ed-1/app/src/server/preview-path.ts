import { lstat, realpath } from "node:fs/promises";

/** Expand only macOS's known /tmp alias, never an arbitrary symlink. */
export async function previewFilePath(path: string, platform: NodeJS.Platform = process.platform): Promise<string> {
  if (platform !== "darwin" || path !== "/tmp" && !path.startsWith("/tmp/")) return path;
  const alias = await lstat("/tmp");
  if (!alias.isSymbolicLink() || await realpath("/tmp") !== "/private/tmp") return path;
  // Callers must still compare realpath with this fixed path, rejecting any
  // symlinks below the system alias, and retain their normal file checks.
  return "/private/tmp" + path.slice(4);
}
