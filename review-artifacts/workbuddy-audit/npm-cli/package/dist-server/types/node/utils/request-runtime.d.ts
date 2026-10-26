import { type Session } from '../../vendor/cbc-core/node/index.js';
import { type AgentRuntime } from '@genie/core';
import { type W3CTraceContextMeta } from '@genie/telemetry';
export declare const AGENT_RUNTIME_META_KEY = "codebuddy.ai/agentRuntime";
/** Process-level fallback, set by the host that spawns the agent (e.g. cloud sandbox, A2A). */
export declare const ENV_KEY_CODEBUDDY_AGENT_RUNTIME = "CODEBUDDY_AGENT_RUNTIME";
/** Unset/blank → undefined (fall through); any other non-enum value → 'other'. */
export declare function normalizeAgentRuntime(value: unknown): AgentRuntime | undefined;
/**
 * Query admission: carry the caller's runtime into the turn baggage so nested
 * agents and autonomous continuations inherit it. Empty when not supplied, so
 * session/env fallbacks still apply at request time.
 */
export declare function requestRuntimeBaggage(meta: Record<string, unknown> | null | undefined): Record<string, string>;
/**
 * Session-level value only: session meta (ACP `_meta['codebuddy.ai'].agentRuntime`) > process env > 'other'.
 * Safe for any endpoint; host baggage is never consulted here.
 */
export declare function resolveSessionAgentRuntime(session: Pick<Session, 'meta'> | undefined): AgentRuntime;
/**
 * Priority: turn baggage > {@link resolveSessionAgentRuntime}. Like the scene
 * mapping, host baggage is sent only to built-in model endpoints.
 */
export declare function resolveAgentRuntime(session: Pick<Session, 'meta'> | undefined): AgentRuntime;
/**
 * Outbound A2A: the callee runs as agent-agent, never as the caller's runtime.
 * Rewrites only this baggage member; trace context and other members pass through.
 */
export declare function withA2aAgentRuntime(carrier: Readonly<W3CTraceContextMeta>): W3CTraceContextMeta;
