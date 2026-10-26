/**
 * API Response Utilities
 *
 * 统一的 HTTP API 响应格式和错误码，用于所有 `/api/v1/*` 公开端点。
 *
 * 两种使用方式：
 *   1. 框架自动序列化 — Controller 方法 `return success({ ... })` 或 `return error(...)`
 *   2. 手动控制响应 — 调用 `sendData(ctx, ...)` 或 `sendError(ctx, ...)`（用于需要提前终止请求的场景）
 */
import type { Context } from '@celljs/web/lib/node';
/**
 * 标准成功响应信封。
 * 所有 `/api/v1/*` 端点的成功响应统一使用此格式。
 */
export interface ApiSuccessResponse<T = unknown> {
    data: T;
    meta?: ApiResponseMeta;
}
/**
 * 分页元信息。
 */
export interface ApiResponseMeta {
    page?: number;
    pageSize?: number;
    total?: number;
}
/**
 * 标准错误响应信封。
 * 所有 `/api/v1/*` 端点的错误响应统一使用此格式。
 */
export interface ApiErrorResponse {
    error: {
        /** 机器可读错误码（大写 SNAKE_CASE），如 "AUTH_REQUIRED" */
        code: string;
        /** 人类可读描述 */
        message: string;
        /** 可选附加详情 */
        details?: unknown;
    };
}
/**
 * 结构化错误码。
 * 开发者可以通过 error.code 做 switch/case 程序化处理。
 */
export declare const ApiErrorCode: {
    readonly AUTH_REQUIRED: "AUTH_REQUIRED";
    readonly AUTH_INVALID: "AUTH_INVALID";
    readonly AUTH_RATE_LIMITED: "AUTH_RATE_LIMITED";
    readonly FORBIDDEN: "FORBIDDEN";
    /**
     * SSH 准备只允许回环来源：带密钥（密码/私钥）的 prepare 不能走非回环 HTTP，
     * 否则密码或私钥会明文出现在网关到浏览器的链路上。
     */
    readonly PREPARATION_LOOPBACK_REQUIRED: "PREPARATION_LOOPBACK_REQUIRED";
    readonly NOT_FOUND: "NOT_FOUND";
    readonly BAD_REQUEST: "BAD_REQUEST";
    readonly RATE_LIMITED: "RATE_LIMITED";
    readonly INTERNAL_ERROR: "INTERNAL_ERROR";
    /** 服务暂时不可用（可重试）：例如 Agent Home 目录锁忙，什么都没写。 */
    readonly SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE";
    readonly PLUGIN_MANAGEMENT_DISABLED: "PLUGIN_MANAGEMENT_DISABLED";
    readonly PLUGIN_RECONCILE_TIMEOUT: "PLUGIN_RECONCILE_TIMEOUT";
    readonly PLUGIN_RECONCILE_FAILED: "PLUGIN_RECONCILE_FAILED";
    readonly PLUGIN_RUNTIME_APPLY_FAILED: "PLUGIN_RUNTIME_APPLY_FAILED";
    readonly SESSION_NOT_FOUND: "SESSION_NOT_FOUND";
    readonly SESSION_DELETE_CURRENT: "SESSION_DELETE_CURRENT";
    readonly INSTANCE_NOT_FOUND: "INSTANCE_NOT_FOUND";
    readonly TERMINAL_NOT_FOUND: "TERMINAL_NOT_FOUND";
    readonly RUN_NOT_FOUND: "RUN_NOT_FOUND";
    readonly RUN_ALREADY_COMPLETED: "RUN_ALREADY_COMPLETED";
    readonly PLATFORM_UNSUPPORTED: "PLATFORM_UNSUPPORTED";
    readonly SIGNATURE_INVALID: "SIGNATURE_INVALID";
    readonly PATH_REQUIRED: "PATH_REQUIRED";
    readonly PATH_NOT_ABSOLUTE: "PATH_NOT_ABSOLUTE";
    readonly PATH_NOT_DIRECTORY: "PATH_NOT_DIRECTORY";
    readonly JOB_WORKSPACE_UNAVAILABLE: "JOB_WORKSPACE_UNAVAILABLE";
    readonly FILE_TYPE_FORBIDDEN: "FILE_TYPE_FORBIDDEN";
    readonly CONNECTION_LIMIT: "CONNECTION_LIMIT";
    readonly WORKER_NOT_FOUND: "WORKER_NOT_FOUND";
    readonly WORKER_NO_LOGS: "WORKER_NO_LOGS";
    readonly DAEMON_NOT_RUNNING: "DAEMON_NOT_RUNNING";
    readonly DAEMON_ALREADY_RUNNING: "DAEMON_ALREADY_RUNNING";
    readonly DAEMON_RESTART_REFUSED: "DAEMON_RESTART_REFUSED";
    readonly HOST_NOT_FOUND: "HOST_NOT_FOUND";
    readonly LOCAL_HOST_NOT_REMOVABLE: "LOCAL_HOST_NOT_REMOVABLE";
    readonly INVALID_LOCAL_HOST_UPDATE: "INVALID_LOCAL_HOST_UPDATE";
    readonly HOST_KEY_UNCONFIRMED: "HOST_KEY_UNCONFIRMED";
    readonly HOST_KEY_CHANGED: "HOST_KEY_CHANGED";
    readonly SSH_ALREADY_CONNECTED: "SSH_ALREADY_CONNECTED";
    readonly SSH_NOT_CONNECTED: "SSH_NOT_CONNECTED";
    readonly SSH_CONNECTION_FAILED: "SSH_CONNECTION_FAILED";
};
export type ApiErrorCodeValue = typeof ApiErrorCode[keyof typeof ApiErrorCode];
/**
 * 构建成功响应对象。用于 Controller 方法直接 return。
 * 框架会自动 JSON 序列化返回值。
 *
 * @example
 * ```typescript
 * @Get('sessions')
 * async list(): Promise<ApiSuccessResponse> {
 *     const sessions = await this.getAll();
 *     return success({ sessions });
 * }
 * ```
 */
