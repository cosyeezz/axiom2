/**
 * customization.json V1 协议 Schema（单一事实来源）。
 *
 * - TypeScript 类型由 `z.infer` 派生，JSON Schema 由 `zod-to-json-schema` 生成，
 *   三者同源不漂移。
 * - 顶层及所有嵌套对象均使用 strict 模式：未知字段（含禁止字段、
 *   `distribution` / `daemonServiceId` / `daemonServiceName`、`accentColor`、
 *   已移除的 `authentication`）一律拒绝。
 * - `updates` 只接受 `{ disabled: true }`；`builtInMarketplaces` 省略/`{}` 由
 *   validator 规范化为空市场，不回落官方市场。
 */
import { z } from 'zod';
/** 外置客户配置文件固定文件名。 */
export declare const PRODUCT_CUSTOM_CONFIG_FILE_NAME = "customization.json";
/** 配置文件大小上限（建议 256 KiB）。 */
export declare const MAX_PRODUCT_CUSTOM_CONFIG_BYTES: number;
/**
 * 客户内置插件市场 item：按 source 判别联合。
 * - github：必须提供 repo；
 * - git / url / zip：必须提供 url。
 * 缺必填字段在 Schema 阶段即失败，避免 builder（AJV）与运行时（Zod）行为漂移。
 */
declare const marketplaceItemSchema: z.ZodDiscriminatedUnion<"source", [z.ZodObject<{
    source: z.ZodLiteral<"github">;
    repo: z.ZodString;
    metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    autoUpdate: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    source: "github";
    repo: string;
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}, {
    source: "github";
    repo: string;
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}>, z.ZodObject<{
    source: z.ZodLiteral<"git">;
    url: z.ZodEffects<z.ZodString, string, string>;
    metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    autoUpdate: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    url: string;
    source: "git";
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}, {
    url: string;
    source: "git";
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}>, z.ZodObject<{
    source: z.ZodLiteral<"url">;
    url: z.ZodEffects<z.ZodString, string, string>;
    metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    autoUpdate: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    url: string;
    source: "url";
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}, {
    url: string;
    source: "url";
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}>, z.ZodObject<{
    source: z.ZodLiteral<"zip">;
    url: z.ZodEffects<z.ZodString, string, string>;
    metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    autoUpdate: z.ZodOptional<z.ZodBoolean>;
}, "strict", z.ZodTypeAny, {
    url: string;
    source: "zip";
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}, {
    url: string;
    source: "zip";
    metaUrl?: string | undefined;
    versionUrl?: string | undefined;
    autoUpdate?: boolean | undefined;
}>]>;
/**
 * customization.json V1 完整 Schema。
 * 顶层 strict：禁止字段（mergeStrategy / include / productConfigPathEnv / productConfigEnv /
 * models / agents / prompts / tools / productFeatures / clientSecurity / replacements）以及
 * `distribution` / `daemonServiceId` / `daemonServiceName`均按未知字段拒绝。
 */
