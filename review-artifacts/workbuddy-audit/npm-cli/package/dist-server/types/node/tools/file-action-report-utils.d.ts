import type { RunContext } from '@openai/agents';
import { CodeRatioReportingService } from '../code-ratio';
import { Session } from '../../vendor/cbc-core/node/index.js';
import { TelemetryService } from '../telemetry';
import { FileUtils } from '../utils';
/**
 * 统一四个写文件工具（edit / multi-edit / notebook / write）的埋点上报逻辑。
 *
 * 各工具只负责算出增删统计（edit/multi-edit/notebook 走局部 diff 累加，write 走全文 diff +
 * 超时行数兜底），本 helper 负责三段上报：ChatFileAction 事件 + CodeEdit 事件 + code-ratio。
 * 收敛前四个工具的 reportFileAction 近乎逐行重复。
 */
export interface ReportFileActionDeps {
    telemetryService: TelemetryService;
    codeRatioReportingService?: CodeRatioReportingService;
    toolName: string;
}
export interface ReportFileActionParams {
    context: RunContext<Session>;
    filePath: string;
    /** 仅透传给 code-ratio（服务端自行 diff）。 */
    originalContent: string;
    /** 仅透传给 code-ratio。 */
    newContent: string;
    isNewFile: boolean;
    /** 已由各工具算好的增删统计（局部累加或全文兜底）。 */
    changes: FileUtils.FileChangeStats;
}
/**
 * 发送文件编辑埋点。所有工具都给出真实数值（write 超时也用行数兜底），因此无条件上报，
 * 不再有「diff 超时占位 0 / 跳过 CodeEdit」的分支。
 */
export declare function reportFileAction(deps: ReportFileActionDeps, params: ReportFileActionParams): void;
/** 计算 searchString 在 text 中出现的次数（供 edit / multi-edit 的 replace_all 命中数放大复用）。 */
export declare function countOccurrences(text: string, searchString: string): number;
