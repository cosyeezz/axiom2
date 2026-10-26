/**
 * 宿主进程的"CLI 启动目录"（`--serve` cwd）。
 *
 * 默认 Agent（主对话）的家目录 = 它，但档案只在首次 bootstrap 时记过一次，之后换目录
 * 启动不会更新 —— 读快照 / 建人回落要用这里投影回真实启动目录（见 GET
 * /api/v1/agent-home 与 resolveColleagueHomeCwd）。同事 job 进程的 cwd 是同事自己的
 * 家目录，返回 undefined 让调用方跳过。job 身份既认 claim 之后的模块态，也兜底认环境
 * 变量（claim 之前读到这里也能认出）。
 */
export declare function currentHostWorkDir(): string | undefined;
