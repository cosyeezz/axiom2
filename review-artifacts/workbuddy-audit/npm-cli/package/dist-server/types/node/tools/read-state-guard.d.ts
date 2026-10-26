import { ToolErrorCode } from './tool-error-codes';
import { ReadFileStateService } from './tool-protocol';
/**
 * 覆盖已存在文件前的并发保护（issue #75872）。
 *
 * 语义（乐观并发校验，非锁）：
 * 1. 未先 Read → 抛 notRead 码，要求先读。
 * 2. Read 之后文件被改（用户 / linter / 其它并发 session，mtime 前进）→ 抛 stale 码，要求重读。
 *
 * 当前仅 Write 工具使用（错误码 2009/2010）；Edit / MultiEdit 已改为内容级判定
 * （issue #84306），不再走 read-state 门禁。
 * 新建文件逃生口 / 目录短路由调用点各自判定（判定条件本就不同），不放在这里。
 */
export declare function assertReadStateFresh(service: ReadFileStateService, absolutePath: string, codes: {
    notRead: ToolErrorCode;
    stale: ToolErrorCode;
}): Promise<void>;
/**
 * 查询文件是否"已读且未被外部修改"（与 assertReadStateFresh 同源，但不抛错、只返回 boolean）。
 * 必须在写盘前调用：写盘会推进 mtime，写后再查 hasBeenModifiedSinceLastRead 恒为 true。
 */
export declare function isFileFresh(service: ReadFileStateService, absolutePath: string): Promise<boolean>;
