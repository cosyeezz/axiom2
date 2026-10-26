export declare enum VerificationResultType {
    EMPTY_PATH = "emptyPath",
    PATH_NOT_FOUND = "pathNotFound",
    NOT_A_DIRECTORY = "notADirectory",
    SUCCESS = "success",
    ALREADY_IN_WORKING_DIRECTORY = "alreadyInWorkingDirectory"
}
export interface VerificationResult {
    resultType: VerificationResultType;
    directoryPath?: string;
    absolutePath?: string;
    workingDir?: string;
}
export declare abstract class AddDirUtils {
    static getAbsolutePath(dirpath: string): string;
    static normalizePath(path: string): string;
    static isSamePath(addDir: string, hasDir: string): boolean;
    static directoryVerification(directoryPath: string, additionalDirectories: string[]): VerificationResult;
    static getVerificationMsg(verificationInfo: VerificationResult): string;
}
