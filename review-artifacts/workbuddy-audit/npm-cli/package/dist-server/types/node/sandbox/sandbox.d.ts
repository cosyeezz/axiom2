import { type Session } from '../../vendor/cbc-core/node/index.js';
export { currentRunSession, rootRunSession, rootScope, registerRootSessionResolver as registerSandboxSessionResolver } from '../../vendor/cbc-core/node/index.js';
/** File metadata as drivers report it. */
export interface SandboxFileStat {
    isFile: boolean;
    isDirectory: boolean;
    isSymbolicLink?: boolean;
    size?: number;
    mtime?: Date;
}
/** Buffered exec outcome. Named to stay distinct from the kernel shell layer's ShellResult. */
export interface SandboxShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}
/** The nine-method per-provider adapter interface. */
export interface SandboxDriver {
    readFile(path: string): Promise<string>;
    /**
     * 可选第十法（CBC 对 flue 九法签名的扩展）：缺席时包装层以读-拼-写合成
     * append——既有 driver 零改动即可用；just-bash 系后端可直通原生 appendFile。
     */
    appendFile?(path: string, content: string | Uint8Array): Promise<void>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    stat(path: string): Promise<SandboxFileStat>;
    readdir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    exec(command: string, options?: {
        cwd?: string;
        env?: Record<string, string>;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<SandboxShellResult>;
}
/**
 * `exec: 'buffered'` is the base contract every sandbox honors: run to
 * completion, deliver stdout/stderr/exitCode once. The booleans gate the
 * richer shell features; consumers must answer a missing capability with a
 * clear tool error, never a silent fallback.
 */
export interface SandboxCapabilities {
    exec: 'buffered';
    /** PTY allocation (terminal rendering, screen buffers). */
    pty: boolean;
    /** run_in_background tasks with live output polling. */
    background: boolean;
    /** Interactive stdin (write/sendKey into a running command). */
    interactive: boolean;
}
/** The live surface tools consume: exec plus the fs methods, resolved against `cwd`. */
export interface Sandbox {
    exec(command: string, options?: {
        cwd?: string;
        env?: Record<string, string>;
        timeoutMs?: number;
        signal?: AbortSignal;
    }): Promise<SandboxShellResult>;
    readFile(path: string): Promise<string>;
    readFileBuffer(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string | Uint8Array): Promise<void>;
    /**
     * Append，文件与父目录缺席时创建（CBC 扩展面，flue v2 签名之外——见
     * SandboxDriver.appendFile；Sandbox 面恒可用，driver 缺席由包装层合成）。
     */
    appendFile(path: string, content: string | Uint8Array): Promise<void>;
    stat(path: string): Promise<SandboxFileStat>;
    readdir(path: string): Promise<string[]>;
    exists(path: string): Promise<boolean>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    rm(path: string, options?: {
        recursive?: boolean;
        force?: boolean;
    }): Promise<void>;
    cwd: string;
    /** Resolve with this provider's path rules; an explicit base overrides cwd. */
    resolvePath(path: string, base?: string): string;
    capabilities: SandboxCapabilities;
}
/**
 * The canonical query() input: createSandbox({ id }) runs once per activation
 * with id = sessionId, so adapters can key durable resources on it and hand
 * the same workspace back after a passivate/hydrate cycle.
 */
export interface SandboxFactory {
    createSandbox(options: {
        id: string;
    }): Promise<Sandbox>;
}
/**
 * Settlement report for an orphaned command: an exec whose caller was
 * released by an abort while the provider call was still in flight. The
 * wrapper rejects promptly on abort — never gated on the remote command's
 * settlement — so on a provider that cannot cancel mid-flight, the command
 * keeps running until it settles on its own. That settlement is consumed
 * (fulfillment and rejection alike) and never surfaces in the conversation;
 * the `onOrphanSettled` callback on {@link sandboxFromDriver} is its only
 * outlet, for adapters that want to log, bill, or reap out-of-band.
 */
export interface OrphanedExecSettlement {
    command: string;
    startedAt: Date;
    abortedAt: Date;
    settledAt: Date;
    result?: SandboxShellResult;
    error?: unknown;
}
export declare function abortErrorFor(signal: AbortSignal): Error;
/**
 * Shared writeFile parent-creation contract for every Sandbox implementation.
 * No stdlib equivalent exists, and the lazy shape is a cost bet, not a
 * guarantee: parent exists (the common case) = 1 driver call; parent missing
 * = 3 (failed write, mkdir -p, retry) — worse than an eager mkdir's constant
 * 2, better whenever existing parents dominate. Backends whose native write
 * already creates parents get a constant 1 and never hit the retry. Mkdir
 * errors are swallowed so the retried write's error stays authoritative.
 */
export declare function writeFileCreatingParents(write: () => Promise<void>, mkdirParent: () => Promise<unknown>): Promise<void>;
/**
 * Wrap a SandboxDriver into a live Sandbox. Path resolution, the exec abort
 * race, orphan bookkeeping, and the writeFile parent guarantee live here —
 * once — so a provider adapter is exactly nine methods.
 */
export declare function sandboxFromDriver(driver: SandboxDriver, cwd: string, options?: {
    onOrphanSettled?: (settlement: OrphanedExecSettlement) => void;
    capabilities?: Partial<Omit<SandboxCapabilities, 'exec'>>;
}): Sandbox;
/**
 * Scope an existing Sandbox to a different working directory: a query cwd
 * overrides the sandbox default without rebuilding the sandbox.
 */
export declare function createCwdSandbox(parentEnv: Sandbox, cwd: string): Sandbox;
/** Duck-typed just-bash Bash instance: exec + getCwd + fs. */
export interface BashLike {
    exec(command: string, options?: {
        cwd?: string;
        env?: Record<string, string>;
        signal?: AbortSignal;
    }): Promise<{
        stdout?: string;
        stderr?: string;
        exitCode?: number;
    }>;
    getCwd(): string;
    fs: {
        readFile(path: string): Promise<string>;
        readFileBuffer(path: string): Promise<Uint8Array>;
        writeFile(path: string, content: string | Uint8Array): Promise<void>;
        /** just-bash IFileSystem 原生具备；旧版缺席时由包装层合成。 */
        appendFile?(path: string, content: string | Uint8Array): Promise<void>;
        stat(path: string): Promise<{
            isFile: boolean;
            isDirectory: boolean;
            isSymbolicLink?: boolean;
            size?: number;
            mtime?: Date;
        }>;
        readdir(path: string): Promise<string[]>;
        exists(path: string): Promise<boolean>;
        mkdir(path: string, options?: {
            recursive?: boolean;
        }): Promise<void>;
        rm(path: string, options?: {
            recursive?: boolean;
            force?: boolean;
        }): Promise<void>;
        resolvePath(base: string, path: string): string;
    };
}
export type BashFactory = () => BashLike | Promise<BashLike>;
/** Translate `timeoutMs` into an AbortSignal composed with the caller's. */
export declare function composeTimeoutSignal(timeoutMs: number | undefined, signal: AbortSignal | undefined): AbortSignal | undefined;
/**
 * Wrap a just-bash factory into a SandboxFactory: file methods bind straight
 * onto the just-bash filesystem — no exec round-trips — and exec runs through
 * the in-process bash with the timeout translated to a signal (just-bash has
 * no native timeout option).
 */
export declare function bash(factory: BashFactory): SandboxFactory;
/**
 * Resolve a query() sandbox input into the live Sandbox for one activation,
 * applying the cwd precedence rule: an explicit query cwd overrides the
 * sandbox default; absent that, the factory-built sandbox keeps its adapter
 * default. A bare driver is the sugar form — wrapped at the explicit cwd, or
 * at `/` when none is given.
 */
export declare function sandboxForActivation(input: SandboxFactory | SandboxDriver, sessionId: string, explicitCwd?: string): Promise<Sandbox>;
/** Mount a sandbox on a session. Called by the server surface on activation. */
export declare function setSessionSandbox(session: Session, sandbox: Sandbox | undefined): void;
/** Read the mounted sandbox. Undefined keeps the shell layer on its original path. */
export declare function getSessionSandbox(session: Session | undefined): Sandbox | undefined;
/**
 * Precedence rule shared by every consumer: the explicitly passed session
 * wins, the root scope's session is the fallback — sandbox bindings are
 * identity-plane data living on the query's root session, so a subagent's
 * explicit (child) session misses and resolves the root's sandbox.
 */
export declare function resolveSandbox(session?: Session): Sandbox | undefined;
/**
 * The mounted sandbox only when it replaces the host execution plane.
 * Host-backed sandboxes declare `pty: true` and are served by the kernel
 * shell stack and its local isolation policy instead.
 */
export declare function resolveExecutionSandbox(session?: Session): Sandbox | undefined;
/**
 * The sandbox of the current run's query. Bindings are identity-plane data
 * living on the query's ROOT session, so this resolves through
 * `rootRunSession()` — inside a subagent run it is still the main session's
 * sandbox. Safe outside runs.
 */
export declare function currentRunSandbox(): Sandbox | undefined;
