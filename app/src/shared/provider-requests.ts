/** In-memory inference observations, scoped to one Axiom backend lifetime. */
export type ProviderRequestEvent =
  | { type: "provider_request_stat"; phase: "start"; id: string; provider: string; precision: "http" | "call" }
  | { type: "provider_request_stat"; phase: "end"; id: string };
export interface ProviderRequestStatistics {
  startedAt: number;
  updatedAt: number;
  providers: { providerId: string; current: number; peak: number; rpm: number; callLevel: boolean }[];
}
