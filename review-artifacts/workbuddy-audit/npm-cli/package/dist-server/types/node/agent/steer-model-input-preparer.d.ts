import { type Session, SteerModelInputPreparer } from '../../vendor/cbc-core/node/index.js';
import type { AgentInputItem } from '../../vendor/cbc-shared/node/index.js';
import { Logger } from '@genie/telemetry';
/**
 * steer 插入点的模型输入加工（#140576）：与 ImageFilter / ImageCompression 拦截器同一实现，
 * 只作用于模型输入副本，历史保留原图。
 */
export declare class SteerModelInputPreparerImpl implements SteerModelInputPreparer {
    protected readonly logger: Logger;
    prepare(session: Session, items: AgentInputItem[]): Promise<void>;
}
