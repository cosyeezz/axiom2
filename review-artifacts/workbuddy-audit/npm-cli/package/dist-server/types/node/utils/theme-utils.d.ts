/**
 * 主题工具类 - 统一的颜色应用接口
 *
 * 设计原则:
 * 1. 所有颜色通过 ChalkFactory.getChalk() 应用，信任 chalk 内建降级
 * 2. 不做手动颜色降级 - chalk 会根据终端 level 自动处理
 * 3. 提供完整的语义化 API 覆盖所有 Theme 颜色属性
 * 4. 5 层错误容错: 空值→原文本，无效格式→原文本，regex 失败→原文本
 */
export declare abstract class ThemeUtils {
    private static getThemeColors;
    /**
     * 将主题颜色值应用到 chalk
     * 支持以下格式:
     * - chalk 颜色名: 'red', 'greenBright', 'gray' 等
     * - Hex: '#28B894'
     * - RGB: 'rgb(40, 184, 148)'
     * - 空字符串: 返回 identity 函数（无色）
     *
     * chalk 会根据其 level 自动降级:
     *   level 3: hex/rgb 原样输出为 truecolor ANSI 码
     *   level 2: 自动映射到最近的 256 色
     *   level 1: 自动映射到最近的 16 色
     *   level 0: 不输出任何 ANSI 码
     */
    static applyColor(color: string): (text: string | number) => string;
    /**
     * 解析 rgb 字符串为数组
     */
    private static parseRgb;
    /**
     * 应用文本修饰符
     */
    private static applyModifier;
    /**
     * 语义化颜色 API
     *
     * 每个方法对应 Theme 中的一个颜色属性，
     * 调用链: ThemeUtils.chalk.xxx(text) → getThemeColors().xxx → applyColor() → chalk.hex/rgb/name()
     */
    static get chalk(): {
        primary: (text: string | number) => string;
        secondary: (text: string | number) => string;
        text: (text: string | number) => string;
        textSecondary: (text: string | number) => string;
        brand: (text: string | number) => string;
        success: (text: string | number) => string;
        error: (text: string | number) => string;
        warning: (text: string | number) => string;
        info: (text: string | number) => string;
        disabled: (text: string | number) => string;
        thinking: (text: string | number) => string;
        debug: (text: string | number) => string;
        planMode: (text: string | number) => string;
        bashMode: (text: string | number) => string;
        delegateMode: (text: string | number) => string;
        toolName: (text: string | number) => string;
        toolResult: (text: string | number) => string;
        toolArg: (text: string | number) => string;
        codeKeyword: (text: string | number) => string;
        codeString: (text: string | number) => string;
        codeComment: (text: string | number) => string;
        codeNumber: (text: string | number) => string;
        prompt: (text: string | number) => string;
        link: (text: string | number) => string;
        hint: (text: string | number) => string;
        spinner: (text: string | number) => string;
        progressBar: (text: string | number) => string;
        badge: (text: string | number) => string;
        counter: (text: string | number) => string;
        notificationInfo: (text: string | number) => string;
        notificationWarning: (text: string | number) => string;
        notificationError: (text: string | number) => string;
        notificationSuccess: (text: string | number) => string;
        agentName: (text: string | number) => string;
        agentBorder: (text: string | number) => string;
        permissionAllow: (text: string | number) => string;
        permissionDeny: (text: string | number) => string;
        permissionAsk: (text: string | number) => string;
        filePath: (text: string | number) => string;
        lineNumber: (text: string | number) => string;
        border: (text: string | number) => string;
        bold: (text: string | number) => string;
        italic: (text: string | number) => string;
        dim: (text: string | number) => string;
        strikethrough: (text: string | number) => string;
        underline: (text: string | number) => string;
    };
    /**
     * 获取当前 chalk level
     */
    static getChalkLevel(): number;
    /**
     * 重置缓存（用于测试）
     */
    static resetCache(): void;
}
