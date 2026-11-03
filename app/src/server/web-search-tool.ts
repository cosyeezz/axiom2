import { defineTool } from "@earendil-works/pi-coding-agent";
import { webSearchParameters, type WebSearchResult } from "../shared/web-search.js";

export function webSearchTool(call: (id: string, params: unknown, signal?: AbortSignal, progress?: (text: string) => void) => Promise<unknown>) {
  return defineTool({ name: "axiom_search", label: "搜索网页",
    description: "Search Google to find relevant web pages.",
    parameters: webSearchParameters,
    execute: async (id, params, signal, onUpdate) => {
      const result = await call(id, params, signal, text => onUpdate?.({ content: [{ type: "text", text }], details: {} })) as WebSearchResult;
      if (!result || result.schemaVersion !== 1 || !Array.isArray(result.items)) throw Error("Invalid Google search response.");
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result, isError: result.status === "error" };
    },
  });
}
