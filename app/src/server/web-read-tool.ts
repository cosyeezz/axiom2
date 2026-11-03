import { defineTool } from "@earendil-works/pi-coding-agent";
import { webReadParameters, type WebReadResult } from "../shared/web-read.js";

export function webReadTool(call: (id: string, params: unknown, signal?: AbortSignal) => Promise<unknown>) {
  return defineTool({ name: "web_read", label: "读取网页",
    description: "Read public HTTP(S) pages for their content. Use urls for a new read, or sourceId and cursor to continue. Browser login and JavaScript are not supported.",
    parameters: webReadParameters,
    execute: async (id, params, signal) => {
      const result = await call(id, params, signal) as WebReadResult;
      if (!result || result.schemaVersion !== 1 || !Array.isArray(result.items)) throw Error("Invalid web reader response.");
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status === "error" };
    },
  });
}
