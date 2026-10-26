import { Logger } from '@celljs/core';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { ToolArg, ToolNames } from '../../vendor/cbc-shared/node/index.js';
import { Workspace } from '@genie/runtime';
import type { RunContext } from '@openai/agents';
import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolCallArgumentRenderer, ToolResult } from './tool-protocol';
declare const GlobParameters: z.ZodObject<{
    pattern: z.ZodString;
    path: z.ZodOptional<z.ZodString>;
    limit: z.ZodDefault<z.ZodNumber>;
    offset: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    offset: number;
    pattern: string;
    limit: number;
    path?: string | undefined;
}, {
    pattern: string;
    path?: string | undefined;
    offset?: number | undefined;
    limit?: number | undefined;
}>;
export declare class GlobTool extends BaseTool implements Tool {
    protected readonly workspace: Workspace;
    protected readonly logger: Logger;
    /**
     * Tool-level timeout (ms) bounding the WHOLE glob search, including the
     * fallback path. Exposed as an instance field so tests can shrink it.
     */
    protected fallbackTimeoutMs: number;
    name: ToolNames;
    isConcurrencySafe(): boolean;
    aliases: string[];
    parameters: z.ZodObject<{
        pattern: z.ZodString;
        path: z.ZodOptional<z.ZodString>;
        limit: z.ZodDefault<z.ZodNumber>;
        offset: z.ZodDefault<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        offset: number;
        pattern: string;
        limit: number;
        path?: string | undefined;
    }, {
        pattern: string;
        path?: string | undefined;
        offset?: number | undefined;
        limit?: number | undefined;
    }>;
    argumentRenderer: ToolCallArgumentRenderer;
    resolveNeedPermissionArgs(runContext: RunContext, input: z.infer<typeof GlobParameters>, callId?: string): ToolArg[];
    /**
     * Auto mode classifier projection: the glob pattern (Claude alignment,
     * decision D1). Glob is in the read-only history set; consulted only when it
     * is the current action being classified.
     */
    toAutoClassifierInput(input: unknown): string;
    resolveThrownErrorCode(error: unknown): string;
    execute(input: z.infer<typeof GlobParameters>, context: RunContext<Session>): Promise<ToolResult>;
    /**
     * Run the glob search under a hard tool-level timeout that covers BOTH the
     * ripgrep path and the npm `glob` fallback. The previous implementation only
     * bounded ripgrep; the fallback could hang forever (#59151).
     *
     * The timeout is enforced via `Promise.race` against a timer, so the tool is
     * guaranteed to settle after {@link GLOB_FALLBACK_TIMEOUT_MS} even if the
     * underlying `glob()` walk does not honor the abort signal promptly. We also
     * abort the derived controller so the in-flight ripgrep child / glob walk is
     * asked to stop and is not leaked.
     */
    private searchWithTimeout;
    /**
     * Try ripgrep first, fall back to npm `glob` only for genuine "ripgrep
     * unavailable / failed to run" errors. A timeout or abort must NOT fall back
     * (the fallback would just hang on the same huge directory), so those are
     * detected and rethrown instead.
     */
    private runSearch;
    private isRipgrepAvailable;
    private shouldFallbackFromRipgrep;
    private runFallbackSearch;
    /** Whether an error came from a search timeout or abort (no fallback allowed). */
    private isTimeoutOrAbortError;
    private classifyGlobError;
    private wrapGlobError;
    private isTimeoutError;
    private isAbortError;
    private isPermissionError;
    private isPathError;
    private isPatternError;
    private isPatternValidationError;
    private isInvalidParamsError;
    private getErrorDetails;
    private createEmptyResult;
    private resolveSearchDirectory;
    private normalizeGlobParams;
    private performRipgrepGlobSearch;
    private performFallbackGlobSearch;
    private get rootDirectory();
}
export {};
