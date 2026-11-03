import { Type, type Static } from "typebox";

export const webReadLimits = Object.freeze({ batch: 4, urlChars: 4096, defaultChars: 12000, maxChars: 20000,
  minChars: 500, wireBytes: 2_000_000, decodedBytes: 4_000_000, documentChars: 300_000,
  timeoutMs: 30_000, parseMs: 8_000, redirects: 4, concurrent: 4, snapshots: 32,
  snapshotChars: 2_000_000, retentionMs: 30 * 60_000 });
const chars = Type.Optional(Type.Integer({ minimum: webReadLimits.minChars, maximum: webReadLimits.maxChars, description: "Maximum characters per page (default 12000)." }));
// Every alternative already requires an object. Preserve the union constraints
// while declaring the root type required by object-only tool schema transports.
// Kiro additionally rejects top-level combinators; its wire layer merges branches
// (kiroWireToolSchema) while Pi keeps validating against this union locally.
export const webReadParameters = Type.Union([
  Type.Object({ urls: Type.Array(Type.String({ minLength: 1, maxLength: webReadLimits.urlChars }), { minItems: 1, maxItems: webReadLimits.batch }), maxChars: chars }, { additionalProperties: false }),
  Type.Object({ targetRefs: Type.Array(Type.String({ minLength: 1, maxLength: 200 }), { minItems: 1, maxItems: webReadLimits.batch, description: "Reserved; use urls instead." }), maxChars: chars }, { additionalProperties: false }),
  Type.Object({ sourceId: Type.String({ minLength: 1, maxLength: 100 }), cursor: Type.String({ minLength: 1, maxLength: 200 }), maxChars: chars }, { additionalProperties: false }),
], { type: "object" });
export type WebReadInput = Static<typeof webReadParameters>;
export type WebReadStatus = "success" | "empty" | "partial" | "error";
export interface WebReadItem {
  index: number;
  status: WebReadStatus;
  sourceId?: string;
  displayUrl?: string;
  citationUrl?: string;
  title?: string;
  retrievedAt?: string;
  backend?: "http-local";
  route?: "public-direct";
  evidenceType?: "webpage-body";
  content?: string;
  start?: number;
  end?: number;
  totalChars?: number;
  cursor?: string;
  truncated?: boolean;
  complete?: boolean;
  warnings?: string[];
  error?: { code: string; message: string; retryable: boolean };
}
export interface WebReadResult { schemaVersion: 1; requestId: string; status: WebReadStatus; items: WebReadItem[]; warnings: string[] }
