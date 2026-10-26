/**
 * CodeBuddy Node language shim
 *
 * The single NODE_OPTIONS --require entry. It composes safe-delete hooks and
 * brokered fs hooks while keeping the historical genie-safe-delete.cjs wrapper.
 */

'use strict';

const SESSION_ID = process.env.CODEBUDDY_SESSION_ID
    || process.env.CLAUDE_SESSION_ID;

if (!SESSION_ID) {
    return;
}

if (global.__CODEBUDDY_NODE_LANGUAGE_SHIM_LOADED__) {
    return;
}
global.__CODEBUDDY_NODE_LANGUAGE_SHIM_LOADED__ = true;

const safeDeleteEnabled = process.env.CODEBUDDY_SAFE_DELETE_ENABLED !== '0';
const brokeredFsHookEnabled = process.env.CODEBUDDY_BROKERED_FS_HOOK_ENABLED === '1'
    || process.env.CODEBUDDY_SAFE_DELETE_SANDBOX === '1';

if (safeDeleteEnabled) {
    require('./node-safe-delete-shim.cjs');
}
if (brokeredFsHookEnabled) {
    try {
        require('./node-brokered-fs-shim.cjs');
    } catch (_) {
        // broker fs hook 缺失或加载失败时静默降级，不阻断进程启动
    }
}
