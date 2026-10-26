export declare enum TerminalType {
    CURSOR = "cursor",
    WINDSURF = "windsurf",
    CODIUM = "codium",
    VSCODE = "vscode",
    ZED = "zed",
    ANDROIDSTUDIO = "androidstudio",
    VISUALSTUDIO = "visualstudio",
    PYCHARM = "pycharm",
    INTELLIJ_IDEA = "intellij",
    WEBSTORM = "webstorm",
    PHPSTORM = "phpstorm",
    GOLAND = "goland",
    RIDER = "rider",
    CLION = "clion",
    RUBYMINE = "rubymine",
    APPCODE = "appcode",
    DATAGRIP = "datagrip",
    JETBRAINS = "jetbrains",
    CODEBUDDY = "codebuddy",
    CODEBUDDY_CN = "codebuddy_cn",
    ITERM = "iTerm.app",
    ITERM_LEGACY = "iTerm",// 旧版 iTerm 的 TERM_PROGRAM 值
    APPLE_TERMINAL = "Apple_Terminal",
    GHOSTTY = "ghostty",
    KITTY = "kitty",
    ALACRITTY = "alacritty",
    WEZTERM = "WezTerm",
    HYPER = "Hyper",
    TABBY = "Tabby",
    WARP = "warp",
    KONSOLE = "konsole",
    GNOME_TERMINAL = "gnome-terminal",
    XTERM = "xterm",
    VTE_BASED = "vte-based",
    TERMINATOR = "terminator",
    TILIX = "tilix",
    RXVT = "rxvt",
    TERMITE = "termite",
    WINDOWS_TERMINAL = "windows-terminal",
    POWERSHELL = "powershell",
    CONEMU = "conemu",
    CYGWIN = "cygwin",
    SCREEN = "screen",
    TMUX = "tmux",
    SSH_SESSION = "ssh-session",
    NON_INTERACTIVE = "non-interactive",
    UNKNOWN = "unknown"
}
export declare abstract class TerminalDetectorUtils {
    /**
     * Detect the current terminal type
     * Returns a string identifier for the terminal, or undefined if detection fails
     */
    static detect(): string | undefined;
    /**
     * Detect the current terminal and return it as a TerminalType enum value
     * Returns TerminalType.UNKNOWN if the terminal cannot be determined
     */
    static detectAsType(): TerminalType;
    static isSupported(): boolean;
    static getSetupDescription(): string;
    /**
     * Get a human-readable terminal name
     */
    static getTerminalName(): string;
    /**
     * 获取当前终端的换行快捷键提示
     * @param includeSetupHint 是否包含 /terminal-setup 提示
     * @returns 换行快捷键的描述文本
     */
    static getNewlineKeyBindingTip(includeSetupHint?: boolean): string;
    /**
     * 获取短版本的换行快捷键（不带提示）
     * @returns 快捷键名称，如 "Shift + Enter" 或 "Option + Enter"
     */
    static getNewlineKeyBinding(): string;
}
