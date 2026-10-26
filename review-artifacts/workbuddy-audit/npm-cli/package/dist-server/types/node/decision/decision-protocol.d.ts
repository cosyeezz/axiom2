/**
 * Decision（判断）能力协议
 *
 * 对一段输入一次性提交多个封闭式问题，同步返回每个问题的概率、选项或评分，以及
 * token 用量。支持三类问题：`predicate`（是/否概率）、`choice`（单选）、
 * `score`（有序档位评分）。
 *
 * ## 协议
 *
 * 直接采用后端的 **OpenAI Decisions 兼容入口** `POST {endpoint}/v2/chat/decisions`，
 * 请求与响应均为 OpenAI Decisions 原生形状——本层**不做字段翻译**。
 *
 * ```
 * 能力层  Decision       ← 本模块（OpenAI Decisions 协议）
 * 模型层  jev-decision   ← 默认模型，经 model 参数指定
 * ```
 *
 * 后端另有 jev 原生协议入口 `/v2/systemone`（`state` + questions map，模型名
 * `jev`），两者背后是同一个上游模型、计费口径相同，但**模型名与端点不可混用**
 * （混用返回 400 `model type [...] does not match endpoint [...]`）。本模块只走
 * `/v2/chat/decisions`；仅当需要结构化 `state` 或 `noul.criteria` 时才需考虑原生入口。
 *
 * 接口文档：https://iwiki.woa.com/p/4047924209
 * 技术方案见 `docs/agent-cli/decision-design.md`。
 */
import type { Session } from '../../vendor/cbc-core/node/index.js';
/** DI token */
export declare const DecisionService: unique symbol;
/**
 * 默认判断模型。
 *
 * `/v2/chat/decisions` 端点只接受 `jev-decision`；传 `jev`（原生入口的模型名）会被
 * 后端以 400 拒绝。
 */
export declare const DEFAULT_DECISION_MODEL = "jev-decision";
/** 单条内容 part；当前只支持文本（jev 不支持图片，传 input_image 会 400） */
export interface DecisionContentPart {
    type: 'input_text';
    text: string;
}
/** 一条 user 消息 */
export interface DecisionMessage {
    /** 只能是 `user` */
    role: 'user';
    /** 只能是 `message`，可省略 */
    type?: 'message';
    /** 字符串即一段文本；数组时每个元素是一个 part */
    content: string | DecisionContentPart[];
}
/**
 * 所有问题共用的判断依据。
 *
 * 可以是纯文本，也可以是 user 消息数组（多轮对话、正文加补充上下文等）。
 * 所有文本片段按出现顺序拼成一份多段文本交给模型。**至少要有一段非空白文本。**
 */
export type DecisionInput = string | DecisionMessage[];
/** `choice` 的候选项 */
export interface DecisionChoice {
    /**
     * 选项值。答案里的 `choice` 一定是其中之一且**保持原始类型**（传布尔返回布尔）。
     * 同一题内不能重复——字符串 `'true'` 与布尔 `true` 也算重复。
     */
    value: string | boolean;
    /** 该选项在什么情况下适用。把选项边界写清楚可明显提高准确率 */
    description?: string;
}
/** `score` 的档位 */
export interface DecisionLevel {
    /** 档位名称，答案中原样返回 */
    label: string;
    /** 这一档的判定条件。描述越具体，相邻档位越不容易混淆 */
    description?: string;
}
/**
 * 一个封闭式问题。
 *
 * `name` **不会发给模型**，只用来把答案与问题对上；判断意图、背景与规则必须完整
 * 写进 `instructions`。虽然协议上可选，但强烈建议显式命名：不传时服务端用
 * `q<下标>` 作为内部标识，若另一题恰好显式命名为 `q1` 会因重名被拒。
 */
