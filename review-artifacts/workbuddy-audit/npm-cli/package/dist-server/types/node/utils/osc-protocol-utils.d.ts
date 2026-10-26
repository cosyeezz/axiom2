import { TerminalType } from './terminal-detector-utils';
/**
 * OSC 通知协议接口
 */
export interface OscNotificationProtocol {
    name: string;
    supportedTerminals: TerminalType[];
    priority: number;
    generate(message: string, title?: string): string;
}
/**
 * OSC 进度协议接口
 */
export interface OscProgressProtocol {
    name: string;
    supportedTerminals: TerminalType[];
    priority: number;
    generate(state: ProgressState, percentage: number): string;
}
/**
 * 进度状态枚举
 * 用于 OSC 9;4 进度协议
 */
export declare enum ProgressState {
    CLEAR = 0,// 清除进度
    NORMAL = 1,// 正常进度
    ERROR = 2,// 错误状态
    INDETERMINATE = 3,// 不确定进度
    PAUSED = 4
}
/**
 * OSC 协议工具类
 * 提供各种 OSC (Operating System Command) 序列的生成和管理
 */
export declare abstract class OscProtocolUtils {
    private static readonly ESC;
    private static readonly BEL;
    private static readonly ST;
    private static readonly DCS;
    /**
     * 生成 OSC 777 通知序列 (推荐，广泛支持)
     * 格式: ESC ] 777 ; notify ; title ; message BEL
     *
     * 支持终端: Ghostty, iTerm2, Windows Terminal, VSCode, Cursor, Windsurf,
     *           Foot, Contour, urxvt, Blink Shell, libvte-based
     *
     * @param title 通知标题
     * @param message 通知消息
     * @returns OSC 777 序列
     */
    static generateOSC777(title: string, message: string): string;
    /**
     * 生成 OSC 9 通知序列 (兼容性好)
     * 格式: ESC ] 9 ; message BEL
     *
     * 支持终端: iTerm2, Kitty, Ghostty, Foot, libvte-based
     *
     * 注意: 与 ConEmu 的 OSC 9;4 进度报告有冲突
     *
     * @param message 通知消息
     * @returns OSC 9 序列
     */
    static generateOSC9(message: string): string;
    /**
     * 生成 OSC 99 通知序列 (Kitty 专有)
     * 格式: ESC ] 99 ; [metadata] ; payload ST
     *
     * 支持终端: Kitty (v0.36.0+)
     *
     * 特性:
     * - 支持通知更新 (通过相同的通知 ID)
     * - 支持通知关闭事件回调
     * - 适合进度报告
     *
     * @param message 通知消息
     * @param id 可选的通知 ID，用于更新同一通知
     * @returns OSC 99 序列
     */
    static generateOSC99(message: string, id?: string): string;
    /**
     * 生成 BEL 字符 (通用 fallback)
     * 最基础的终端响铃，所有终端都支持
     *
     * @returns BEL 字符
     */
    static generateBEL(): string;
    /**
     * 生成 OSC 9;4 进度序列
     * 格式: ESC ] 9 ; 4 ; state ; percentage BEL
     *
     * 支持终端: Windows Terminal (v1.6+), iTerm2 (v3.6.6+), Ghostty
     *
     * @param state 进度状态
     * @param percentage 进度百分比 (0-100)
     * @returns OSC 9;4 序列
     */
    static generateProgressOSC9_4(state: ProgressState, percentage?: number): string;
    /**
     * 生成 OSC 99 进度更新序列 (Kitty)
     * 使用相同 ID 更新通知来实现进度显示
     *
     * @param message 进度消息
     * @param id 通知 ID
     * @returns OSC 99 序列
     */
    static generateProgressOSC99Kitty(message: string, id: string): string;
    /**
     * 通知协议优先级列表
     * 按优先级从高到低排序
     */
    private static readonly NOTIFICATION_PROTOCOLS;
    /**
     * 根据终端类型选择最佳通知协议
     *
     * 选择策略:
     * 1. 找到支持当前终端的协议
     * 2. 按优先级排序
     * 3. 返回最高优先级的协议
     * 4. 如果没有匹配，返回 BEL fallback
     *
     * @param terminalType 终端类型
     * @returns 最佳匹配的协议
     */
    static selectNotificationProtocol(terminalType: TerminalType): OscNotificationProtocol;
    /**
     * 检测是否需要 tmux 包装
     *
     * @returns 是否在 tmux 中运行
     */
    static needsTmuxWrapping(): boolean;
    /**
     * 为 tmux 环境包装 OSC 序列
     *
     * tmux 会拦截 OSC 序列，需要使用 DCS tmux 透传协议
     * 格式: DCS tmux ; <escaped-sequence> ST
     *
     * 注意: ESC 字符需要双写以进行转义
     *
     * @param oscSequence 原始 OSC 序列
     * @returns tmux 包装后的序列
     */
    static wrapForTmux(oscSequence: string): string;
    static writeToTerminal(sequence: string): void;
    /**
     * 进度协议优先级列表
     * 按优先级从高到低排序
     */
    private static readonly PROGRESS_PROTOCOLS;
    /**
     * 根据终端类型选择最佳进度协议
     *
     * @param terminalType 终端类型
     * @returns 最佳匹配的进度协议，如果不支持则返回 null
     */
    static selectProgressProtocol(terminalType: TerminalType): OscProgressProtocol | null;
    /**
     * 生成进度 OSC 序列（自动选择协议）
     *
     * @param terminalType 终端类型
     * @param state 进度状态
     * @param percentage 进度百分比 (0-100)
     * @returns OSC 序列，如果终端不支持则返回 null
     */
    static generateProgress(terminalType: TerminalType, state: ProgressState, percentage?: number): string | null;
    static supportsProgressProtocol(terminalType: TerminalType): boolean;
    /**
     * 生成 OSC 52 剪贴板序列
     * 格式: ESC ] 52 ; c ; <base64-data> BEL
     *
     * OSC 52 是一种终端转义序列，允许程序设置或获取系统剪贴板内容。
     * 它特别适用于 SSH 远程会话，因为数据通过终端转义序列传递到本地终端，
     * 从而绕过了远程系统无法直接访问本地剪贴板的限制。
     *
     * 支持终端: iTerm2, Ghostty, Kitty, Alacritty, WezTerm, Windows Terminal,
     *           VSCode 集成终端, Cursor, Windsurf, GNOME Terminal, Konsole, XTerm 等
     *
     * @param text 要复制到剪贴板的文本
     * @returns OSC 52 序列
     */
    static generateOSC52(text: string): string;
    /**
     * 生成带 tmux 包装的 OSC 52 序列
     * 在 tmux 环境中，需要使用 DCS 透传协议
     *
     * @param text 要复制到剪贴板的文本
     * @returns 适当包装的 OSC 52 序列
     */
    static generateOSC52WithTmuxSupport(text: string): string;
    /**
     * 检查当前终端是否支持 OSC 52 协议
     *
     * @returns 是否支持 OSC 52
     */
    static supportsOSC52(): boolean;
    /**
     * 检测是否在 SSH 会话中
     *
     * @returns 是否在 SSH 会话中
     */
    static isSSHSession(): boolean;
    /**
     * 通过 OSC 52 协议复制文本到剪贴板
     * 适用于 SSH 远程环境和支持 OSC 52 的本地终端
     *
     * @param text 要复制的文本
     * @returns 是否成功写入（注意：这只表示序列已发送，不保证终端支持）
     */
    static copyToClipboardViaOSC52(text: string): boolean;
}
