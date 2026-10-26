/**
 * respawn / crash 续跑共用的 argv 处理。
 *
 * 单独成文件、不依赖 subprocess 等重模块：轻量 broker 入口（job-broker-entry）
 * 也要用它构造 `--resume` 参数，不能为此把 agent-view-actions 整条依赖拖进去。
 */
/** respawn 时必须丢掉的 flag —— 重放它们会让子进程再 fork 一层；
 * `--fork-session` 是旧版 fork job 记录的残留，重放会让重启的副本
 * 又 fork 出一个新 session id，彻底脱离自己的 transcript */
export declare const RESPAWN_DROP_FLAGS: Set<string>;
/** 去掉位置参数，只留 `--flag` 与它们的值 */
export declare function stripPositionalArgs(args: readonly string[]): string[];
