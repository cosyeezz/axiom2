import { PluginValidator as IPluginValidator } from './plugin-protocol';
export interface ValidationError {
    path: string;
    message: string;
}
export interface ValidationResult {
    success: boolean;
    errors: ValidationError[];
    warnings: ValidationError[];
    filePath: string;
    fileType: 'plugin' | 'marketplace';
}
/**
 * 清单验证失败错误
 */
export declare class ManifestValidationError extends Error {
    filePath: string;
    validationResult: ValidationResult;
    constructor(message: string, filePath: string, validationResult: ValidationResult);
}
/**
 * 插件验证器实现
 * 负责验证插件和市场清单文件的有效性
 */
export declare class PluginValidatorImpl implements IPluginValidator {
    /**
     * 验证插件或市场清单
     * @param inputPath 文件或目录路径
     */
    validateManifest(inputPath: string): Promise<ValidationResult>;
    /**
     * 验证目录中的清单文件
     */
    private validateDirectory;
    /**
     * 验证文件
     */
    private validateFile;
    /**
     * 验证插件清单文件
     */
    private validatePluginManifestFile;
    /**
     * 验证市场清单文件
     */
    private validateMarketplaceManifestFile;
    private validateDependencies;
}
//# sourceMappingURL=plugin-validator.d.ts.map