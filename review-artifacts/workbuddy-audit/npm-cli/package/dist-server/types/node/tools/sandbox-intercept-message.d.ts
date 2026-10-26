import type { ShellResult } from '../shell';
type SandboxInterceptResult = Pick<ShellResult, 'fileBlockRecords' | 'networkBlockRecords'>;
/** 组合普通文件/网络拦截与程序黑名单提示，保持各安全域实现相互独立。 */
export declare function formatSandboxInterceptMessage(result: SandboxInterceptResult): string;
/** 仅组合必须阻止模型继续重试的程序黑名单与网络安全提示。 */
export declare function formatBlockingSandboxInterceptMessage(result: SandboxInterceptResult): string;
/**
 * `ShellResult.denialMessage` 已逐条给出终局拒绝原因时的补充提示。
 *
 * 与 {@link formatBlockingSandboxInterceptMessage} 只差一处：排除普通网络拦截记录。
 * 那些记录已被 denialMessage 涵盖，再经 `formatSandboxNetworkInterceptMessage` 标一遍
 * `Sandbox Intercept Info (non-blocking)` 会与权威口径矛盾。恶意网站库命中与程序
 * 黑名单超出 denialMessage 的表达范围（前者要给白名单指引，后者要阻止换 shell 重试），
 * 必须保留。
 *
 * 网络严格模式的拦截（genie/genie#122764）同属必须保留类：它不是「命中某条规则」，
 * 而是「程序绕过了代理」——denialMessage 表达不了这层成因，须由本函数陈述该事实。
 */
export declare function formatCriticalSandboxInterceptMessage(result: SandboxInterceptResult): string;
interface BackgroundOutputBuffer {
    push(chunk: string): void;
}
/** 将必须阻止模型重试的沙箱提示写入后台任务输出。 */
export declare function pushBlockingSandboxInterceptToBackgroundOutput(buffer: BackgroundOutputBuffer, result: SandboxInterceptResult): void;
export {};
