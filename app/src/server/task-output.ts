import { taskToolName } from "../shared/tasks.js";
export { modelTaskOutput } from "../shared/task-output.js";

/** Preserve the existing UI JSON contract without putting metadata in model content.
 * Old transcripts and failed tools still render their original content.
 */
export function taskDisplayText(name: string | undefined, details: unknown, isError = false): string | undefined {
  if (!isError && name && taskToolName(name) && details && typeof details === "object" && !Array.isArray(details))
    return JSON.stringify(details);
  return undefined;
}
