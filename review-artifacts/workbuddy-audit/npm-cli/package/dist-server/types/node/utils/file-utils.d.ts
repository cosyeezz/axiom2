import { type StructuredPatchHunk } from 'diff';
export declare namespace FileUtils {
    function getWorkspace(): string;
    function getRelativePath(root: string, target: string): string;
    function resolveFilePath(filePath: string, workspace?: string): Promise<string>;
    function readTextContent(filePath: string, offset?: number | null, maxLines?: number | null): Promise<{
        content: string;
        lineCount: number;
        totalLines: number;
    }>;
    function addLineNumbers({ content, startLine, }: {
        content: string;
        startLine: number;
    }): string;
    function applyEdit(filePath: string, oldString: string, newString: string): {
        patch: StructuredPatchHunk[];
        updatedFile: string;
    };
    function getPatch({ filePath, fileContents, oldStr, newStr, }: {
        filePath: string;
        fileContents: string;
        oldStr: string;
        newStr: string;
    }): StructuredPatchHunk[];
    function calculateTextSize(text: string): string;
    /**
     * Format file size in bytes to human-readable string
     * @param bytes File size in bytes (undefined returns empty string)
     * @returns Formatted size string (e.g., "204.7KB", "1.2MB")
     */
    function formatFileSize(bytes: number | undefined): string;
    function isBinaryFile(filePath: string): Promise<boolean>;
    /**
     * 用本机 GUI 打开文件的候选命令。绝对路径，避免 PATH 里没有 `open`
     * 时误落到 $EDITOR/vim。macOS 先 `open -t`（默认文本编辑器）。
     */
    function systemOpenInvocations(filePath: string, platform?: NodeJS.Platform): Array<{
        cmd: string;
        args: string[];
    }>;
    /**
     * 打开文件使用系统默认应用程序
     * @param filePath 文件路径
     * @returns 是否成功打开文件
     */
    function openFile(filePath: string): Promise<boolean>;
    /**
     * 差异计算的默认超时预算（毫秒）。大文件/高差异密度下 Myers 算法退化为 O(N²)，
     * 会长时间同步阻塞事件循环（实测可达数十分钟）。以此为默认值，保证所有调用方
     * 即使忘记显式传参也默认受保护；对齐 Claude Code 的 5s。
     */
    const DEFAULT_DIFF_TIMEOUT_MS = 5000;
    /**
     * Calculate file change statistics between old and new content using diff library
     * @param originalContent The original file content
     * @param newContent The new file content
     * @param timeoutMs Myers diff timeout in milliseconds (默认 {@link DEFAULT_DIFF_TIMEOUT_MS}).
     *                  When the diff exceeds this budget (large/dense files), diffLines
     *                  returns undefined and this function returns undefined to signal
     *                  "timed out" (distinct from "no changes").
     * @returns Statistics about the changes made, or undefined if the diff timed out
     */
    function calculateFileChanges(originalContent: string, newContent: string, timeoutMs?: number): {
        addLineCount: number;
        removedLines: number;
        addCharCount: number;
        deleteCharCount: number;
    } | undefined;
    /** 文件变更统计（增删行数/字符数）。 */
    interface FileChangeStats {
        addLineCount: number;
        removedLines: number;
        addCharCount: number;
        deleteCharCount: number;
    }
    /** 一次局部编辑：把 oldText 替换为 newText，repeat 为 replace_all 命中次数放大系数。 */
    interface LocalEditPart {
        /** 该编辑替换掉的旧文本（新建 / insert 场景传 ''）。 */
        oldText: string;
        /** 替换后的新文本（delete 场景传 ''）。 */
        newText: string;
        /** replace_all 命中次数放大系数；默认 1；<=0 视为 1。 */
        repeat?: number;
    }
    /**
     * 对每组「局部编辑片段」分别做小 diff 后累加，得到总的增删行数/字符数。
     *
     * 与 {@link calculateFileChanges}（对整份文件做 diff）不同，这里的输入是模型一次编辑的
     * old/new 片段（通常几十~几百行），规模天然很小，因此**不带 timeout**，也不会触发
     * 大文件 Myers O(N²) 卡死（见 issue #63148）。供 edit / multi-edit / notebook 使用。
     *
     * 行数统计对齐 {@link accumulateDiffParts}；字符数用原始 part.value.length（补尾换行仅用于
     * 行级比对，最多引入 ±1 字符的次要误差，可忽略）。
     */
    function calculateLocalChanges(parts: LocalEditPart[]): FileChangeStats;
    /**
     * 从结构化 patch 的 hunk 行中统计新增/删除行数。
     *
     * 只遍历 hunk 内部的 diff 行（`+`/`-`/` ` 前缀），天然不含 `---`/`+++` 文件头，
     * 因此不会像「解析 unified diff 文本」那样把真实内容行 `++foo` / `--bar` 误判为
     * 头部而漏算（见 issue #63148 回归）。
     */
    function countHunkLines(hunks: StructuredPatchHunk[]): {
        additions: number;
        deletions: number;
    };
    /**
     * 生成 old→new 的 unified diff 文本并同时给出精确的增删行数，内置默认超时预算
     * （{@link DEFAULT_DIFF_TIMEOUT_MS}）。
     *
     * 只跑一次 {@link structuredPatch}：diff 文本由 `formatPatch` 从结构化结果还原，
     * 行数由 {@link countHunkLines} 从同一份 hunk 统计——避免二次 diff（重复计算 +
     * 双份超时预算），也避免解析 patch 文本前缀导致的 `++`/`--` 内容行误判。
     *
     * 大文件/高差异密度下超过预算时返回 undefined（区别于「无变更」的空 patch），
     * 让调用方降级处理，避免 O(N²) 同步阻塞事件循环。
     *
     * @param fileName patch 头部显示的文件名（old/new 用同一个即可）
     * @param oldContent 旧内容
     * @param newContent 新内容
     * @param timeoutMs Myers diff 超时（默认 {@link DEFAULT_DIFF_TIMEOUT_MS}）
     * @returns `{ diff, additions, deletions }`；超时则返回 undefined
     */
    function createUnifiedDiffWithStats(fileName: string, oldContent: string, newContent: string, timeoutMs?: number): {
        diff: string;
        additions: number;
        deletions: number;
    } | undefined;
    function fileExists(filePath: string): Promise<boolean>;
    /**
     * 检查路径是否为目录
     *
     * @param filePath - 要检查的路径
     * @returns 是目录返回 true，是文件或不存在返回 false
     */
    function isDirectory(filePath: string): Promise<boolean>;
    function findSimilarFilename(targetFilePath: string, minSimilarity?: number): Promise<string | null>;
    /**
     * 检测文件编码（支持 BOM 和字符统计）
     * @param filePath 文件路径
     * @param sampleSize 采样大小，默认 4096 字节
     */
    /** Detect encoding from the leading bytes and decode the same buffer — one read, no re-read.
     *
     * Async: 需先 `await preloadEncoding()` 装载 iconv-lite + jschardet lazy chunk。
     * 早前是同步 API，一起绑主 chunk；现在编码族拆到 lazy chunk（standby -12 MB heap），
     * 因此接口异步化。所有 caller 均已在 async 上下文（await readBinaryFile 之后调用）。
     */
    function decodeTextBuffer(buffer: Buffer): Promise<{
        content: string;
        encodingInfo: {
            encoding: string;
            confidence: number;
            hasBom: boolean;
            bomType?: string;
        };
    }>;
    /** Encoding detection over an in-memory sample (empty → utf-8, BOM, charset heuristics).
     *
     * Async 版本：内部会先 `await preloadEncoding()` 保证 iconv-lite / jschardet 就位。
     */
    function detectEncodingFromBuffer(buffer: Buffer): Promise<{
        encoding: string;
        confidence: number;
        hasBom: boolean;
        bomType?: string;
    }>;
    function detectFileEncoding(filePath: string, sampleSize?: number): Promise<{
        encoding: string;
        confidence: number;
        hasBom: boolean;
        bomType?: string;
    }>;
    function readFileWithEncodingDetection(filePath: string): Promise<string>;
    /**
     * Detect the line ending type in content
     * Returns 'CRLF' for \r\n, 'LF' for \n, or 'MIXED' if both exist
     */
    function detectLineEnding(content: string): 'CRLF' | 'LF' | 'MIXED';
    /**
     * Normalize line endings to LF for internal processing
     */
    function normalizeLineEndings(content: string): string;
    /**
     * Restore line endings to the original format
     */
    function restoreLineEndings(content: string, lineEnding: 'CRLF' | 'LF' | 'MIXED'): string;
}
