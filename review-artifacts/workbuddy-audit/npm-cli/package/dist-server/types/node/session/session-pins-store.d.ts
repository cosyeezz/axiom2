/**
 * 会话置顶集合的持久化。
 *
 * 数据落在通用键值存储 `StorageService` 的 workspace 作用域里，键为 `sessionSwitcher.pinned`，值是
 * sessionId 字符串数组。workspace 作用域按 folder 分片到
 * `~/.codebuddy/projects/{compressedCwd}/storage.json`，与会话文件同处一个目录，置顶天然随项目走。
 *
 * 本模块只是 `StorageService` 之上的薄适配层，负责三件它不管的事：
 *
 * 1. **cwd 归一化**。`StorageService` 不对 folder 做 resolve，直接 `compressPath(folder)` 再 `join`，而
 *    `compressPath('..')` 结果仍是 `'..'`，会让 storage 文件逃到 `~/.codebuddy/storage.json`；读写两侧的
 *    cwd 都来自 HTTP query 字符串，必须先 `resolve` 成绝对路径再交给 storage。归一化顺带解决劈叉：`/a/b/`
 *    与 `/a/b`、`/a/./b` 与 `/a/b` 是同一个项目，不归一化会落到两份数据上，用户换个入口打开就发现置顶
 *    「没了」。
 * 2. **读改写的串行化**。`StorageService` 内部的锁只保护它自己那一次读或写，而置顶是「读出数组 → 增删一
 *    个 id → 写回」，跨两次调用，中间没有锁；调用方是浏览器发来的 HTTP 请求，同一 Node 进程里天然会并发，
 *    不串起来两个并发 PUT 就会互相覆盖。这里用 async-mutex 按 storage 文件所在的分片目录加一把进程内的锁
 *    （见 `withShardLock`，分键必须与文件身份一致）。与 job-store 的 pins.json 一样，**有意不加跨进程
 *    锁**：置顶写入频率极低，跨进程互相覆盖最坏只是丢一次顺序偏好，不值得引入锁的复杂度与失败模式。
 * 3. **Set 与数组的转换**，以及读侧的 best-effort 降级：展示顺序的偏好数据出任何问题都不该阻断会话列表
 *    本身。
 */
import { type StorageService } from '../storage/storage-protocol';
/** 置顶集合在 storage 里的键名 */
export declare const SESSION_PINS_STORAGE_KEY = "sessionSwitcher.pinned";
/**
 * 交给 `StorageService` 的 folder 必须是已经 resolve 过的绝对路径，否则 `?cwd=..` 这类构造能把 storage 文件写出项目分片目录。
 */
export declare function resolvePinsFolder(cwd: string): string;
/**
 * 对外的读：全降级。展示顺序的偏好数据出任何问题都不该阻断会话列表。但降级要留痕——这条路径静默失败时，
 * 用户报上来的现象是「置顶没了」，与分页顺序问题、cwd 劈叉成两份数据的现象完全一样，排查时分不开。
 */
export declare function readSessionPins(storage: StorageService, cwd: string): Promise<Set<string>>;
export declare function setSessionPinned(storage: StorageService, cwd: string, sessionId: string, pinned: boolean): Promise<void>;
export declare function removeSessionPin(storage: StorageService, cwd: string, sessionId: string): Promise<void>;
