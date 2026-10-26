import { BehaviorSubject } from 'rxjs';
import { Session } from '../../vendor/cbc-core/node/index.js';
export declare const FeedbackService: unique symbol;
/**
 * Feedback 状态
 */
export type FeedbackStatus = 'idle' | 'loading' | 'opening' | 'success' | 'failed' | 'not-configured';
/**
 * Feedback 状态数据
 */
export interface FeedbackState {
    status: FeedbackStatus;
    feedbackUrl?: string;
}
/**
 * Feedback 服务接口
 */
export interface FeedbackService {
    /**
     * 状态 Subject，用于 UI 订阅
     */
    readonly stateSubject: BehaviorSubject<FeedbackState>;
    /**
     * 打开反馈页面
     * @param session 当前会话
     */
    openFeedbackPage(session: Session): Promise<void>;
    /**
     * 重置状态
     */
    reset(): void;
}
