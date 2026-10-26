import { taskToolName } from "../shared/tasks.js";
export { modelTaskOutput } from "../shared/task-output.js";
/** Preserve the existing UI JSON contract without putting metadata in model content.
 * Old transcripts and failed tools still render their original content.
 */
export function taskDisplayText(name, details, isError = false) {
    if (!isError && name && taskToolName(name) && details && typeof details === "object" && !Array.isArray(details))
        return JSON.stringify(details);
    return undefined;
}
//# sourceMappingURL=task-output.js.map