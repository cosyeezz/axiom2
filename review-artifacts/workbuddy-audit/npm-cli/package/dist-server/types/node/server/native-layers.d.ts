/**
 * step-3 试点：组件以 Effect Service 原生注册（注册翻转首批，3 个叶子）。
 *
 * 形态（strangler 双轨）：类文件保持 @Component 不动——bin/TUI 装配零变化；
 * server 侧在此以 Layer.sync 原生构造，boot 在 Application.start() 之后把
 * celljs token rebind 到 Effect 运行时取值（nativeBridge），server 进程内的
 * 实例真源从容器翻转到 Effect Layer。
 *
 * 选点判据（服务级 census，2026-08-21）：真实使用（599 实例化集）、零
 * @Autowired、单 token、单例、无 AOP/named/tagged。时序判据：有状态的
 * FileRollbackOperationLock 全部消费方为 verb 期构造（rebind 之后），无
 * split-brain；两个无状态服务的 boot 期早消费方持容器实例无害。
 *
 * 求值序纪律：本文件只允许被动态 import（bindServerServices / boot），
 * 不得进入 services.ts/index 的静态图——skill-product-provider TDZ 判例。
 */
import { type FileRollbackOperationLock as FileRollbackLockApi } from '../../vendor/cbc-core/node/index.js';
import { type LoggerStoragePathProvider as LoggerStoragePathApi } from '@genie/telemetry';
import { Context, Effect, Layer } from 'effect';
import { type Hook as HookApi } from '../hooks/hook-protocol';
import { type GlobMatcher as GlobMatcherApi } from '../memory/memory-protocol';
import { type SessionTitleServiceInterface as SessionTitleApi } from '../session-title/session-title-protocol';
import { type SessionSummaryService as SessionSummaryApi } from '../summary/summary-protocol';
import { Compactions, type ComponentResolver } from './services';
import { ServerTerminalPublisher } from './tool-events';
declare const GlobMatcher_base: Context.ServiceClass<GlobMatcher, "server/native/GlobMatcher", GlobMatcherApi>;
export declare class GlobMatcher extends GlobMatcher_base {
}
declare const LoggerStoragePath_base: Context.ServiceClass<LoggerStoragePath, "server/native/LoggerStoragePath", LoggerStoragePathApi>;
export declare class LoggerStoragePath extends LoggerStoragePath_base {
}
declare const FileRollbackLock_base: Context.ServiceClass<FileRollbackLock, "server/native/FileRollbackLock", FileRollbackLockApi>;
export declare class FileRollbackLock extends FileRollbackLock_base {
}
declare const FileChanges_base: Context.ServiceClass<FileChanges, "server/native/FileChanges", import("./turn-diff").ServerFileChangePublisher>;
export declare class FileChanges extends FileChanges_base {
}
declare const Terminals_base: Context.ServiceClass<Terminals, "server/native/Terminals", ServerTerminalPublisher>;
export declare class Terminals extends Terminals_base {
}
export declare const nativeLayer: Layer.Layer<Compactions | FileChanges | Terminals | GlobMatcher | LoggerStoragePath | FileRollbackLock, never, never>;
declare const ManualCompactHook_base: Context.ServiceClass<ManualCompactHook, "server/native/ManualCompactHook", HookApi>;
export declare class ManualCompactHook extends ManualCompactHook_base {
}
declare const manualCompactHookLayer: Layer.Layer<ManualCompactHook, never, never>;
declare const SessionSummary_base: Context.ServiceClass<SessionSummary, "server/native/SessionSummary", SessionSummaryApi>;
export declare class SessionSummary extends SessionSummary_base {
}
declare const sessionSummaryLayer: Layer.Layer<SessionSummary, never, never>;
declare const SummaryStopHook_base: Context.ServiceClass<SummaryStopHook, "server/native/SummaryStopHook", HookApi>;
export declare class SummaryStopHook extends SummaryStopHook_base {
}
declare const SummaryPreCompactHook_base: Context.ServiceClass<SummaryPreCompactHook, "server/native/SummaryPreCompactHook", HookApi>;
export declare class SummaryPreCompactHook extends SummaryPreCompactHook_base {
}
declare const summaryHooksLayer: Layer.Layer<SummaryStopHook | SummaryPreCompactHook, never, never>;
declare const SessionTitle_base: Context.ServiceClass<SessionTitle, "server/native/SessionTitle", SessionTitleApi>;
export declare class SessionTitle extends SessionTitle_base {
}
declare const SessionTitleHook_base: Context.ServiceClass<SessionTitleHook, "server/native/SessionTitleHook", HookApi>;
export declare class SessionTitleHook extends SessionTitleHook_base {
}
declare const sessionTitleLayer: Layer.Layer<SessionTitle, never, never>;
declare const sessionTitleHookLayer: Layer.Layer<SessionTitleHook, never, never>;
type BuiltinNativeServices = Layer.Success<typeof nativeLayer> | Layer.Success<typeof manualCompactHookLayer> | Layer.Success<typeof sessionSummaryLayer> | Layer.Success<typeof summaryHooksLayer> | Layer.Success<typeof sessionTitleLayer> | Layer.Success<typeof sessionTitleHookLayer>;
/** 反向桥清单：boot 把 celljs token rebind 到对应 Effect 程序（键本身可跑）。 */
export declare const nativeBridge: ReadonlyArray<{
    token: unknown;
    program: Effect.Effect<unknown, never, BuiltinNativeServices>;
    mode: 'rebind' | 'add';
}>;
/** 组合出口：叶子批 + 依赖批 + 家族批（services.buildRuntime 以内核层供给 R）。 */
export declare const nativeLayerAll: Layer.Layer<Compactions | FileChanges | Terminals | GlobMatcher | LoggerStoragePath | FileRollbackLock | ManualCompactHook | SessionSummary | SummaryStopHook | SummaryPreCompactHook | SessionTitle | SessionTitleHook, never, never>;
/**
 * boot 尾部 warmup：async Layer（动态 import 成员）必须在异步上下文预建——
 * celljs 同步 get 经反向桥走 runServerEffectSync，未预建的 async layer 会在
 * runSync 处炸（同步边界撞异步 import）。预建后 memoize，同步桥安全。
 */