export type DecisionQuestion = 
/** 是/否判断：返回陈述为真的概率。写成可判真假的陈述或是非问句 */
{
    type: 'predicate';
    name?: string;
    instructions: string;
}
/** 单选：从候选项中选一个 */
 | {
    type: 'choice';
    name?: string;
    instructions: string;
    choices: DecisionChoice[];
}
/** 有序档位评分：档位按从低到高排列，数组下标即档位编号。最多 {@link MAX_SCORE_LEVELS} 档 */
 | {
    type: 'score';
    name?: string;
    instructions: string;
    levels: DecisionLevel[];
};
/** `score` 的档位数上限；超过时上游拒绝（400 / 11133） */
export declare const MAX_SCORE_LEVELS = 10;
/** 判断请求参数 */
export interface DecisionParams {
    /** 所有问题共用的判断依据 */
    input: DecisionInput;
    /** 判断问题列表，至少 1 个。**答案按本数组的顺序返回** */
    questions: DecisionQuestion[];
    /** 判断模型，缺省 {@link DEFAULT_DECISION_MODEL} */
    model?: string;
    /** 为兼容 OpenAI 协议而接收，当前后端不生效 */
    safety_identifier?: string;
}
/** `choice` 答案里的单项概率 */
export interface DecisionChoiceProbability {
    value: string | boolean;
    probability: number;
}
/** `score` 答案里的单档概率 */
export interface DecisionLevelProbability {
    /** 档位编号，从 0 开始 */
    value: number;
    /** 请求中该档位的 `label`，原样返回 */
    label: string;
    probability: number;
}
/**
 * 单个问题的答案，按 `type` 区分形态。
 *
 * `answers[i]` 对应请求的 `questions[i]`；`name` 为请求中该问题的 `name`，
 * 未命名时为 `null`。
 */
export type DecisionAnswer = {
    type: 'predicate';
    name: string | null;
    /**
     * 0~1，陈述为真的概率。接近 1 是强「是」，接近 0 是强「否」，0.5 左右为不确定。
     * 该类型**没有** `confidence`。
     */
    probability: number;
} | {
    type: 'choice';
    name: string | null;
    /** 概率最高的选项值，类型与请求中的 `value` 一致 */
    choice: string | boolean;
    /** 各选项概率，**按请求中 `choices` 的顺序排列**，和约等于 1 */
    probabilities: DecisionChoiceProbability[];
    /** 0~1，由概率分布算出的确定程度；分布越集中值越高 */
    confidence: number;
} | {
    type: 'score';
    name: string | null;
    /** 档位编号按概率加权的平均值，**可能落在两个档位之间** */
    score: number;
    /** 各档位概率，按档位顺序排列 */
    probabilities: DecisionLevelProbability[];
    confidence: number;
};
/** token 用量与积分消耗 */
export interface DecisionUsage {
    /** 输入 token 数，含 `input`、各题 `instructions` 以及选项/档位文本 */
    input_tokens: number;
    /** 输出 token 数，按模型实际值返回；**不计费** */
    output_tokens: number;
    total_tokens?: number;
    /** 为兼容 OpenAI 结构保留，各项恒为 0 */
    input_tokens_details?: {
        cached_tokens: number;
        cache_write_tokens: number;
    };
    /** 为兼容 OpenAI 结构保留，各项恒为 0 */
    output_tokens_details?: {
        reasoning_tokens: number;
    };
    /**
     * 积分消耗展示值，保留 2 位小数；计费配置可用时才出现。
     *
     * 注意**计费只算输入 token**。小用量会四舍五入显示 `0`——不代表免费，
     * 实际扣费由服务端计费链路单独结算。
     */
    credit?: number;
}
/** 判断结果 */
export interface DecisionResult {
    /** 请求 ID（= `X-Request-ID`），便于溯源 */
    id: string;
    /** 服务端完成时间，Unix 秒 */
    created?: number;
    /** 固定为 `decision.answers.done` */
    type?: string;
    /** 请求中传入的模型名 */
    model: string;
    /** 每个问题的答案，**顺序与请求的 `questions` 一致** */
    answers: DecisionAnswer[];
    usage?: DecisionUsage;
    /** 后端返回的实际积分消耗；缺失表示后端未返回 */
    credit?: number;
}
/** 单次判断调用的可选项 */
export interface DecisionJudgeOptions {
    /** 取消信号 */
    abortSignal?: AbortSignal;
    /**
     * 限流类错误（HTTP 429 / 529）的退避重试次数，默认 0（不重试）。
     *
     * 判断请求计费，盲目重试会放大费用，故默认关闭；仅对未产生有效计费的限流类
     * 错误重试，业务错误与 5xx 一律不重试。高频路径（如 ToolSearch 精排）应显式开启。
     */
    retryOnRateLimit?: number;
}
/**
 * Decision 判断服务。
 *
 * 签名直接收 `Session`（而非 image/video 那样的 `RunContext<Session>`）：服务真正
 * 依赖的只是 Session（用于构造会话归因头）与一个取消信号，调用方按需从上下文传入。
 */
export interface DecisionService {
    judge(params: DecisionParams, session: Session, options?: DecisionJudgeOptions): Promise<DecisionResult>;
}
