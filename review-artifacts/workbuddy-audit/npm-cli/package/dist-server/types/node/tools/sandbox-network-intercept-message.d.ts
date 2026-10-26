import type { ShellResult } from '../shell';
/**
 * 把非审批型的沙箱拦截记录转成给模型的结构化提示。
 *
 * 恶意网站不能沿用普通的“non-blocking”文案：模型必须明确知道
 * 访问已被拒绝、不应重试，以及唯一的放行方式是由用户加入安全中心白名单。
 * 其他文件/网络拦截保持原有文案，避免改变现有重试和审批语义。
 */
export declare function formatSandboxNetworkInterceptMessage(result: Pick<ShellResult, 'fileBlockRecords' | 'networkBlockRecords'>): string;
/** 后台任务的 stderr 汇聚缓冲，命令结束后可能已关闭。 */
interface BackgroundOutputBuffer {
    push(chunk: string): void;
}
/**
 * 把网络拦截提示写进后台任务输出。Bash 与 PowerShell 共用一份。
 *
 * 后台路径不走前台的结果拼装，只翻任务状态；脚本吞掉请求失败并以 0 退出时状态就是
 * completed，模型用 TaskOutput 追结果时会把这次执行当成完全成功，转头继续访问同一个
 * 恶意域名。所以这里必须显式写一条，且只渲染网络记录——文件拦截由各自的
 * sandbox_denied 分支输出，重复渲染会让模型看到两遍。
 *
 * 缓冲关闭属于正常收尾竞态，吞掉即可：写不进提示也不该让任务完成流程失败。
 */
export declare function pushNetworkInterceptToBackgroundOutput(buffer: BackgroundOutputBuffer, networkBlockRecords: ShellResult['networkBlockRecords']): void;
export {};
