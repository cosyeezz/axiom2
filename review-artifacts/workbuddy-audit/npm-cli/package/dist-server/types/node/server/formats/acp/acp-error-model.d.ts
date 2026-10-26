import type { PromptResponse } from '@agentclientprotocol/sdk';
import type { Error as AcpV2Error } from '@agentclientprotocol/sdk/experimental/v2';
import { RequestError } from '../../../acp/acp-sdk-values';
export declare const CODEBUDDY_ERROR_META_KEY = "codebuddy.ai/error";
export declare const CODEBUDDY_ERROR_UPDATE_TYPE = "_codebuddy.ai/error";
/**
 * Canonical, user-safe technical error shared by ACP v1 and v2 facades.
 *
 * The application core still has to preserve the legacy PromptResponse shape
 * for the product compatibility endpoint. Canonical facades normalize that
 * internal outcome at their last common boundary instead of leaking the
 * historical `refusal + errorMessage` dialect onto the wire.
 */
export interface CodeBuddyError {
    code: string;
    message: string;
    additionalDetails?: string | null;
    httpStatusCode?: number | null;
    /** Upstream business code (>= 1000), distinct from HTTP and JSON-RPC codes. */
    businessCode?: number;
    /** User-facing text the model service supplied, keyed by BCP 47 language tag. */
    display?: CodeBuddyErrorDisplay;
    /** Capacity queue facts the model service supplied with its business code. */
    queue?: CodeBuddyErrorQueue;
    /** The model service marked the request as a custom (user-configured) model request. */
    customModel?: boolean;
}
export interface CodeBuddyErrorDisplay {
    /** Title text per language (`displayMsg`). */
    message?: Record<string, string>;
    /** Supplementary line per language (`displayTips`). */
    tips?: Record<string, string>;
    /** User actions in display order (`actions`); unknown values are skipped by clients. */
    actions?: string[];
}
export interface CodeBuddyErrorQueue {
    position?: number;
    size?: number | string;
    /** Seconds. */
    estimatedWait?: number;
    /** Seconds until the next status poll. */
    retryAfter?: number;
    userType?: string;
}
export interface ParsedPromptTechnicalError {
    error: CodeBuddyError;
    rpcCode: number;
}
export declare function isCodeBuddyError(value: unknown): value is CodeBuddyError;
/**
 * The canonical error of a failed run, from the failure the kernel reported.
 * Classification reuses the Agent's structured error facts; `message` names the
 * error, and the failure's own text is published only as the redacted
 * `additionalDetails` (see publicDetails), as the ACP v1 facade publishes it
 * in `data.details`.
 */
export declare function codeBuddyErrorFromFailure(failure: unknown, message: string): CodeBuddyError;
export declare function codeBuddyErrorFromRequestError(requestError: Pick<RequestError, 'code' | 'data' | 'message'>): CodeBuddyError;
/**
 * The canonical error an abort reason attributes to the run it stops. A host
 * that stops a run for a cause the user must act on attaches the public error
 * under the `codebuddy.ai/error` key of the reason it aborts with; the run's
 * durable terminal then records that error instead of a cancellation. Any
 * other reason attributes nothing.
 */
export declare function codeBuddyErrorOfAbortReason(reason: unknown): CodeBuddyError | undefined;
/**
 * Read the application core's internal technical outcome. A policy refusal
 * has no error payload and therefore remains a normal ACP refusal.
 */
export declare function readPromptTechnicalError(response: Pick<PromptResponse, '_meta' | 'stopReason'>): ParsedPromptTechnicalError | undefined;
export declare function createCanonicalPromptRequestError(response: Pick<PromptResponse, '_meta' | 'stopReason'>): RequestError | undefined;
/** Standard v2 terminal error; the legacy v1 response remains unchanged. */
export declare function codeBuddyAcpV2Error(error: CodeBuddyError): AcpV2Error;
