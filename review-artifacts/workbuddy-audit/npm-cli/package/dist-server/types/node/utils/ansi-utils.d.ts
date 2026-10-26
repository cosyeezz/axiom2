/**
 * 复位终端字符集状态的转义序列：`ESC ( B` + `ESC ) B` + SI。
 *
 * - `ESC ( B`（`\x1b(B`）：把 G0 重新指定为 US ASCII，撤销 `ESC ( 0`（DEC 画线
 *   字符集，Special Graphics）造成的字母→线条重映射。
 * - `ESC ) B`（`\x1b)B`）：把 G1 重新指定为 US ASCII。SO 激活的是 G1，若 G1 被设成
 *   画线字符集（`ESC ) 0`）后曾通过 SO 激活，仅 SI 切回 G0 后 G1 仍残留脏状态，
 *   下次误发 SO 会再次花屏。一并复位 G1 彻底消除隐患。
 * - `SI`（`\x0f`，Shift In）：从 G1 切回 G0，撤销 `SO`（`\x0e`，Locking Shift Out）。
 *
 * 三者缺一不可：现网 issue #81441 中终端同时被 SCS 与 SO 污染，用户实测需要复位动作
 * 一起发才能恢复。序列本身幂等、对未被污染的终端无可见副作用，因此可以在退出 /
 * 清屏 / 刷新等收尾路径无条件发出。
 */
export declare const RESET_CHARSET = "\u001B(B\u001B)B\u000F";
export declare abstract class AnsiUtils {
    /**
     * 过滤掉 ansi 对应的颜色字符，仅保留文本和换行
     */
    static replaceAnsiColor(text: string): string;
    /**
     * 剥离会污染终端字符集状态的控制序列：SO(0x0E) / SI(0x0F) 与 SCS（`ESC ( x` /
     * `ESC ) x`）。
     *
     * 背景（issue #81441）：外部命令输出或被读入的文件内容里若含有 `ESC ( 0`（切到
     * DEC 画线字符集）或裸 `SO`，一旦原样进入我们自己渲染的文本，就会把终端锁进画线
     * 字符集——字母显示成线条，且退出重启也不恢复（字符集是终端自身的状态）。
     * `strip-ansi` 与 `replaceAnsiColor` 都**不**剥离 SO/SI，因此需要这层专门过滤。
     *
     * 使用位置：任何把「外部来源文本」交给终端渲染前的边界（如 diff 视图渲染 patch
     * 内容）。注意本函数只做单次替换，不处理跨 chunk 截断的半截 SCS 序列——调用方若
     * 是流式分块场景，应先攒齐完整行再调用。
     */
    static stripCharsetControls(text: string): string;
    /** 见 display-controls.ts：剥离展示文本中的控制字符（保留 \t / \n）。 */
    static stripDisplayControls(text: string): string;
    /** 见 display-controls.ts：把控制字符转义为可见形式，用于待执行内容的授权展示。 */
    static escapeDisplayControls(text: string): string;
    /** 剥离 BEL / ST（7-bit `ESC \` 与 8-bit 0x9C）终止的 OSC/DCS/APC/PM 字符串序列。
     * 执行层与显示层共用这一份定义，避免两处正则口径漂移。 */
    static stripStringSequences(text: string): string;
    /**
     * 清洗子进程 shell 输出的一个 chunk——所有 shell 执行后端投递前统一走这里，
     * 避免各后端各自内联 `stripAnsi(...)` 造成同一命令在不同后端下输出不一致。
     *
     * 先整段剥掉字符串序列（`replaceAnsiColor` 的 payload 字符集不含反斜杠与空格，
     * 处理 Windows 路径标题这类 OSC 会留残片；DCS 的 ESC P 头会被它当单字符序列
     * 吃掉），再剥其余 ANSI，最后补它不剥离的 SO/SI。
     * 本函数无状态，不处理跨 chunk 截断的半截序列。
     */
    static sanitizeShellChunk(chunk: string): string;
    /**
     * 检测当前终端是否支持 OSC 8 超链接。
     *
     * 这是 `supports-hyperlinks` 包判定逻辑的纯函数移植：该包是 ESM-only，
     * 且经由 `supports-color` 引入更多 ESM 依赖，直接 import 会破坏 ansi-utils
     * 被 ts-node/mocha(CJS) 加载的单测。这里内联实现同等判定，仅把 `supports-color`
     * 的颜色检测替换成轻量的 `NO_COLOR` / `TERM=dumb` / tty 兜底。
     *
     * 每次调用实时读 `process.env`（不做模块级缓存），以符合 prewarm 进程的
     * per-session env live 读约定。
     *
     * 不支持 OSC 8 的终端（大量 SSH client、tmux 未开 passthrough、堡垒机、
     * 老版终端等）若强行输出 OSC 8 序列，转义会被忽略、BEL 被吞，可见字符退化为
     * `<url><displayText>`——见 issue #71748。
     */
    static supportsHyperlinks(): boolean;
    /** Parse a terminal version string. Some env vars omit dots (e.g. "4601" => 46.1). */
    private static parseTerminalVersion;
    /**
     * 创建终端可点击的超链接
     * 使用 ANSI OSC 8 协议。终端不支持 OSC 8 时降级为纯文本（单条 displayText），
     * 避免转义泄漏导致 URL 首尾拼接（issue #71748）。
     * @param url 链接地址
     * @param text 显示文本（可选，默认为url）
     */
    static createHyperlink(url: string, text?: string): string;
    /** Wrap a target/display pair in the OSC 8 hyperlink escape sequence. */
    private static wrapOsc8;
    /**
     * 创建文件路径的可点击超链接
     * 使用 file:// 协议。终端不支持 OSC 8 时降级为纯文本（displayText）。
     * @param filePath 文件路径（相对或绝对路径）
     * @param text 显示文本（可选，默认为文件名）
     */
    static createFileHyperlink(filePath: string, text?: string): string;
    /**
     * 处理ANSI文本，保留颜色代码用于终端显示
     * @param text 包含ANSI代码的文本
     * @returns 处理后的文本
     */
    static processAnsiText(text: string): string;
    /**
     * Wrap POSIX-style file paths in OSC 8 hyperlinks so terminals that support
     * Ctrl/Cmd+click open the right file (and the right line). Without this,
     * terminals fall back to their own path-detection heuristic, which doesn't
     * handle CJK boundaries — leaving the user clicking "因: /data/..." instead
     * of "/data/...".
     *
     * Recognized forms:
     *   - /absolute/path
     *   - ./relative or ../relative
     *   - ~/in-home
     *   - file:///abs
     *   - bare relative and Windows paths
     *   - quoted paths containing spaces
     *   - optional :line, :line:col, :line-endLine, or :line:col-endLine:endCol suffix
     *
     * On terminals without OSC 8 support this returns the text unchanged, so
     * no escape sequences leak and callers no longer need their own gate.
     */
    static linkifyFilePaths(text: string, cwd?: string): string;
}
