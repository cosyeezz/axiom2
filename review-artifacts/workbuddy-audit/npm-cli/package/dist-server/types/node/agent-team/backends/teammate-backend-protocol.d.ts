/**
 * TeammateBackend 抽象层协议定义
 *
 * 定义 teammate 执行后端的统一接口，支持多种运行模式：
 * - in-process: 同进程执行（默认，现有行为）
 * - detached-process: 独立 cbc 进程
 * - tmux: 独立进程 + tmux 可视化
 */
import type { Session } from '../../../vendor/cbc-core/node/index.js';
import type { AgentTask } from '../../agent-task';
export declare const TeammateBackendRegistry: unique symbol;
export type TeammateBackendType = 'in-process' | 'detached-process' | 'tmux';
export interface TeammateSpawnConfig {
    /** Teammate 名称 */
    name: string;
    /** 所属 team 名称 */
    teamName: string;
    /** 初始 prompt */
    prompt: string;
    /** Agent 类型 (e.g. "general-purpose") */
    agentType: string;
    /**
     * 主模式（站立 agent：cli / ptc / minimal / create / 自定义 mainAgent 预设）。
     * 与 `agentType` 不是一回事：那个是子代理预设，这个是 leader 当前所在的模式 ——
     * teammate 要按它跑（工具面 / Code Mode 一致，issue #127405 · P1）。
     * 缺省 = 不注入，跟随 teammate 自身默认。
     */
    agent?: string;
    /** 工作目录 */
    cwd: string;
    /** Leader 的主 session（in-process 模式需要） */
    mainSession: Session;
    /** Leader session id，供子进程建立 trace parent 关系 */
    parentSessionId?: string;
    /** Agent tool call in the direct parent that created this child session. */
    parentToolUseId?: string;
    /** 模型 */
    model?: string;
    /** 权限模式 */
    permissionMode?: string;
    /** 主 Session 已锁定隐私数据 */
    privateDataSticky?: true;
    /** 最大轮数 */
    maxTurns?: number;
    /** Leader 的 HTTP endpoint（用于 Permission Bridge） */
    leaderEndpoint?: string;
    /** 颜色 */
    color?: string;
    /** 当前 team 中的成员索引（用于颜色分配） */
    memberIndex?: number;
    /** 任务描述（展示用） */
    taskDescription?: string;
    /** 跳过 prompt 的 <teammate-message> 包装 */
    skipPromptWrapping?: boolean;
    /** 当前 team 的其他成员名称列表 */
    teamMembers?: string[];
}
export interface TeammateSpawnResult {
    success: boolean;
    /** 后端分配的唯一标识（taskId / PID / paneId） */
    backendId: string;
    /** Agent ID (格式: {name}@{teamName}) */
    agentId: string;
    /** 后端类型 */
    backendType: TeammateBackendType;
    /** 错误信息 */
    error?: string;
    /** 日志文件路径（独立进程模式） */
    logPath?: string;
    /** tmux pane ID（tmux 模式） */
    tmuxPaneId?: string;
    /** 进程 PID（独立进程模式） */
    pid?: number;
    /** AgentTask 实例（in-process 模式） */
    agentTask?: AgentTask;
}
/**
 * Teammate 执行后端统一接口。
 *
 * 每种后端负责 teammate 的创建、通信、终止和存活检查。
 * 所有后端统一使用文件 mailbox 进行消息通信。
 */
export interface ITeammateBackend {
    /** 后端类型标识 */
    readonly type: TeammateBackendType;
    /**
     * 检查后端是否可用。
     * - in-process: 默认可用，可通过环境变量禁用
     * - detached-process: 始终可用
     * - tmux: 需要 tmux 已安装且非 Windows
     */
    isAvailable(): Promise<boolean>;
    /**
     * 创建并启动 teammate。
     */
    spawn(config: TeammateSpawnConfig): Promise<TeammateSpawnResult>;
    /**
     * 强制终止 teammate。
     * - in-process: AbortController.abort()
     * - detached-process: SIGTERM → SIGKILL
     * - tmux: kill-pane
     */
    kill(backendId: string): Promise<boolean>;
    /**
     * 检查 teammate 是否存活。
     */
    isAlive(backendId: string): Promise<boolean>;
}
/**
 * 管理和选择 teammate 执行后端。
 */
export interface ITeammateBackendRegistry {
    /**
     * 获取指定类型的后端，如果不可用则 fallback 到默认。
     */
    getBackend(preferredType?: TeammateBackendType): Promise<ITeammateBackend>;
    /**
     * 获取所有已注册的后端。
     */
    getAllBackends(): ITeammateBackend[];
}
