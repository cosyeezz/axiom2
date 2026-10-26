import { Emitter, Logger } from '@celljs/core';
import { CliProvider } from '../cli/cli-protocol';
import { CliRuntimeOptions } from '../cli/cli-runtime-options';
import { SettingsScope } from './settings-protocol';
/**
 * CLI Setting Sources Provider
 * 负责解析 --setting-sources 参数,控制 settings 的加载优先级
 */
export declare class CliSettingSourcesProvider {
    protected readonly logger: Logger;
    protected readonly cliProvider: CliProvider;
    protected readonly cliRuntimeOptions: CliRuntimeOptions;
    private readonly DEFAULT_SCOPES;
    private settingScopes;
    /**
     * scope 顺序发生实际变化时触发（典型场景：prewarm activate 重写 argv 后
     * `--setting-sources` 从默认顺序切换）。消费方（如 PluginManager）据此
     * 作废按旧 scopes 计算的缓存。
     */
    protected readonly onDidChangeEmitter: Emitter<void>;
    readonly onDidChange: import("@celljs/core").Event<void>;
    private deferred;
    /**
     * 加载串行队列：与 CliSettingsProvider 同理，保证首轮加载与后续 reload
     * 不并发交错写 `settingScopes`。
     */
    private loadChain;
    init(): void;
    /**
     * 执行一次解析：从 argv 构建 scope 顺序 → 原子替换。首轮负责 resolve deferred。
     * 非首轮且顺序实际变化时 fire onDidChange，让下游作废旧 scopes 的缓存。
     */
    private runLoad;
    /**
     * 获取要加载的 setting scopes (不包含 CLI scope)
     * CLI scope 总是最后加载,优先级最高
     */
    getSettingScopes(): Promise<SettingsScope[]>;
    /** Wait for all CLI-options reloads queued so far to commit. */
    waitUntilSettled(): Promise<void>;
    /**
     * 判断某个 scope 的配置是否允许被读取（`--setting-sources` 的统一裁决点，
     * 与 MCP 侧 shouldLoadFromFilesystem 同语义）：
     * - 文件系统 scope（user/project/local）：仅当出现在 `--setting-sources` 里
     * - CLI scope：来自 `--settings` 显式注入，恒允许
     */
    isScopeAllowed(scope: SettingsScope): Promise<boolean>;
    /**
     * 从当前 `process.argv` 解析 `--setting-sources`，返回一个**全新**的 scope
     * 顺序数组（不触碰 `this.settingScopes`，由 runLoad 原子替换）。
     *
     * 预热（prewarm）场景：standby 阶段首轮解析不到真实 `--setting-sources`，
     * 返回默认顺序；activate set() 触发的再次解析读到重写后的真实 argv。
     *
     * 语义：未指定 / 非法值 → 回退默认顺序（不残留上一轮 CLI 指定的顺序）。
     */
    private buildSettingScopes;
    /**
     * 解析 sources 字符串
     * 支持逗号或空格分隔: "user,project,local" 或 "user project local"
     * 支持 'none' 表示不加载任何配置（返回空数组）
     */
    private parseSourcesString;
    /**
     * 将字符串映射到 SettingsScope
     */
    private mapToScope;
    /**
     * 将 SettingsScope 转换为字符串(用于日志)
     */
    private scopeToString;
}
