import { z } from 'zod';
import { BaseTool } from './base-tool';
import { Tool, ToolResult } from './tool-protocol';
import { ToolNames } from '../../vendor/cbc-shared/node/index.js';
declare const ReportFindingsParameters: z.ZodObject<{
    findings: z.ZodArray<z.ZodObject<{
        file: z.ZodString;
        summary: z.ZodString;
        failureScenario: z.ZodString;
        category: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        file: string;
        summary: string;
        failureScenario: string;
        category?: string | undefined;
    }, {
        file: string;
        summary: string;
        failureScenario: string;
        category?: string | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    findings: {
        file: string;
        summary: string;
        failureScenario: string;
        category?: string | undefined;
    }[];
}, {
    findings: {
        file: string;
        summary: string;
        failureScenario: string;
        category?: string | undefined;
    }[];
}>;
/**
 * ReportFindings 工具（issue #74425）——让代码审查类 Agent（code-reviewer /
 * silent-failure-hunter / type-design-analyzer / comment-analyzer 等）把审查发现的
 * 问题以结构化字段（file / summary / failureScenario / 可选 category）提交，由终端 UI
 * 渲染成专门的列表组件，而不是纯文本堆在对话里。对齐 Claude Code Tools Reference 的
 * ReportFindings 章节。
 *
 * 数据契约本身与终端渲染无关，可被其他宿主（如 WorkBuddy）复用自己的 UI 消费同一份
 * 结构化数据，不需要复用本仓库的 FindingsToolCall 渲染组件。
 *
 * 默认开启：该工具不调用额外模型、不产生额度成本，与 ImageGen/VideoGen 那一档"默认关闭
 * 需 productFeature 开关"的工具不同，而是与 PushNotification 同档——仅用单层环境变量兜底，
 * 可通过 CODEBUDDY_REPORT_FINDINGS_ENABLED=false 关闭。
 *
 * 延迟加载：product.json 顶层 tools[] 给本工具设置了 deferLoading: true——默认不直接
 * 出现在模型工具列表里，需先经 ToolSearch 发现、再通过 DeferExecuteTool 间接调用。
 * 理由：该工具只在"代码审查"这一类特定场景下才会被调用（由生效的审查指令驱动，不是
 * 通用工具），常驻工具列表对绝大多数非审查会话是纯粹的体积浪费，对齐 PushNotification/
 * ImageGen 等同类工具的做法。isEnabled 只有单层 env 开关，不需要 shouldShowInToolSearch
 * （该方法只用于 ComputerUse/TeamCreate 这类存在运行时门控、索引后仍可能不可调用的场景）。
 */
export declare class ReportFindingsTool extends BaseTool implements Tool {
    name: ToolNames;
    description: string;
    parameters: z.ZodObject<{
        findings: z.ZodArray<z.ZodObject<{
            file: z.ZodString;
            summary: z.ZodString;
            failureScenario: z.ZodString;
            category: z.ZodOptional<z.ZodString>;
        }, "strip", z.ZodTypeAny, {
            file: string;
            summary: string;
            failureScenario: string;
            category?: string | undefined;
        }, {
            file: string;
            summary: string;
            failureScenario: string;
            category?: string | undefined;
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        findings: {
            file: string;
            summary: string;
            failureScenario: string;
            category?: string | undefined;
        }[];
    }, {
        findings: {
            file: string;
            summary: string;
            failureScenario: string;
            category?: string | undefined;
        }[];
    }>;
    needsApproval: boolean;
    isEnabled: () => Promise<boolean>;
    execute(input: z.infer<typeof ReportFindingsParameters>): Promise<ToolResult>;
}
export {};
