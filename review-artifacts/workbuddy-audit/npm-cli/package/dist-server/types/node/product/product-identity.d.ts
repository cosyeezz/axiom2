/** 官方默认用户级配置目录短名（无外置配置时回落）。 */
export declare const DEFAULT_USER_DIR_NAME = ".codebuddy";
/** 官方默认项目级配置目录短名（无外置配置时回落）。 */
export declare const DEFAULT_PROJECT_DIR_NAME = ".codebuddy";
/** 官方默认指令文件 baseName（大写，`CODEBUDDY.md` 家族）。 */
export declare const DEFAULT_INSTRUCTION_BASE_NAME: string;
export interface ProductIdentity {
    /** 短产品名，例如 XxxCode；缺省 CodeBuddy。 */
    productName: string;
    /** CLI 完整显示名，例如 XxxCode CLI；缺省 `${productName} Code`。 */
    cliName: string;
    /** 命令入口名（二进制名），例如 xxxcode；缺省 codebuddy。 */
    binaryName: string;
    /**
     * 命令行 alias 列表；官方版为 `['cbc']`（CodeBuddy Code 缩写），
     * 定制版默认空数组以避免品牌泄漏。schema 未来可扩展 `branding.aliases`
     * 允许客户显式声明；当前仅在无外置配置时提供官方 alias。
     */
    aliases: string[];
    /** 用户级目录名，例如 .xxxcode；缺省 .codebuddy。 */
    userDirName: string;
    /** 项目级目录名，例如 .xxxcode；缺省 .codebuddy。 */
    projectDirName: string;
    /**
     * 指令文件 baseName（大写），例如 XXXCODE；缺省 CODEBUDDY。
     * fallback 语义与 memory-protocol.resolveMemoryFileNames() 完全一致，
     * 由 {@link resolveInstructionBaseName} 单一入口派生，杜绝分裂身份。
     */
    instructionBaseName: string;
}
/**
 * 单一入口解析指令文件 baseName。
 *
 * 语义：`dataLayout.instructionFiles.baseName` 显式配置 > 官方默认 `CODEBUDDY`。
 * **不**从 `branding.productName` 派生 —— productName schema 允许非 ASCII
 * / 空格 / 中文，`toUpperCase()` 后无法通过 `INSTRUCTION_BASE_NAME_RE`
 * 校验，作为文件名 baseName 直接非法。若客户想要 `XXXCODE.md` 家族，
 * 必须显式配置 `dataLayout.instructionFiles.baseName`。
 */
export declare function resolveInstructionBaseName(): string;
/** 解析运行时产品身份；无外置配置时返回官方默认。 */
export declare function resolveProductIdentity(): ProductIdentity;
/**
 * 派生登录态文件所用的 authentication.id。
 *
 * 定制版（customization.json）与官方版是不同认证体系（不同网关 / 不同品牌），
 * 登录态必须隔离。否则与官方版共用同一份登录态，后登录覆盖先登录，token 与
 * 网关错配（SaaS token 打私有化网关 / 反之）导致 401。
 *
 * 隔离依据：binaryName 优先、endpoint 兜底，两者都落在 `-custom-` 命名空间内。
 * - binaryName：客户自声明的产品标识，可读、稳定、文件安全（schema 已校验
 *   `^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$`）；
 * - endpoint host：未配 binaryName 时兜底，hostname 中 `.` 替换为 `_`；
 * - 两者皆无（官方版 / 空配置）原样返回，与官方版共用登录态。
 * 确定性：同一配置每次派生一致，登录态不漂移。
 */
export declare function resolveCustomAuthId(baseAuthId: string): string;
