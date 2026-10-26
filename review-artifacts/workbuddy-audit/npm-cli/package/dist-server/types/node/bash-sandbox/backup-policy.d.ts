import { type GradleBuildOutputScanOptions, type ModifyBackupExcludedPathOptions as RuntimeOptions } from '@genie/sandbox-cli/backup-policy-node';
export { DEFAULT_MODIFY_BACKUP_EXCLUDED_DIRS, DEFAULT_MODIFY_BACKUP_EXCLUDED_FILES } from './backup-exclusions';
export { DEFAULT_TOOLCHAIN_ALLOW_WRITE_DIRS, WINDOWS_DEFAULT_ALLOW_WRITE_DIRS, WINDOWS_RECYCLE_BIN_ALLOW_WRITE_PATH } from '@genie/sandbox-cli/presets/file-policy-paths';
export { isModifyBackupBoundaryRejection } from '@genie/sandbox-cli/modify-backup-policy';
export type ModifyBackupExcludedPathOptions = Omit<RuntimeOptions, 'excludedDirectories' | 'excludedFiles' | 'expandProductPath'> & {
    codebuddyHome?: string;
};
/**
 * 找 Gradle 模块的 `build/` 输出目录，扫描时跳过本仓排除名单里的依赖目录段
 * （node_modules、.venv 等），避免在大仓库里白扫。
 */
export declare function findGradleBuildOutputRoots(workspaceRoot: string, options?: Omit<GradleBuildOutputScanOptions, 'skipDirSegments'>): Promise<string[]>;
export declare function getModifyBackupExclusionOptions(options?: ModifyBackupExcludedPathOptions): RuntimeOptions;
export declare function isModifyBackupExcludedFile(rulePath: string, options?: ModifyBackupExcludedPathOptions): boolean;
export declare function isModifyBackupExcludedPath(rulePath: string, options?: ModifyBackupExcludedPathOptions): boolean;
export declare function getExcludedBackupRootsForInjection(options?: ModifyBackupExcludedPathOptions): string[];
export declare function isWindowsAllowWriteNoBackupPath(rulePath: string, options?: Omit<ModifyBackupExcludedPathOptions, 'platform'>): boolean;
