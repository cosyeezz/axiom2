import { type Key } from 'ink';
export interface NormalizedKeyMap extends Key {
    home: boolean;
    end: boolean;
}
/**
 * 控制字符常量
 */
export declare enum ControlChar {
    ESC = "\u001B",
    BACKSPACE = "\b",
    DELETE = "",
    CARRIAGE_RETURN = "\r",
    LINE_FEED = "\n",
    TAB = "\t",
    SPACE = " ",
    CTRL_W = "\u0017",
    CTRL_A = "\u0001",
    CTRL_Z = "\u001A"
}
/**
 * ANSI 转义序列前缀
 */
export declare enum AnsiPrefix {
    CSI = "\u001B[",// Control Sequence Introducer
    SS3 = "\u001BO"
}
/**
 * Bracketed Paste 模式标记
 */
export declare enum PasteMode {
    START = "\u001B[200~",
    END = "\u001B[201~",
    ENABLE = "\u001B[?2004h",
    DISABLE = "\u001B[?2004l"
}
/**
 * 按键名称常量
 */
export declare enum KeyName {
    UP = "up",
    DOWN = "down",
    LEFT = "left",
    RIGHT = "right",
    HOME = "home",
    END = "end",
    PAGEUP = "pageup",
    PAGEDOWN = "pagedown",
    INSERT = "insert",
    DELETE = "delete",
    BACKSPACE = "backspace",
    TAB = "tab",
    RETURN = "return",
    ENTER = "enter",
    ESCAPE = "escape",
    SPACE = "space",
    CLEAR = "clear",
    NUMBER = "number",
    F1 = "f1",
    F2 = "f2",
    F3 = "f3",
    F4 = "f4",
    F5 = "f5",
    F6 = "f6",
    F7 = "f7",
    F8 = "f8",
    F9 = "f9",
    F10 = "f10",
    F11 = "f11",
    F12 = "f12"
}
/**
 * ANSI 转义序列代码
 */
export declare enum AnsiCode {
    UP_ARROW = "[A",
    DOWN_ARROW = "[B",
    RIGHT_ARROW = "[C",
    LEFT_ARROW = "[D",
    HOME_CSI = "[H",
    END_CSI = "[F",
    HOME_SS3 = "OH",
    END_SS3 = "OF",
    F1_SS3 = "OP",
    F2_SS3 = "OQ",
    F3_SS3 = "OR",
    F4_SS3 = "OS",
    DELETE = "[3~",
    INSERT = "[2~",
    PAGEUP = "[5~",
    PAGEDOWN = "[6~",
    SHIFT_TAB = "[Z",
    MAC_OPTION_LEFT = "\u001Bb",
    MAC_OPTION_RIGHT = "\u001Bf"
}
/**
 * 标准化的修饰键
 */
export interface NormalizedModifiers {
    ctrl: boolean;
    alt: boolean;
    meta: boolean;
    shift: boolean;
}
/**
 * 标准化的按键信息
 */
export interface NormalizedKey {
    name: string;
    modifiers: NormalizedModifiers;
    sequence: string;
    raw: string;
}
/**
 * 特殊按键映射
 */
export interface KeyMapping {
    pattern: RegExp;
    handler: (input: string) => {
        keyName: string;
        modifiers: Partial<NormalizedModifiers>;
    };
}
/**
 * CSI 序列完整性检测
 */
export declare function isCompleteCSI(input: string): boolean;
/**
 * 判断是否为完整的 SS3 (O) 序列
 */
export declare function isCompleteOSeq(input: string): boolean;
/**
 * 判断是否为单独的 ESC
 */
export declare function isSingleEsc(input: string): boolean;
/**
 * 判断是否为 ESC + 单字符的 Meta/Alt 序列（完整）
 */
export declare function isEscMetaChar(input: string): boolean;
/**
 * 输入类型枚举
 */
export declare enum InputType {
    PASTE_START = "paste_start",// Bracketed paste 开始
    PASTE_END = "paste_end",// Bracketed paste 结束
    PASTE_CONTENT = "paste_content",// 粘贴内容中
    ESCAPE_SEQUENCE = "escape_sequence",// 转义序列（可能不完整）
    BLOCKED_KEY = "blocked_key",// 需要屏蔽的按键
    SPECIAL_HANDLED_KEY = "special_handled_key",// 需要特殊处理的按键
    SPECIAL_KEY = "special_key",// 特殊按键
    NORMAL_TEXT = "normal_text"
}
/**
 * 输入分类结果
 */
export interface InputClassification {
    type: InputType;
    needsBuffer: boolean;
    shouldBlock: boolean;
    isComplete: boolean;
}
/**
 * 快捷键枚举 - 所有支持的快捷键名称
 */
export declare enum ShortcutKeyName {
    SHIFT_TAB = "SHIFT_TAB"
}
/**
 * 快捷键数组定义（单一源头）
 */
export declare const SHORTCUT_KEY_ARRAYS: Record<ShortcutKeyName, {
    mac: string[];
    windows: string[];
}>;
export declare abstract class KeyboardUtils {
    private static readonly metaKeyCodeRe;
    private static readonly fnKeyRe;
    /** Kitty CSI u 捕获正则（提取 codepoint 和 modifier） */
    private static readonly kittyKeyRe;
    private static readonly platform;
    /**
     * 获取默认的 Ink Key 映射对象
     */
    static getDefaultKeyMap(): NormalizedKeyMap;
    /**
     * 解析按键输入，返回标准化的按键信息
     */
    static parseKeypress(s?: string | Buffer): NormalizedKey;
    /**
     * 将 NormalizedKey 转换为 Ink 的 Key 格式
     */
    static toInkKey(normalized: NormalizedKey): {
        input: string;
        key: NormalizedKeyMap;
    };
    /**
     * 获取需要屏蔽的按键序列
     */
    static getBlockedKeyPatterns(): RegExp[];
    /**
     * 获取特殊按键序列
     */
    static getSpecialKeyPatterns(): RegExp[];
    /**
     * 获取需要特殊处理但不完全屏蔽的按键序列
     */
    static getSpecialHandledPatterns(): RegExp[];
    /**
     * 获取特殊按键映射表
     */
    static getSpecialKeyMappings(): KeyMapping[];
    /**
     * 是否为 Shift 键序列
     */
    static isShiftKey(code: string): boolean;
    /**
     * 是否为 Ctrl 键序列
     */
    static isCtrlKey(code: string): boolean;
    /**
     * 分类输入类型（用于决定如何处理）
     */
    static classifyInput(input: string, pasteActive?: boolean): InputClassification;
    /**
     * 处理特殊按键，返回标准化的结果
     */
    static handleSpecialKey(input: string): {
        input: string;
        key: NormalizedKeyMap;
    } | null;
    /**
     * 动态检测终端是否支持 bracketed paste
     * 通过发送测试序列并检查响应来判断
     */
    static canDetectBracketedPasteSupport(): boolean;
    /**
     * 检查是否应该启用 bracketed paste 模式
     */
    static shouldEnableBracketedPaste(): boolean;
    /**
     * 启用 bracketed paste 模式
     */
    static enableBracketedPaste(): void;
    /**
     * 禁用 bracketed paste 模式
     */
    static disableBracketedPaste(): void;
    /**
     * 获取快捷键的显示文本
     */
    static getShortcutLabel(shortcutKey: ShortcutKeyName): string;
    /**
     * 获取快捷键的数组形式（用于 confirm-box 等组件）
     */
    static getShortcutKeyArray(shortcutKey: ShortcutKeyName): string[];
}
