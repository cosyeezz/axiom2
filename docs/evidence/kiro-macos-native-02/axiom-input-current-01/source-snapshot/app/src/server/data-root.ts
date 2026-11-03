import { homedir } from "node:os";
import { join, resolve } from "node:path";

/** Platform default, independent of per-instance AXIOM_DATA_DIR overrides. */
export function defaultDataRoot() {
  return process.platform === "win32"
    ? join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Axiom2")
    : process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support", "Axiom2")
      : join(process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"), "Axiom2");
}
export function dataRoot() {
  return process.env.AXIOM_DATA_DIR ? resolve(process.env.AXIOM_DATA_DIR) : defaultDataRoot();
}