export declare const ProductCustomConfigurationV1Schema: z.ZodObject<{
    branding: z.ZodOptional<z.ZodObject<{
        productName: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, string, string>>;
        cliName: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, string, string>>;
        binaryName: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        asciiLogo: z.ZodOptional<z.ZodArray<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, "many">>;
        logoColor: z.ZodOptional<z.ZodString>;
        brandColor: z.ZodOptional<z.ZodString>;
    }, "strict", z.ZodTypeAny, {
        productName?: string | undefined;
        cliName?: string | undefined;
        binaryName?: string | undefined;
        asciiLogo?: string[] | undefined;
        logoColor?: string | undefined;
        brandColor?: string | undefined;
    }, {
        productName?: string | undefined;
        cliName?: string | undefined;
        binaryName?: string | undefined;
        asciiLogo?: string[] | undefined;
        logoColor?: string | undefined;
        brandColor?: string | undefined;
    }>>;
    endpoint: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    stagingEndpoint: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    updates: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        disabled: z.ZodLiteral<true>;
    }, "strict", z.ZodTypeAny, {
        disabled: true;
    }, {
        disabled: true;
    }>, z.ZodObject<{
        disabled: z.ZodOptional<z.ZodLiteral<false>>;
        checkVersion: z.ZodObject<{
            url: z.ZodEffects<z.ZodString, string, string>;
            intervalSeconds: z.ZodOptional<z.ZodNumber>;
        }, "strict", z.ZodTypeAny, {
            url: string;
            intervalSeconds?: number | undefined;
        }, {
            url: string;
            intervalSeconds?: number | undefined;
        }>;
        download: z.ZodObject<{
            url: z.ZodEffects<z.ZodString, string, string>;
        }, "strict", z.ZodTypeAny, {
            url: string;
        }, {
            url: string;
        }>;
        manualOnly: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        checkVersion: {
            url: string;
            intervalSeconds?: number | undefined;
        };
        download: {
            url: string;
        };
        disabled?: false | undefined;
        manualOnly?: boolean | undefined;
    }, {
        checkVersion: {
            url: string;
            intervalSeconds?: number | undefined;
        };
        download: {
            url: string;
        };
        disabled?: false | undefined;
        manualOnly?: boolean | undefined;
    }>]>>;
    links: z.ZodOptional<z.ZodObject<{
        officialWebsite: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        helpDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        issueFeedback: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        issueCreation: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        mcpHelpDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        hooksHelpDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        sandboxHelpDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        upgradeUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        contactUs: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        applyForTrial: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        termsOfService: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        privacyPolicy: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        realNameAuth: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        console: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        jetBrainsIDE: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        codeReviewDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        homePage: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        downloadVscodePluginUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        downloadJetBrainsPluginUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        unitTestDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        businessLabelWebPage: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        craftFeedback: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        craftShellHelpDocument: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        usageLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        planLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        homepageLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        accountLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        helpLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        contactUsLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        billLink: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        tencentGalleryBaseUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        chineseGalleryBaseUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        ruleMarketUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        mcpMarketUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        ruleDocumentUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        mcpDocumentUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        knowledgeBaseUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
    }, "strict", z.ZodTypeAny, {
        console?: string | undefined;
        officialWebsite?: string | undefined;
        helpDocument?: string | undefined;
        issueFeedback?: string | undefined;
        issueCreation?: string | undefined;
        mcpHelpDocument?: string | undefined;
        hooksHelpDocument?: string | undefined;
        sandboxHelpDocument?: string | undefined;
        upgradeUrl?: string | undefined;
        contactUs?: string | undefined;
        applyForTrial?: string | undefined;
        termsOfService?: string | undefined;
        privacyPolicy?: string | undefined;
        realNameAuth?: string | undefined;
        jetBrainsIDE?: string | undefined;
        codeReviewDocument?: string | undefined;
        homePage?: string | undefined;
        downloadVscodePluginUrl?: string | undefined;
        downloadJetBrainsPluginUrl?: string | undefined;
        unitTestDocument?: string | undefined;
        businessLabelWebPage?: string | undefined;
        craftFeedback?: string | undefined;
        craftShellHelpDocument?: string | undefined;
        usageLink?: string | undefined;
        planLink?: string | undefined;
        homepageLink?: string | undefined;
        accountLink?: string | undefined;
        helpLink?: string | undefined;
        contactUsLink?: string | undefined;
        billLink?: string | undefined;
        tencentGalleryBaseUrl?: string | undefined;
        chineseGalleryBaseUrl?: string | undefined;
        ruleMarketUrl?: string | undefined;
        mcpMarketUrl?: string | undefined;
        ruleDocumentUrl?: string | undefined;
        mcpDocumentUrl?: string | undefined;
        knowledgeBaseUrl?: string | undefined;
    }, {
        console?: string | undefined;
        officialWebsite?: string | undefined;
        helpDocument?: string | undefined;
        issueFeedback?: string | undefined;
        issueCreation?: string | undefined;
        mcpHelpDocument?: string | undefined;
        hooksHelpDocument?: string | undefined;
        sandboxHelpDocument?: string | undefined;
        upgradeUrl?: string | undefined;
        contactUs?: string | undefined;
        applyForTrial?: string | undefined;
        termsOfService?: string | undefined;
        privacyPolicy?: string | undefined;
        realNameAuth?: string | undefined;
        jetBrainsIDE?: string | undefined;
        codeReviewDocument?: string | undefined;
        homePage?: string | undefined;
        downloadVscodePluginUrl?: string | undefined;
        downloadJetBrainsPluginUrl?: string | undefined;
        unitTestDocument?: string | undefined;
        businessLabelWebPage?: string | undefined;
        craftFeedback?: string | undefined;
        craftShellHelpDocument?: string | undefined;
        usageLink?: string | undefined;
        planLink?: string | undefined;
        homepageLink?: string | undefined;
        accountLink?: string | undefined;
        helpLink?: string | undefined;
        contactUsLink?: string | undefined;
        billLink?: string | undefined;
        tencentGalleryBaseUrl?: string | undefined;
        chineseGalleryBaseUrl?: string | undefined;
        ruleMarketUrl?: string | undefined;
        mcpMarketUrl?: string | undefined;
        ruleDocumentUrl?: string | undefined;
        mcpDocumentUrl?: string | undefined;
        knowledgeBaseUrl?: string | undefined;
    }>>;
    telemetry: z.ZodOptional<z.ZodObject<{
        report: z.ZodOptional<z.ZodObject<{
            standard: z.ZodOptional<z.ZodObject<{
                url: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                enabled: z.ZodOptional<z.ZodBoolean>;
                path: z.ZodOptional<z.ZodString>;
            } & {
                reportCodeSnippet: z.ZodOptional<z.ZodBoolean>;
            }, "strict", z.ZodTypeAny, {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            }, {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            }>>;
            model: z.ZodOptional<z.ZodObject<{
                url: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
                headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
                enabled: z.ZodOptional<z.ZodBoolean>;
                path: z.ZodOptional<z.ZodString>;
            }, "strict", z.ZodTypeAny, {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            }, {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            }>>;
        }, "strict", z.ZodTypeAny, {
            standard?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            } | undefined;
            model?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            } | undefined;
        }, {
            standard?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            } | undefined;
            model?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            } | undefined;
        }>>;
        tracing: z.ZodOptional<z.ZodObject<{
            url: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
            headers: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
            enabled: z.ZodOptional<z.ZodBoolean>;
            path: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            url?: string | undefined;
            headers?: Record<string, string> | undefined;
            enabled?: boolean | undefined;
            path?: string | undefined;
        }, {
            url?: string | undefined;
            headers?: Record<string, string> | undefined;
            enabled?: boolean | undefined;
            path?: string | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        tracing?: {
            url?: string | undefined;
            headers?: Record<string, string> | undefined;
            enabled?: boolean | undefined;
            path?: string | undefined;
        } | undefined;
        report?: {
            standard?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            } | undefined;
            model?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            } | undefined;
        } | undefined;
    }, {
        tracing?: {
            url?: string | undefined;
            headers?: Record<string, string> | undefined;
            enabled?: boolean | undefined;
            path?: string | undefined;
        } | undefined;
        report?: {
            standard?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            } | undefined;
            model?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            } | undefined;
        } | undefined;
    }>>;
    dataLayout: z.ZodOptional<z.ZodObject<{
        legacyReadFallback: z.ZodOptional<z.ZodBoolean>;
        configDir: z.ZodOptional<z.ZodObject<{
            userDirName: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, string, string>, string, string>, string, string>, string, string>>;
            projectDirName: z.ZodOptional<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodEffects<z.ZodString, string, string>, string, string>, string, string>, string, string>, string, string>, string, string>>;
        }, "strict", z.ZodTypeAny, {
            userDirName?: string | undefined;
            projectDirName?: string | undefined;
        }, {
            userDirName?: string | undefined;
            projectDirName?: string | undefined;
        }>>;
        instructionFiles: z.ZodOptional<z.ZodObject<{
            baseName: z.ZodOptional<z.ZodString>;
        }, "strict", z.ZodTypeAny, {
            baseName?: string | undefined;
        }, {
            baseName?: string | undefined;
        }>>;
    }, "strict", z.ZodTypeAny, {
        legacyReadFallback?: boolean | undefined;
        configDir?: {
            userDirName?: string | undefined;
            projectDirName?: string | undefined;
        } | undefined;
        instructionFiles?: {
            baseName?: string | undefined;
        } | undefined;
    }, {
        legacyReadFallback?: boolean | undefined;
        configDir?: {
            userDirName?: string | undefined;
            projectDirName?: string | undefined;
        } | undefined;
        instructionFiles?: {
            baseName?: string | undefined;
        } | undefined;
    }>>;
    builtInMarketplaces: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodDiscriminatedUnion<"source", [z.ZodObject<{
        source: z.ZodLiteral<"github">;
        repo: z.ZodString;
        metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        autoUpdate: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        source: "github";
        repo: string;
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }, {
        source: "github";
        repo: string;
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }>, z.ZodObject<{
        source: z.ZodLiteral<"git">;
        url: z.ZodEffects<z.ZodString, string, string>;
        metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        autoUpdate: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        url: string;
        source: "git";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }, {
        url: string;
        source: "git";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }>, z.ZodObject<{
        source: z.ZodLiteral<"url">;
        url: z.ZodEffects<z.ZodString, string, string>;
        metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        autoUpdate: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        url: string;
        source: "url";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }, {
        url: string;
        source: "url";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }>, z.ZodObject<{
        source: z.ZodLiteral<"zip">;
        url: z.ZodEffects<z.ZodString, string, string>;
        metaUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        versionUrl: z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>;
        autoUpdate: z.ZodOptional<z.ZodBoolean>;
    }, "strict", z.ZodTypeAny, {
        url: string;
        source: "zip";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }, {
        url: string;
        source: "zip";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }>]>>>;
}, "strict", z.ZodTypeAny, {
    endpoint?: string | undefined;
    telemetry?: {
        tracing?: {
            url?: string | undefined;
            headers?: Record<string, string> | undefined;
            enabled?: boolean | undefined;
            path?: string | undefined;
        } | undefined;
        report?: {
            standard?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            } | undefined;
            model?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    branding?: {
        productName?: string | undefined;
        cliName?: string | undefined;
        binaryName?: string | undefined;
        asciiLogo?: string[] | undefined;
        logoColor?: string | undefined;
        brandColor?: string | undefined;
    } | undefined;
    stagingEndpoint?: string | undefined;
    updates?: {
        disabled: true;
    } | {
        checkVersion: {
            url: string;
            intervalSeconds?: number | undefined;
        };
        download: {
            url: string;
        };
        disabled?: false | undefined;
        manualOnly?: boolean | undefined;
    } | undefined;
    links?: {
        console?: string | undefined;
        officialWebsite?: string | undefined;
        helpDocument?: string | undefined;
        issueFeedback?: string | undefined;
        issueCreation?: string | undefined;
        mcpHelpDocument?: string | undefined;
        hooksHelpDocument?: string | undefined;
        sandboxHelpDocument?: string | undefined;
        upgradeUrl?: string | undefined;
        contactUs?: string | undefined;
        applyForTrial?: string | undefined;
        termsOfService?: string | undefined;
        privacyPolicy?: string | undefined;
        realNameAuth?: string | undefined;
        jetBrainsIDE?: string | undefined;
        codeReviewDocument?: string | undefined;
        homePage?: string | undefined;
        downloadVscodePluginUrl?: string | undefined;
        downloadJetBrainsPluginUrl?: string | undefined;
        unitTestDocument?: string | undefined;
        businessLabelWebPage?: string | undefined;
        craftFeedback?: string | undefined;
        craftShellHelpDocument?: string | undefined;
        usageLink?: string | undefined;
        planLink?: string | undefined;
        homepageLink?: string | undefined;
        accountLink?: string | undefined;
        helpLink?: string | undefined;
        contactUsLink?: string | undefined;
        billLink?: string | undefined;
        tencentGalleryBaseUrl?: string | undefined;
        chineseGalleryBaseUrl?: string | undefined;
        ruleMarketUrl?: string | undefined;
        mcpMarketUrl?: string | undefined;
        ruleDocumentUrl?: string | undefined;
        mcpDocumentUrl?: string | undefined;
        knowledgeBaseUrl?: string | undefined;
    } | undefined;
    dataLayout?: {
        legacyReadFallback?: boolean | undefined;
        configDir?: {
            userDirName?: string | undefined;
            projectDirName?: string | undefined;
        } | undefined;
        instructionFiles?: {
            baseName?: string | undefined;
        } | undefined;
    } | undefined;
    builtInMarketplaces?: Record<string, {
        source: "github";
        repo: string;
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    } | {
        url: string;
        source: "git";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    } | {
        url: string;
        source: "url";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    } | {
        url: string;
        source: "zip";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }> | undefined;
}, {
    endpoint?: string | undefined;
    telemetry?: {
        tracing?: {
            url?: string | undefined;
            headers?: Record<string, string> | undefined;
            enabled?: boolean | undefined;
            path?: string | undefined;
        } | undefined;
        report?: {
            standard?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
                reportCodeSnippet?: boolean | undefined;
            } | undefined;
            model?: {
                url?: string | undefined;
                headers?: Record<string, string> | undefined;
                enabled?: boolean | undefined;
                path?: string | undefined;
            } | undefined;
        } | undefined;
    } | undefined;
    branding?: {
        productName?: string | undefined;
        cliName?: string | undefined;
        binaryName?: string | undefined;
        asciiLogo?: string[] | undefined;
        logoColor?: string | undefined;
        brandColor?: string | undefined;
    } | undefined;
    stagingEndpoint?: string | undefined;
    updates?: {
        disabled: true;
    } | {
        checkVersion: {
            url: string;
            intervalSeconds?: number | undefined;
        };
        download: {
            url: string;
        };
        disabled?: false | undefined;
        manualOnly?: boolean | undefined;
    } | undefined;
    links?: {
        console?: string | undefined;
        officialWebsite?: string | undefined;
        helpDocument?: string | undefined;
        issueFeedback?: string | undefined;
        issueCreation?: string | undefined;
        mcpHelpDocument?: string | undefined;
        hooksHelpDocument?: string | undefined;
        sandboxHelpDocument?: string | undefined;
        upgradeUrl?: string | undefined;
        contactUs?: string | undefined;
        applyForTrial?: string | undefined;
        termsOfService?: string | undefined;
        privacyPolicy?: string | undefined;
        realNameAuth?: string | undefined;
        jetBrainsIDE?: string | undefined;
        codeReviewDocument?: string | undefined;
        homePage?: string | undefined;
        downloadVscodePluginUrl?: string | undefined;
        downloadJetBrainsPluginUrl?: string | undefined;
        unitTestDocument?: string | undefined;
        businessLabelWebPage?: string | undefined;
        craftFeedback?: string | undefined;
        craftShellHelpDocument?: string | undefined;
        usageLink?: string | undefined;
        planLink?: string | undefined;
        homepageLink?: string | undefined;
        accountLink?: string | undefined;
        helpLink?: string | undefined;
        contactUsLink?: string | undefined;
        billLink?: string | undefined;
        tencentGalleryBaseUrl?: string | undefined;
        chineseGalleryBaseUrl?: string | undefined;
        ruleMarketUrl?: string | undefined;
        mcpMarketUrl?: string | undefined;
        ruleDocumentUrl?: string | undefined;
        mcpDocumentUrl?: string | undefined;
        knowledgeBaseUrl?: string | undefined;
    } | undefined;
    dataLayout?: {
        legacyReadFallback?: boolean | undefined;
        configDir?: {
            userDirName?: string | undefined;
            projectDirName?: string | undefined;
        } | undefined;
        instructionFiles?: {
            baseName?: string | undefined;
        } | undefined;
    } | undefined;
    builtInMarketplaces?: Record<string, {
        source: "github";
        repo: string;
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    } | {
        url: string;
        source: "git";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    } | {
        url: string;
        source: "url";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    } | {
        url: string;
        source: "zip";
        metaUrl?: string | undefined;
        versionUrl?: string | undefined;
        autoUpdate?: boolean | undefined;
    }> | undefined;
}>;
/** V1 输入类型（schema 校验前的客户配置形态）。 */
export type ProductCustomConfigurationV1 = z.infer<typeof ProductCustomConfigurationV1Schema>;
export type ProductCustomMarketplaceItemV1 = z.infer<typeof marketplaceItemSchema>;
export {};
