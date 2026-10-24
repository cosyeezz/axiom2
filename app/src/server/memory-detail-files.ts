import { lstatSync } from "node:fs";
import { join } from "node:path";
import { memoryDetails } from "../shared/memory-detail-paths.js";
import { memoryPath } from "./memory-files.js";

/** Probe only derived filenames, never read sibling details merely to discover them. */
export function availableMemoryDetails(directory: string, entry: string) {
  return memoryDetails(entry).filter(detail => {
    const parts = detail.path.split("/");
    for (let length = 1; length <= parts.length; length++) {
      let stat;
      try { stat = lstatSync(join(directory, ...parts.slice(0, length))); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
      }
      if (stat.isSymbolicLink() || (length < parts.length ? !stat.isDirectory() : !stat.isFile()))
        throw Error("记忆详情路径包含链接或无效文件类型");
    }
    memoryPath(directory, detail.path);
    return true;
  });
}
