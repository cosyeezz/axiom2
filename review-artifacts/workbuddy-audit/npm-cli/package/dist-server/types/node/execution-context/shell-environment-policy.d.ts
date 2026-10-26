/**
 * Shell environment policy: variables the Host gives the processes the Agent
 * starts for a session, through `start({ shellEnvironmentPolicy })`. Named
 * after Codex's `shell_environment_policy`.
 *
 * The Agent asks once when a session's run starts, and gives that answer to
 * every process the session starts in this runtime until its next run starts
 * or its residency ends; a process keeps the environment it started with.
 * Without that answer, before a session's first run or when the answer failed
 * or did not come in time, it asks when it is about to start a process. Values
 * reach a process through its environment; logs carry entry counts and names,
 * never values.
 */
import { type Session } from '../../vendor/cbc-core/node/index.js';
/** A process the Agent is about to start for a session. */
export interface ShellEnvironmentPolicyRequest {
    /**
     * The session the process runs for. A subagent or a teammate asks with
     * the root session of its run.
     */
    readonly sessionId: string;
    /**
     * Aborts with the tool call, hook event, configuration refresh, server
     * start or teammate start that asked. The ask a run starts with, and one
     * whose run has already ended, abort after 60 seconds.
     */
    readonly signal: AbortSignal;
}
export type ShellEnvironmentSet = Readonly<Record<string, string>>;
/**
 * Named after Codex's `shell_environment_policy`. Codex's `set` is a fixed map;
 * here it is asked per session, since the values differ between sessions.
 */
export interface ShellEnvironmentPolicy {
    /**
     * Variables to set, above this runtime's own environment. May return the
     * map directly or a Promise of it; `undefined` sets nothing. A throw and a
     * rejection are the same failure.
     */
    set(request: ShellEnvironmentPolicyRequest): ShellEnvironmentSet | undefined | Promise<ShellEnvironmentSet | undefined>;
}
export { SHELL_PREPEND_PATH_ENV } from './shell-prepend-path-env';
/** Prefix of the shell variables a wrapped command keeps policy values in while the snapshot loads. */
export declare const SHELL_POLICY_VARIABLE_PREFIX = "__CODEBUDDY_POLICY_";
/** Credentials reach the runtime through query options or `start({ apiKey })`, never the environment. */
export declare const AGENT_CREDENTIAL_ENV_KEYS: readonly ["CODEBUDDY_API_KEY", "CODEBUDDY_AUTH_TOKEN", "CODEBUDDY_SESSION_SKILL_DIRS"];
export interface ShellEnvironmentPolicyLogger {
    warn?(message: string): void;
    debug?(message: string): void;
}
/** Set by `start()` and cleared when the runtime stops. */
export declare function registerHostShellEnvironmentPolicy(policy: ShellEnvironmentPolicy | undefined): void;
/**
 * When a session's run starts, before anything in it asks: asks the Host once.
 * Every ask for the session gets this answer until its next run starts or its
 * residency ends, so the processes, hooks and sandbox rules of a run, and of
 * its subagents and in-process teammates, use the same values, as Codex
 * resolves the policy once per turn. An answer that failed or gave nothing is
 * not kept.
 *
 * The answer settles at the deadline even when the Host ignores the signal;
 * what the Host gives later is not kept. Returns the answer, for
 * {@link endRunShellEnvironment}.
 */
export declare function beginRunShellEnvironment(sessionId: string, logger?: ShellEnvironmentPolicyLogger, deadlineMs?: number): Promise<ShellEnvironmentSet | undefined> | undefined;
/**
 * When the session's residency ends, or when a run that never got a residency
 * ends: then only its own answer, so a later run's stays.
 */
export declare function endRunShellEnvironment(sessionId: string, answer?: Promise<ShellEnvironmentSet | undefined>): void;
/**
 * The answer of the session's latest run; without one, asks the Host. A
 * failure is logged by kind, without its message, and gives no variables:
 * the process starts without the policy. An ask the caller aborted is not a
 * failure.
 */
export declare function askShellEnvironment(sessionId: string | undefined, signal: AbortSignal, logger?: ShellEnvironmentPolicyLogger, platform?: NodeJS.Platform): Promise<ShellEnvironmentSet | undefined>;
/**
 * Copies an answer into a frozen dictionary without a prototype. Names the
 * Agent owns, invalid names, non-string values and values with NUL are
 * dropped with a warning that gives the name. On Windows names compare
 * case-insensitively, and names that differ only in case are all dropped.
 */
export declare function normalizeShellEnvironmentSet(answer: unknown, logger?: ShellEnvironmentPolicyLogger, platform?: NodeJS.Platform): ShellEnvironmentSet | undefined;
/**
 * Applies a layer above `target`. On Windows names compare case-insensitively,
 * so a layer's name replaces a variable spelled differently below it.
 */
export declare function overlayEnvironment(target: Record<string, string | undefined>, layer: Readonly<Record<string, string | undefined>> | undefined, platform?: NodeJS.Platform): void;
/** The environment a process starts from: `base` with the policy's variables above it. */
export declare function mergeShellEnvironment(base: Readonly<Record<string, string | undefined>>, set: ShellEnvironmentSet | undefined, platform?: NodeJS.Platform): NodeJS.ProcessEnv;
/** Reads a variable by its canonical name; on Windows names compare case-insensitively. */
export declare function readEnvironmentVariable(env: Readonly<Record<string, string | undefined>>, name: string, platform?: NodeJS.Platform): string | undefined;
/**
 * The directories in `CODEBUDDY_SHELL_PREPEND_PATH`, in order, split on this
 * platform's PATH separator unless the caller names one; empty entries dropped.
 */
export declare function readShellPrependPath(env: Readonly<Record<string, string | undefined>>, platform?: NodeJS.Platform, separator?: string): string[];
/** The session a process asks for: the root session of the current run, else the caller's own. */
export declare function policySessionId(session: Pick<Session, 'id'> | undefined): string | undefined;
/** How long an ask that no live run bounds may take: the default hook timeout. */
export declare const OWN_ASK_DEADLINE_MS = 60000;
/**
 * The signal an ask made for a session's run uses: the run's own while it is
 * live, else one that ends after {@link OWN_ASK_DEADLINE_MS}. A process that
 * still starts after its run ended gets the variables, as it does in CE.
 */
export declare function runAskSignal(session: {
    abortSignal?: AbortSignal;
} | undefined): AbortSignal;
/**
 * The answer for one tool call. The first need asks; risk review and its
 * probes, sandbox approval, execution and retries of the call share it, and a
 * failed answer stays failed for the call. Released when the call ends. A call
 * without an id asks each time.
 */
export declare function shellEnvironmentForToolCall(session: Session, toolCallId: string | undefined, logger?: ShellEnvironmentPolicyLogger): Promise<ShellEnvironmentSet | undefined>;
/** Drops a tool call's answer when the call completes, is denied, cancelled or fails. */
export declare function releaseToolCallShellEnvironment(session: object, toolCallId: string | undefined): void;
