/**
 * ChalkFactory - 统一的 chalk 实例管理
 *
 * 核心职责:
 * 1. 多层终端检测确定最优 chalk level
 * 2. 单例 chalk 实例，全局统一配色能力
 * 3. 信任 chalk 内建降级机制 (RGB→256→16→none)
 * 4. 支持 NO_COLOR / FORCE_COLOR / COLORTERM 等环境变量
 *
 * 颜色降级完全由 chalk 处理:
 *   level 3 (truecolor): hex/rgb 原样输出
 *   level 2 (256色): chalk 自动将 RGB 映射到最近的 256 色
 *   level 1 (16色): chalk 自动映射到基础 ANSI 色
 *   level 0 (无色): 所有 ANSI 转义码被移除
 */
import chalk from 'chalk';
export type ChalkLevel = 0 | 1 | 2 | 3;
export declare abstract class ChalkFactory {
    private static readonly defaultLevel;
    private static instance;
    private static detectedLevel;
    private static inputFingerprint;
    /**
     * 获取已配置好 level 的 chalk 实例（单例）
     *
     * chalk 会根据 level 自动处理颜色降级:
     * - 传入 hex('#28B894') 时，level=1 会自动映射到最近的 ANSI 16 色
     * - 传入 rgb(40,184,148) 时，level=2 会自动映射到最近的 256 色
     * - level=0 时所有颜色方法返回原始文本
     */
    static getChalk(): typeof chalk;
    /**
     * 获取检测到的 chalk level
     */
    static getLevel(): ChalkLevel;
    /**
     * 重置缓存（用于测试）
     */
    static reset(): void;
    /**
     * 创建配置好 level 的 chalk 实例
     */
    private static createChalkInstance;
    private static getInputFingerprint;
    /**
     * 8 层终端检测，确定最优 chalk level
     *
     * 优先级（高→低）:
     * 1. NO_COLOR 环境变量 → level 0
     * 2. --no-color / --color CLI 参数 → 强制指定
     * 3. FORCE_COLOR 环境变量 → 强制指定级别
     * 4. 特定终端修正 (Apple Terminal 等)
     * 5. CI 环境检测
     * 6. COLORTERM 环境变量
     * 7. TERM 环境变量
     * 8. Node.js 自动检测 (chalk 默认值) 作为 fallback
     */
    private static detectLevel;
    /**
     * 特定终端的 level 修正
     *
     * 某些终端虽然支持 truecolor，但 COLORTERM 可能未设置，
     * 或者某些终端只支持 256 色但 TERM 报告不准确。
     * 通过终端检测进行修正。
     */
    private static getTerminalSpecificLevel;
}
