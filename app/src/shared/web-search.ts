import { Type, type Static } from "typebox";

export const webSearchLimits = Object.freeze({ queries: 4, queryChars: 1000, results: 50, defaultResults: 10,
  pages: 5, timeoutMs: 120_000, navigationMs: 25_000, verificationMs: 90_000, callsPerRun: 20 });
export const webSearchParameters = Type.Object({
  queries: Type.Array(Type.String({ minLength: 1, maxLength: webSearchLimits.queryChars }), {
    minItems: 1, maxItems: webSearchLimits.queries, description: "Google search queries." }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: webSearchLimits.results, description: "Maximum results per query (default 10)." })),
  start: Type.Optional(Type.Integer({ minimum: 0, maximum: 990, description: "Google result offset (default 0). Use a returned nextStart to request another page." })),
}, { additionalProperties: false });
export type WebSearchInput = Static<typeof webSearchParameters>;
export type SearchStatus = "success" | "empty" | "partial" | "error";
export interface SearchCandidate { title: string; url?: string; displayUrl: string; snippet: string; rank: number }
export interface SearchItem {
  index: number; query: string; status: SearchStatus; results: SearchCandidate[];
  retrievedAt?: string; source?: "google"; evidenceType?: "search-snippet"; route?: "chrome-current";
  nextStart?: number; warnings?: string[]; error?: { code: string; message: string; retryable: boolean };
}
export interface WebSearchResult { schemaVersion: 1; requestId: string; status: SearchStatus; items: SearchItem[]; warnings: string[] }
