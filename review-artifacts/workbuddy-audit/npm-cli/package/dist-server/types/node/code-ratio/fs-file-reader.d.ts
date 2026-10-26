import { CodeRatioFileReader } from '@genie/code-ratio';
/**
 * CLI-side implementation of CodeRatioFileReader.
 *
 * The five editor tools (write / edit / multi-edit / notebook-edit /
 * notebook-write) already have `originalContent` in hand when they call
 * into the reporter, so this reader is a defensive fallback: the
 * reporter itself will invoke it only when the caller omits `oldContent`.
 *
 * Input is a POSIX, repo-relative path (per the protocol). We resolve it
 * against the current repo root (provided by CodeRatioRepoResolver) and
 * read through `FileUtils.readFileWithEncodingDetection`, which reuses
 * the same encoding detection that the edit tools use for writing, so
 * the old/new content pair stays byte-comparable for diffing.
 *
 * Failure policy: any error (missing resolver, path outside the repo,
 * file does not exist, permission denied, encoding failure, ...) is
 * swallowed and `undefined` is returned. The reporter then treats it as
 * `invalid-input` and skips the upload, never breaking the tool flow.
 */
export declare class FsFileReader implements CodeRatioFileReader {
    private logger?;
    constructor();
    readFile(filePath: string): Promise<string | undefined>;
    private resolveAbsolute;
}
