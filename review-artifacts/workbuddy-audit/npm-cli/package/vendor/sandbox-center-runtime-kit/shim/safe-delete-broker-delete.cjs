/**
 * safe-delete broker delete helper.
 *
 * Shared by bash safe-delete wrappers and the Node safe-delete shim. Broker
 * delete is available only on macOS; other platforms report unavailable so
 * their existing local trash path remains in control.
 * Delete-specific response classification stays here; broker-ipc-client.cjs
 * only owns neutral JSON-line transport.
 *
 * CLI contract: `node safe-delete-broker-delete.cjs [--recursive] [--force] -- <path>`
 * accepts exactly one target. Callers that need to delete multiple paths must
 * loop and invoke once per path. Exit codes: 0 = ok, 1 = broker denied
 * (fail-closed), 2 = unavailable.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const brokerIpc = require('./broker-ipc-client.cjs');

let requestSeq = 0;

function buildDeleteRequest(targetPath, options = {}) {
    const command = options.command || process.env.CODEBUDDY_SANDBOX_HOST_FILE_OPERATION_COMMAND;
    const sessionId = options.sessionId || process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID;
    const toolCallId = options.toolCallId || process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID;
    const traceId = options.brokerTraceId || process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID;

    const request = {
        id: `sd-${process.pid}-${++requestSeq}`,
        runtime: options.runtime || 'bash',
        command,
        operation: 'delete',
        path: path.resolve(targetPath),
        deleteMode: 'trash',
        sessionId,
    };
    if (options.recursive === true) { request.recursive = true; }
    if (options.force === true) { request.force = true; }
    if (toolCallId) { request.toolCallId = toolCallId; }
    if (traceId) { request.brokerTraceId = traceId; }
    return request;
}

function hasBrokerDeleteEnv(options = {}) {
    if (process.platform !== 'darwin') {
        return false;
    }
    return !!(
        (options.socketPath || process.env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS)
        && (options.sessionId || process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID)
        && (options.command || process.env.CODEBUDDY_SANDBOX_HOST_FILE_OPERATION_COMMAND)
    );
}

function classifyDeleteResult(response) {
    if (response && response.ok === true) {
        return 'ok';
    }
    if (response && response.decision === 'sandbox') {
        return 'unavailable';
    }
    return 'denied';
}

function recordBrokerTrash(absPath, options = {}) {
    const reportPath = process.env.CODEBUDDY_SAFE_DELETE_REPORT_PATH;
    if (!reportPath) {
        return;
    }
    try {
        // Node supplies its writer captured before broker fs hooks are installed.
        if (typeof options.reportTrash === 'function') {
            options.reportTrash(absPath);
            return;
        }
        fs.appendFileSync(
            reportPath,
            `${JSON.stringify({
                operation: 'trash',
                runtime: options.runtime || 'bash',
                path: path.resolve(absPath),
                timestamp: Date.now(),
            })}\n`,
            'utf8',
        );
    } catch (_) {
        // Reporting is best-effort and must never change delete semantics.
    }
}

function tryBrokerDeleteSync(absPath, options = {}) {
    if (!hasBrokerDeleteEnv(options)) {
        return 'unavailable';
    }
    try {
        const response = brokerIpc.sendBrokerRequestSync(buildDeleteRequest(absPath, options), options);
        const result = classifyDeleteResult(response);
        if (result === 'ok' && response.deleteMode === 'trash' && options.reportTrash !== false) {
            recordBrokerTrash(absPath, options);
        }
        return result;
    } catch (_) {
        return 'unavailable';
    }
}

async function tryBrokerDeleteAsync(absPath, options = {}) {
    if (!hasBrokerDeleteEnv(options)) {
        return 'unavailable';
    }
    try {
        const response = await brokerIpc.sendBrokerRequest(buildDeleteRequest(absPath, options), options);
        const result = classifyDeleteResult(response);
        if (result === 'ok' && response.deleteMode === 'trash' && options.reportTrash !== false) {
            recordBrokerTrash(absPath, options);
        }
        return result;
    } catch (_) {
        return 'unavailable';
    }
}

function tryBrokerDelete(absPath, options = {}) {
    if (options.sync === false) {
        return tryBrokerDeleteAsync(absPath, options);
    }
    return tryBrokerDeleteSync(absPath, options);
}

function parseDeleteCliArgs(argv) {
    const options = {
        recursive: false,
        force: false,
    };
    const targets = [];
    let afterDashDash = false;
    for (const arg of argv) {
        if (!afterDashDash && arg === '--') {
            afterDashDash = true;
            continue;
        }
        if (!afterDashDash && arg === '--recursive') {
            options.recursive = true;
            continue;
        }
        if (!afterDashDash && arg === '--force') {
            options.force = true;
            continue;
        }
        if (!afterDashDash && arg.startsWith('-')) {
            return undefined;
        }
        targets.push(arg);
    }
    if (targets.length !== 1) {
        return undefined;
    }
    return {
        target: targets[0],
        options,
    };
}

async function runDeleteCli(argv = process.argv.slice(2)) {
    const parsed = parseDeleteCliArgs(argv);
    if (!parsed) {
        process.stderr.write('[safe-delete-broker] expected exactly one target path\n');
        return 2;
    }

    const result = await tryBrokerDelete(parsed.target, {
        runtime: 'bash',
        recursive: parsed.options.recursive,
        force: parsed.options.force,
        sync: false,
    });
    if (result === 'ok') {
        return 0;
    }
    if (result === 'denied') {
        process.stderr.write(`[safe-delete-broker] denied: path=${parsed.target}\n`);
        return 1;
    }
    return 2;
}

module.exports = {
    buildDeleteRequest,
    classifyDeleteResult,
    tryBrokerDelete,
    runDeleteCli,
};

if (require.main === module) {
    runDeleteCli().then(
        code => process.exit(code),
        error => {
            process.stderr.write(`[safe-delete-broker] unavailable: ${error && error.message ? error.message : error}\n`);
            process.exit(2);
        },
    );
}
