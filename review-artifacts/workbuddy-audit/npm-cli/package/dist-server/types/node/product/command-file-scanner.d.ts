/**
 * 自定义命令目录扫描（.codebuddy/commands 下的 markdown → Command）。
 *
 * 从 CustomCommandsProductProvider 抽出的无状态函数面：进程档 provider 与
 * 会话档扫描（server 面形态 A，kernel-effects 的 scanSessionCommands 在会话
 * rootScope 内调用，ambient dataFs 解析到 query({ fs }) 的命名空间）共用同
 * 一份解析语义——命令名构造、frontmatter 字段、描述后缀必须逐字一致，否则
 * 两档同名遮蔽会错位。
 */
import { Command } from '@genie/product';
export interface CommandScanLogger {
    debug(message: string, error?: unknown): void;
}
/** User then project; later names win when merged, matching Product SmartMerge. */
export declare function scanWorkspaceCommands(cwd: string, logger?: CommandScanLogger): Promise<Command[]>;
export declare function scanCommandsDirectory(baseDir: string, source: 'project' | 'user', logger?: CommandScanLogger): Promise<Command[]>;
