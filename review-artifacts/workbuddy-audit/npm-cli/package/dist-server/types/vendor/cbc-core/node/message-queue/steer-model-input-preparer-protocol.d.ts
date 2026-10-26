import type { AgentInputItem } from '../../../cbc-shared/node/index.js';
import type { Session } from '../session/session-protocol';
/**
 * steer 插入点对**模型输入副本**的加工（#140576），由宿主（agent-cli）实现。
 *
 * 普通 prompt 在 run 起点由图片压缩 / 模型能力过滤拦截器处理，且只改发给模型的副本、历史保留原图；
 * steer 在 run 中途进入 RunState，不经过这些拦截器，因此在插入点用同一份实现处理，语义保持一致。
 */
export declare const SteerModelInputPreparer: unique symbol;
export interface SteerModelInputPreparer {
    /** 就地加工模型输入副本：按当前模型能力过滤图片、压缩超限图片。不得修改历史项。 */
    prepare(session: Session, items: AgentInputItem[]): Promise<void>;
}
//# sourceMappingURL=steer-model-input-preparer-protocol.d.ts.map