type Shell = 'Bash' | 'PowerShell';
interface Word {
    text: string;
    quoted: boolean;
    /** 引号外含通配、花括号、赋值号或非 `~/` 形式的波浪号；这类词由 shell 改写，不能作为命令名或脚本路径。 */
    unsafe: boolean;
    /** 以引号外的 `~`、`~/` 开头，由 Bash 展开为家目录。 */
    home: boolean;
    assignment?: string;
    expansions?: {
        start: number;
        end: number;
        name: string;
        quoted: boolean;
    }[];
}
interface ParseOptions {
    pathCommands?: boolean;
}
declare function parseInvocation(words: Word[], dir: string, shell: Shell, options: ParseOptions): {
    script: string;
    interpreter?: string;
    pathLookup?: boolean;
    environmentDirectories?: string[];
    hasArguments?: boolean;
} | undefined;
type Invocation = NonNullable<ReturnType<typeof parseInvocation>>;
/** 可整条豁免的命令：`invocations` 中的脚本均需校验来源，`writes` 为需在宿主侧校验的输出重定向目标。 */
export interface TrustedCommand {
    invocations: Invocation[];
    writes: string[];
    filters?: string[];
    builtins?: string[];
    assignedVariables?: string[];
}
/**
 * 首个脚本入口之后只允许其他脚本、纯输出命令与只处理标准输入的过滤命令；
 * 文件重定向只允许 `/dev/null` 与字面量输出路径，后者由调用方限制在临时目录。
 */
export declare function getTrustedCommand(command: string, shell: Shell, cwd: string, options?: ParseOptions, depth?: number): TrustedCommand | undefined;
export {};
