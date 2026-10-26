/**
 * 库运行时判定：本进程把内核当**进程内库**使用（@tencent-ai/agent-cli/server
 * 出口），进程、console、argv、信号与进程全局都归宿主所有——内核不得接管。
 *
 * 标记由 server entry 的 flag.ts 在装载最先置位（flag 零 import 纪律，故那边
 * 直写 env 字面量，与本常量保持一致）。内核代码一律经本谓词消费，不散读 env。
 */
export declare const LIBRARY_RUNTIME_ENV = "CODEBUDDY_LIBRARY_RUNTIME";
export declare function isLibraryRuntime(): boolean;