export declare const nativeWarmup: Effect.Effect<void, never, BuiltinNativeServices>;
declare const genModuleLoaders: ({
    name: string;
    load: () => Promise<typeof import("./native/stats.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/trace.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/telemetry.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/galileo.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/agent-team.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/settings.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/memory.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/file-rollback.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/payment.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/structured-output.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/shell.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/sensitive-content.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/authentication.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/message-queue.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/notification.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/references.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/runtime.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/console.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/ask.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/output-style.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/http.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/mcp.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/tools.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/context.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/permission.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/worktree.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/hooks.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/session.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/agent.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/command.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/sandbox-cli.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/model.gen")>;
} | {
    name: string;
    load: () => Promise<typeof import("./native/bash-sandbox.gen")>;
})[];
type GeneratedModule = Awaited<ReturnType<(typeof genModuleLoaders)[number]['load']>>;
export type NativeServices = BuiltinNativeServices | Layer.Success<GeneratedModule['layer']>;
export interface AssembledNative {
    layer: Layer.Layer<NativeServices, never, ComponentResolver>;
    bridge: ReadonlyArray<{
        token: unknown;
        program: Effect.Effect<unknown, never, NativeServices>;
        mode: 'rebind' | 'add';
    }>;
    warmup: Effect.Effect<void, never, NativeServices>;
}
/**
 * hub 模式成员的 PostConstruct 延迟队列：环上成员的 init 可能触惰性 getter
 * （McpManager.initialize→syncToolsListChanged 实锤），warmup 层构建期 runSync
 * 撞异步构建墙——推迟到 warmup 效果体（层图已建成、context 已缓存）统一执行，
 * 仍先于 Application.start()。
 */
export declare const deferredPostConstructs: Array<() => void>;
/**
 * 惰性字段（两阶段 warmup 的注入形）：get=首访经桥解析；set=写穿覆盖——
 * celljs 属性注入是可写普通字段，类内 `this.x = ...`（可选依赖兜底等惯用形）
 * 在 get-only 定义下 strict TypeError（四振排查的 get-only 嫌疑判据）。
 */
export declare function lazyField(instance: object, field: string, get: () => unknown): void;
/**
 * 两阶段 warmup 的第二段收口：桥绑定 + context 缓存之后统一执行延迟
 * PostConstruct（boot 调；测试路径由 bindServerServices 直接收）。
 */
export declare function drainDeferredPostConstructs(): void;
/** 手写批 + 生成批的统一装配（幂等 memo；bindServerServices/boot 共用）。 */
export declare function assembleNative(options?: {
    skipGenerated?: boolean;
}): Promise<AssembledNative>;
export {};
