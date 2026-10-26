/**
 * WeCom AI Bot QR bind — same pairing page as @wecom/wecom-openclaw-cli.
 *
 * 不依赖那个 CLI 包：它的 scanQRCodeForBotInfo 会在超时后 process.exit。
 * 出码 / 轮询协议与 dist/utils/qrcode.js 一致。
 *
 * 1. GET /ai/qc/generate?source=wecom-cli&plat= → { scode, auth_url }
 * 2. 把 auth_url 画成二维码，企业微信扫开后一键建机器人
 * 3. GET /ai/qc/query_result?scode= → success 时回传 botid / secret
 */
import type { QRAuthStatus } from '../../remote-control-protocol';
import type { WecomBotCredentials } from './wecom-bot-auth';
export declare const WECOM_QR_BIND_ORIGIN = "https://work.weixin.qq.com";
/** 企微给 OpenClaw CLI 开的配对来源；换 source 会出不了码。 */
export declare const WECOM_QR_BIND_SOURCE = "wecom-cli";
export declare const WECOM_QR_BIND_POLL_INTERVAL_MS = 3000;
export declare const WECOM_QR_BIND_TIMEOUT_MS: number;
export interface WecomQrBindSession {
    scode: string;
    authUrl: string;
}
export interface WecomQrBindHttp {
    (url: string): Promise<unknown>;
}
export interface WecomQrBindDeps {
    fetchJson?: WecomQrBindHttp;
    renderQr?: (url: string) => Promise<string>;
    sleep?: (ms: number) => Promise<void>;
    now?: () => number;
    platform?: NodeJS.Platform;
}
export interface PerformWecomQrBindOptions extends WecomQrBindDeps {
    onStatus: (status: QRAuthStatus) => void;
    resolveManual?: () => WecomBotCredentials | undefined;
    signal?: AbortSignal;
    timeoutMs?: number;
    pollIntervalMs?: number;
    /** generate 失败时展示的兜底文案（手填说明），不画码。 */
    manualFallbackMessage?: string;
}
export declare function wecomQrBindPlatCode(platform?: NodeJS.Platform): number;
export declare function wecomQrGenerateUrl(platform?: NodeJS.Platform): string;
export declare function wecomQrQueryUrl(scode: string): string;
export declare function wecomQrPageUrl(scode: string): string;
export declare function parseWecomQrGeneratePayload(payload: unknown): WecomQrBindSession;
export declare function parseWecomQrQueryPayload(payload: unknown): WecomBotCredentials | 'pending';
export declare function requestWecomQrBindSession(deps?: WecomQrBindDeps): Promise<WecomQrBindSession>;
export declare function queryWecomQrBindResult(scode: string, deps?: WecomQrBindDeps): Promise<WecomBotCredentials | 'pending'>;
export declare function performWecomQrBind(options: PerformWecomQrBindOptions): Promise<WecomBotCredentials | undefined>;
