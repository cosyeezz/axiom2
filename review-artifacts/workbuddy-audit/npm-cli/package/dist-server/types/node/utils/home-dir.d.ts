/**
 * CLI 用户级数据目录的唯一解析实现，由 {@link PathUtils.getHomeDir} 委托调用。
 * 本模块只允许轻量依赖：安全审计日志等需在独立子进程中直接加载的模块也依赖它，
 * 引入 path-utils 的依赖链会导致这类子进程加载失败。
 */
export declare function resolveCliHomeDir(): string;
