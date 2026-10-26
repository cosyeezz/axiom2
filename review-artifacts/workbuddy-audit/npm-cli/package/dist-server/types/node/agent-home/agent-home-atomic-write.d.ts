/**
 * 原子写文件：同目录 tmp + rename（POSIX 保证 rename 原子）。
 *
 * agent-home 内只留这一份实现——原先四份手写版（directory / 频道看板 / 协调者租约 / 收件箱）
 * 的 tmp 命名与「rename 失败留不留 .tmp」行为都不一样。零依赖叶子模块，谁都能用。
 */
export declare function writeFileAtomic(file: string, content: string | Uint8Array, options?: {
    mode?: number;
}): Promise<void>;
