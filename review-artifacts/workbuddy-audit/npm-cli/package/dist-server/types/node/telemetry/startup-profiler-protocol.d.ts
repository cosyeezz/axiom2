/**
 * 启动阶段定义
 */
export declare enum StartupPhase {
    PROCESS_START = "process_start",
    SHIM_LOAD = "shim_load",
    MODULE_LOAD = "module_load",
    DI_CONTAINER_INIT = "di_container_init",
    POST_CONSTRUCT = "post_construct",
    SETTINGS_LOAD = "settings_load",
    MEMORY_LOAD = "memory_load",
    PLUGIN_LOAD = "plugin_load",
    MARKETPLACE_LOAD = "marketplace_load",
    MCP_CONFIG_LOAD = "mcp_config_load",
    MCP_SERVER_CONNECT = "mcp_server_connect",
    TOOL_REGISTER = "tool_register",
    AUTH_INIT = "auth_init",
    CLI_PARSE = "cli_parse",
    STDIN_READ = "stdin_read",
    AUTH_WAIT = "auth_wait",
    RUNNER_INIT = "runner_init",
    AGENT_INTERCEPTORS = "agent_interceptors",
    AGENT_LLM_CALL = "agent_llm_call",
    UI_READY = "ui_ready",
    READY = "ready"
}
/**
 * 阶段计时信息
 */
export interface PhaseTimingInfo {
    phase: StartupPhase | string;
    label: string;
    startTime: number;
    endTime?: number;
    duration?: number;
    metadata?: Record<string, unknown>;
}
/**
 * 启动性能分析报告
 */
export interface StartupProfileReport {
    processStartTime: number;
    totalDuration: number;
    phases: PhaseTimingInfo[];
    slowPhases: PhaseTimingInfo[];
    platform: string;
    nodeVersion: string;
}
export declare const StartupProfiler: unique symbol;
/**
 * 启动性能分析器接口
 */
export interface StartupProfiler {
    /**
     * 标记阶段开始
     */
    markStart(phase: StartupPhase | string, label?: string, metadata?: Record<string, unknown>): void;
    /**
     * 标记阶段结束
     */
    markEnd(phase: StartupPhase | string, metadata?: Record<string, unknown>): void;
    /**
     * 记录单次事件（无持续时间）
     */
    markEvent(phase: StartupPhase | string, label?: string, metadata?: Record<string, unknown>): void;
    /**
     * 标记 UI 就绪（始终记录，不受 enabled 影响）
     */
    markUIReady(): void;
    /**
     * 获取 UI 就绪时间（从进程启动到 UI 就绪的毫秒数）
     * 如果 UI 还未就绪，返回 undefined
     */
    getUIReadyTime(): number | undefined;
    /**
     * 包装异步函数并自动记录耗时
     */
    measure<T>(phase: StartupPhase | string, label: string, fn: () => Promise<T>): Promise<T>;
    /**
     * 获取性能分析报告
     */
    getReport(): StartupProfileReport;
    /**
     * 格式化输出性能报告
     */
    formatReport(options?: {
        showAll?: boolean;
        threshold?: number;
    }): string;
    /**
     * 获取总启动耗时
     */
    getTotalDuration(): number;
    /**
     * 检查是否启用性能分析
     */
    isEnabled(): boolean;
}
