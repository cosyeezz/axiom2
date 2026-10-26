import { type MultitaskSessionRef } from './types';
export declare const MULTITASK_SURFACE_REMINDER_ROLE = "multitask-surface";
export declare function formatOverlayOffSurfaceReminder(session: MultitaskSessionRef): string;
/**
 * 本会话开过 overlay、现在已关：下一轮要热注入站立工具面，否则模型跟着历史里的协调器目录答。
 * 切到委托 overlay 时 multitask 也会被清（epoch 增），但委托仍收窄工具面，不得宣称已恢复。
 */
export declare function shouldInjectOverlayOffSurface(session?: MultitaskSessionRef | null): boolean;
