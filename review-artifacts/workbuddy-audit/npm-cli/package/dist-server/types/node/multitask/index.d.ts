/**
 * 唯一公开面。旧文件只准 import 这里列出的符号。
 * CompletionBus 必须 re-export，headless IoC 才装得上。
 */
export { COORDINATOR_READ_REPORT_IN_REPL, COORDINATOR_READ_REPORT_THEN_SYNTHESIZE, COORDINATOR_WAIT_FOR_NOTIFICATION, DELEGATE_MODE_META_KEY, MULTITASK_COORDINATOR_READONLY_TOOL_NAMES, MULTITASK_COORDINATOR_TOOL_NAMES, MULTITASK_MODE_META_KEY, MULTITASK_MODE_NAME, MULTITASK_ROLE_META_KEY, } from './types';
export { addDelegationLock, annotateCoordinatorTaskOutput, applyCoordinatorTaskOutput, clearDelegateSession, clearDelegationLock, hasLiveDelegation, clearMultitaskSession, findLiveMatchingTask, findMatchingTask, isLiveDelegationId, isLiveDetachedWorkerHitlTool, isLiveDetachedWorkerSession, isCoordinatorMode, isCoordinatorStanding, isDelegateMode, isMinimalStandingForMultitask, isMultitaskCoordinator, isMultitaskMode, isMultitaskWorkerOrSubagent, listCoordinatorLiveWorkers, listCoordinatorSurfaceWorkers, markWorkerSession, normalizeWorkerScopeKey, resolveLiveResume, overlayCatalogEpoch, readSurfaceEpoch, restoreCoordinatorFromStanding, sweepStaleDelegationLocks, shouldDetachCoordinatorSpawn, shouldKeepLiveDetachedWorkerHitl, shouldSkipTeamNotification, stampDelegateSession, stampMultitaskSession, } from './session-flags';
export type { CoordinatorMode } from './session-flags';
export { normalizeSubagentType } from './subagent-alias';
export { assertMultitaskProcessAllowed, MultitaskProcessNotAllowedError, normalizeMultitaskCliAgent, } from './entry-guard';
export { beginCoordinatorToolBatch, beginCoordinatorToolBatchIfIdle, DELEGATE_ALLOWED_TOOL_NAMES, DELEGATE_CODE_MODE_SANDBOX_TOOL_NAMES, DELEGATE_MODE_FORBIDDEN, evaluateCoordinatorTool, gateCoordinatorTool, gateDelegateTool, isDelegateAllowedTool, isDelegateCoordinator, holdCoordinatorToolBatch, noteCoordinatorBatchTool, shouldRevealCoordinatorToolCall, } from './coordinator-tool-policy';
export { SelfModel } from './self-model';
export { decide } from './delegation-planner';
export { applyPlannerDecision, coordinatorPlanReminder } from './planner-runtime';
export { InspectSelfTool } from './inspect-self-tool';
export { extractUserText, MultitaskCoordinatorInterceptor } from './coordinator-interceptor';
export { enterDelegateFromSlash, enterMultitaskFromSlash, leaveDelegateFromSlash, leaveMultitaskFromSlash, MINIMAL_MULTITASK_BLOCKED, toggleDelegateFromSlash, toggleMultitaskFromSlash, } from './slash-entry';
export { ACP_META_UNSOLICITED_TURN, ACP_METHOD_SESSION_SET_MULTITASK, applyDelegateFromAcp, applyMultitaskFromAcp, buildDelegateConfigOption, buildMultitaskConfigOption, buildSetMultitaskConfigOptionParams, buildSetMultitaskParams, buildUnsolicitedTurnUpdate, DELEGATE_CONFIG_OPTION_ID, findLiveSetMultitaskSession, isRemovedDelegatePermissionMode, REMOVED_DELEGATE_PERMISSION_MODE_MESSAGE, isMultitaskSessionOwnedByConnection, isMultitaskSupportAdvertised, MULTITASK_ACP_CAPABILITY_KEY, MULTITASK_CONFIG_OPTION_ID, readUnsolicitedTurn, readMultitaskConfigCurrentValue, resolveMultitaskAcpSupport, toSetMultitaskResponse, } from './host-api';
export type { CoordinatorLiveWorker } from './types';
export type { DelegateConfigOption, MultitaskConfigOption, SetMultitaskLiveLookup, SetMultitaskRequest, SetMultitaskResponse, UnsolicitedTurnAnnouncement, } from './host-api';
export { spawnDetachedNoTeam } from './spawn-detached';
export { markCoordinatorSelfStop, markCoordinatorSelfStopIfNeeded, takeCoordinatorSelfStop, } from './wakeup-gate';
export { createSandboxAgentToolCall, revealSandboxAgentResult, revealSandboxCoordinatorTool, routeCoordinatorSandboxTool, shouldRevealSandboxCoordinatorTool, } from './sandbox-reveal';
export { CompletionBus, CompletionBusImpl, MultitaskCompletionBus, MultitaskCompletionBusImpl, } from './completion-bus';
