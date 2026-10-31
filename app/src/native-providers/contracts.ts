/** In-process provider contracts. No agent SDK, UI, filesystem or credential backend. */
export interface NativeOAuthCredential {
  type: "oauth";
  access: string;
  refresh: string;
  expires: number;
  [key: string]: unknown;
}

export type NativeAuthPrompt = { signal?: AbortSignal; field?: string } & (
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | { type: "select"; message: string; options: readonly { id: string; label: string; description?: string }[] }
);
export type NativeAuthNotice =
  | { type: "auth_url"; url: string; instructions?: string }
  | { type: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
  | { type: "progress"; message: string };
export interface NativeAuthInteraction {
  signal: AbortSignal;
  prompt(prompt: NativeAuthPrompt): Promise<string>;
  notify(event: NativeAuthNotice): void;
}
export interface NativeOAuth<C extends NativeOAuthCredential> {
  login(interaction: NativeAuthInteraction): Promise<C>;
  refresh(credential: NativeOAuthCredential, signal: AbortSignal): Promise<C>;
}

/**
 * Host-owned, account-specific secure storage. Revision must change on EVERY
 * mutation (including logout of an empty account) and never be reused (no ABA).
 * transaction serializes callbacks against all other writes, cross-process when
 * needed. Recheck signal immediately before committing. Throwing leaves storage
 * unchanged. undefined means keep, null deletes (and advances the revision).
 * The host must not log the callback arguments, credentials or returned tokens.
 */
export interface NativeCredentialSnapshot<C extends NativeOAuthCredential> {
  revision: string;
  credential?: C;
}
export interface NativeCredentialStore<C extends NativeOAuthCredential> {
  read(signal: AbortSignal): Promise<NativeCredentialSnapshot<C>>;
  transaction(
    update: (current: NativeCredentialSnapshot<C>) => Promise<C | null | undefined>,
    signal: AbortSignal,
  ): Promise<NativeCredentialSnapshot<C>>;
}

export type NativeThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
export type NativeThinkingLevelMap = Partial<Record<NativeThinkingLevel, string | null>>;
export interface NativeThinkingCapabilities {
  supported: boolean;
  levels?: NativeThinkingLevelMap;
}
export interface NativeModel {
  id: string;
  name: string;
  input: ("text" | "image")[];
  /** Omitted limits/capabilities are unknown, not zero, free, or an upstream denial. */
  contextWindow?: number;
  maxOutputTokens?: number;
  thinking: NativeThinkingCapabilities;
}

export type NativeInputContent = string | readonly { type: "text" | "image"; text?: string; data?: string; mimeType?: string }[];
export type NativeMessage =
  | { role: "user"; content: NativeInputContent }
  | { role: "assistant"; stopReason?: string; content: readonly (
      { type: "text"; text: string } | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
      | { type: "thinking"; thinking: string; thinkingSignature?: string; redacted?: boolean })[] }
  | { role: "toolResult"; toolCallId: string; toolName: string; isError: boolean; content: NativeInputContent };
export interface NativeTool {
  name: string;
  description: string;
  parameters: object;
}
export interface NativeContext {
  systemPrompt?: string;
  tools?: readonly NativeTool[];
  messages: readonly NativeMessage[];
}

export interface NativeToolCall { id: string; name: string; arguments: Record<string, unknown> }
export interface NativeTokenUsage { input: number; output: number; cacheRead: number; cacheWrite: number; totalTokens: number }
export interface NativeDiagnostic { type: string; timestamp: number; details: Record<string, unknown> }
/** Tool fragments/completion are candidates only. Execute only after a successful done/toolUse. */
export type NativeStreamEvent =
  | { type: "start" }
  | { type: "text"; delta: string }
  | { type: "thinking"; delta?: string; signature?: string; redacted?: boolean }
  | { type: "thinking-level"; level: string }
  | { type: "response-id"; id: string }
  | { type: "tool-start"; id: string; name: string }
  | { type: "tool-delta"; id: string; delta: string; preview?: string }
  | { type: "tool-end"; call: NativeToolCall }
  | { type: "usage"; state: "partial"; counts?: never }
  | { type: "usage"; state: "complete"; counts: NativeTokenUsage }
  | { type: "diagnostic"; diagnostic: NativeDiagnostic }
  | { type: "done"; reason: "stop" | "toolUse" }
  | { type: "error"; reason: "aborted" | "error"; message: string };

export interface NativeStreamOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  sessionId?: string;
  continuationId?: string;
  headers?: Record<string, string | null>;
  fetch?: typeof fetch;
  toolChoice?: unknown;
  reasoning?: unknown;
  thinkingBudgets?: unknown;
  temperature?: unknown;
  maxTokens?: unknown;
  samplingParams?: unknown;
  onPayload?(payload: unknown): unknown | Promise<unknown>;
  onResponse?(response: { status: number; headers: Record<string, string> }): void | Promise<void>;
  onProviderEvent?(event: unknown): void | Promise<void>;
  /** Must validate the complete schema and return exactly the original JSON, without coercion. */
  validateToolInput?(definition: NativeTool, call: NativeToolCall): unknown | Promise<unknown>;
}
