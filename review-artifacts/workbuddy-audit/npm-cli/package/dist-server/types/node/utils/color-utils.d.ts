/**
 * RGB 颜色对象接口
 */
interface RGB {
    r: number;
    g: number;
    b: number;
}
export declare abstract class ColorUtils {
    /**
     * 判断是否为暗色主题
     */
    private static isDarkTheme;
    /**
     * 根据背景色返回合适的文字颜色（TypeScript版）
     * @param color - 背景颜色，支持格式：hex、rgb、rgba、hsl、颜色名称
     * @returns 返回的文字颜色（'#ffffff' 或 '#000000'），转换失败时返回undefined
     */
    static getTextColor(color: string, name?: string): string | undefined;
    /**
     * 将hex颜色转换为RGB对象
     */
    static hexToRgb(hex: string): RGB | undefined;
    /**
     * 将HSL颜色转换为RGB对象
     */
    static hslToRgb(h: number, s: number, l: number): RGB;
    /**
     * 颜色名称转换为hex（支持常见颜色）
     */
    static colorNameToHex(colorName: string): string | undefined;
    /**
     * 根据名称生成背景颜色，根据当前主题调整色值范围
     */
    static generateColorFromName(name?: string): string | undefined;
}
export {};