export declare function success<T>(data: T, meta?: ApiResponseMeta): ApiSuccessResponse<T>;
/**
 * 构建错误响应对象。用于 Controller 方法直接 return。
 *
 * 注意：调用方需自行设置 ctx.response.statusCode，因为框架
 * 不会从返回值推断 HTTP 状态码。
 *
 * @example
 * ```typescript
 * ctx.response.statusCode = 404;
 * return error(ApiErrorCode.SESSION_NOT_FOUND, 'Session not found');
 * ```
 */
export declare function error(code: string, message: string, details?: unknown): ApiErrorResponse;
/**
 * 发送成功 JSON 响应并结束请求。
 * 用于需要手动控制响应的场景（如认证检查失败后提前终止）。
 */
export declare function sendData(ctx: Context, data: unknown, meta?: ApiResponseMeta): void;
/**
 * 发送 201 Created 响应。
 */
export declare function sendCreated(ctx: Context, data: unknown): void;
/**
 * 发送 202 Accepted 响应（异步操作已接受）。
 */
export declare function sendAccepted(ctx: Context, data: unknown): void;
/**
 * 发送 204 No Content 响应。
 */
export declare function sendNoContent(ctx: Context): void;
/**
 * 发送错误 JSON 响应并结束请求。
 */
export declare function sendError(ctx: Context, statusCode: number, code: string, message: string, details?: unknown): void;
/**
 * 长连接（SSE / 流式）响应在客户端断开时回调，最多调用一次。
 *
 * 不能监听 `ctx.request` 的 'close'：Node 16+ 中请求体读完后 IncomingMessage
 * 就已 destroyed，它的 'close' 在进入 handler 前早已触发，之后注册的监听永远
 * 不会被调用，断开后定时器、订阅和文件 watcher 会一直泄漏。ServerResponse 的
 * 'close' 在底层连接关闭（或响应结束）时触发，才是连接生命周期的正确信号。
 */
export declare function onResponseClose(ctx: Context, callback: () => void): void;
