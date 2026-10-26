import { Session } from '../../vendor/cbc-core/node/index.js';
import { CodeRatioReporter } from '@genie/code-ratio';
import { CodeRatioRepoResolver } from './vcs-repo-resolver';
/**
 * Service token for the CLI-side code-ratio reporting helper.
 *
 * Editor tools depend on this token instead of the raw `CodeRatioReporter`
 * so they don't need to know how to resolve VCS context, map ChangeType
 * values or swallow reporter errors. All of that lives here.
 */
export declare const CodeRatioReportingService: unique symbol;
/**
 * Minimal, CLI-friendly parameters for the edit tools' code-ratio
 * reporting hook. Tools already have these values on hand after
 * successfully applying an edit, so building the input is a one-liner.
 */
export interface EditChangeReport {
    /** Absolute path of the file that was just written / edited. */
    absoluteFilePath: string;
    /** File content before the edit (empty string for new files). */
    originalContent: string;
    /** File content after the edit. */
    newContent: string;
    /** Whether this edit created a new file (drives ChangeType). */
    isNewFile: boolean;
    /** Tool name (e.g. `Write`, `Edit`, `MultiEdit`, `NotebookEdit`). */
    toolName?: string;
    /** Tool call identifier, if available from the agent runtime. */
    toolCallId?: string;
    /** Session context, used to derive conversationId / modelId / traceId. */
    session?: Session;
}
/**
 * CLI-side code-ratio reporting helper.
 *
 * Contract: calling `reportEditChange` never throws, never blocks the
 * edit flow and never affects the tool's return value. Any failure
 * (missing reporter, non-git workspace, VCS metadata incomplete, etc.)
 * is logged at debug level and silently dropped.
 */
export interface CodeRatioReportingService {
    /**
     * Report an AI-authored file change (Write / Edit / MultiEdit /
     * NotebookEdit / NotebookWrite). Safe to call unconditionally after a
     * successful file write.
     */
    reportEditChange(report: EditChangeReport): void;
}
/**
 * Default implementation. The reporter and resolver are looked up
 * through the cell container rather than enforced through strict DI,
 * because `@genie/code-ratio` is an optional peer dependency: builds
 * that don't bundle it (or tests that don't register it) must still
 * be able to instantiate the editor tools.
 *
 * Constructor arguments exist purely for unit tests; production code
 * relies on the cell container resolution below.
 */
export declare class CodeRatioReportingServiceImpl implements CodeRatioReportingService {
    protected readonly repoResolver?: CodeRatioRepoResolver;
    private logger?;
    private reporterProvider;
    /**
     * NOTE: must remain parameter-less.
     *
     * 早期版本曾把 unit-test overrides 通过构造函数对象参数注入，触发了一个
     * 隐蔽的 cell/inversify bug：`@Component` 装饰会让 TS emit
     * `design:paramtypes` 元数据，把 `overrides?: { ... }` 的对象类型擦成
     * `Object`；cell 容器实例化时会按 paramtypes 在容器里查找 `Object` 的
     * 绑定，由于不存在，统一抛出
     *   "No matching bindings found for serviceIdentifier: Object"
     * 该错误从 ApplicationLifecycle 一路冒泡，导致整个 CLI 启动失败。
     *
     * 修复：constructor 改为无参，单测改用 {@link configureForTesting}
     * 注入测试桩，从而**完全不让 paramtypes 元数据被生成**。
     */
    constructor();
    /**
     * Test-only seam. Production code must not call this.
     *
     * 不通过 constructor 注入是为了避免 cell 装饰器生成 `design:paramtypes`
     * 元数据，把测试用的 overrides 对象类型当成 IoC 依赖（详见 constructor
     * 注释里的 bug 历史）。
     */
    configureForTesting(overrides: {
        repoResolver?: CodeRatioRepoResolver;
        reporterProvider?: () => CodeRatioReporter | undefined;
    }): void;
    reportEditChange(report: EditChangeReport): void;
}
