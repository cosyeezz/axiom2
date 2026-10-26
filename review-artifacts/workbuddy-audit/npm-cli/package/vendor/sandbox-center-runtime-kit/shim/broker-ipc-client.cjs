/**
 * Neutral broker IPC client for vendor shims.
 *
 * Owns JSON-line socket transport only. Runtime-specific request semantics and
 * response classification stay in the caller. Broker transport is macOS-only;
 * other platforms receive a sandbox response without opening a socket.
 */

'use strict';

const net = require('net');
const { spawnSync } = require('child_process');

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_CONCURRENT_REQUESTS = 128;
const MAX_CONCURRENT_ASYNC_REQUESTS = MAX_CONCURRENT_REQUESTS - 1;
const MAX_QUEUED_REQUESTS = 8192;
const MAX_FRAME_BYTES = 1024 * 1024;
const BROKER_PROTOCOL_VERSION = 1;
const BROKER_DATA_COMMANDS = Object.freeze({
    HostFileOperation: 'sandbox.broker.file_operation',
    FileTokenRequest: 'sandbox.broker.file_token',
    FileWriteCompleted: 'sandbox.broker.file_write_completed',
    CheckProgramPolicy: 'sandbox.broker.program_check',
});
const REQUEST_QUEUE_PRIORITIES = Object.freeze({ low: 0, normal: 1, high: 2 });
let activeAsyncRequests = 0;
let queuedRequestCount = 0;
let brokerWireSequence = 0;
const requestWaiters = [new Set(), new Set(), new Set()];

function unsupportedPlatformResponse() {
    return {
        ok: false,
        decision: 'sandbox',
        reason: 'broker_unsupported_platform',
    };
}

function requestTimeoutError() {
    const error = new Error('Broker request timed out');
    error.code = 'CODEBUDDY_BROKER_TIMEOUT';
    return error;
}

function requestQueueTimeoutError() {
    const error = new Error('Broker request timed out while waiting for an IPC slot');
    error.code = 'CODEBUDDY_BROKER_QUEUE_TIMEOUT';
    error.brokerRequestSent = false;
    return error;
}

function requestQueueFullError() {
    const error = new Error('Broker request queue is full');
    error.code = 'CODEBUDDY_BROKER_QUEUE_FULL';
    error.brokerRequestSent = false;
    return error;
}

function requestQueueEvictedError() {
    const error = new Error('Broker request was evicted from the queue by a higher-priority request');
    error.code = 'CODEBUDDY_BROKER_QUEUE_EVICTED';
    error.brokerRequestSent = false;
    return error;
}

function requestQueuePriority(priority) {
    return Object.hasOwn(REQUEST_QUEUE_PRIORITIES, priority)
        ? REQUEST_QUEUE_PRIORITIES[priority]
        : REQUEST_QUEUE_PRIORITIES.normal;
}

function removeRequestWaiter(waiter) {
    if (!requestWaiters[waiter.priority].delete(waiter)) {
        return false;
    }
    queuedRequestCount--;
    return true;
}

function evictLowerPriorityRequest(priority) {
    for (let candidatePriority = REQUEST_QUEUE_PRIORITIES.low; candidatePriority < priority; candidatePriority++) {
        for (const waiter of requestWaiters[candidatePriority]) {
            if (!waiter.evictable || !removeRequestWaiter(waiter)) { continue; }
            waiter.reject(requestQueueEvictedError());
            return true;
        }
    }
    return false;
}

function acquireRequestSlot(timeoutMs, options) {
    if (activeAsyncRequests < MAX_CONCURRENT_ASYNC_REQUESTS) {
        activeAsyncRequests++;
        return Promise.resolve();
    }
    const priority = requestQueuePriority(options.queuePriority);
    if (queuedRequestCount >= MAX_QUEUED_REQUESTS
        && (!options.queueEvictLowerPriority || !evictLowerPriorityRequest(priority))) {
        return Promise.reject(requestQueueFullError());
    }
    return new Promise((resolve, reject) => {
        const waiter = {
            priority,
            evictable: options.queueEvictable === true,
            resolve: () => {
                clearTimeout(waiter.timer);
                resolve();
            },
            reject: error => {
                clearTimeout(waiter.timer);
                reject(error);
            },
        };
        waiter.timer = setTimeout(() => {
            if (!removeRequestWaiter(waiter)) { return; }
            waiter.reject(requestQueueTimeoutError());
        }, timeoutMs);
        requestWaiters[priority].add(waiter);
        queuedRequestCount++;
    });
}

function releaseRequestSlot() {
    for (let priority = REQUEST_QUEUE_PRIORITIES.high; priority >= REQUEST_QUEUE_PRIORITIES.low; priority--) {
        const next = requestWaiters[priority].values().next().value;
        if (next && removeRequestWaiter(next)) {
            next.resolve();
            return;
        }
    }
    activeAsyncRequests--;
}

function brokerTimeoutMs() {
    const parsed = Number.parseInt(process.env.CODEBUDDY_SANDBOX_BROKER_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function brokerSocketPath() {
    return process.env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS;
}

function brokerProtocolContext(options = {}) {
    const capability = options.capability || process.env.CODEBUDDY_SANDBOX_BROKER_CAPABILITY;
    const executionAttemptId = options.executionAttemptId || process.env.CODEBUDDY_SANDBOX_BROKER_EXECUTION_ATTEMPT_ID;
    if (options.disableProtocolContext === true) {
        return undefined;
    }
    if (!capability || !executionAttemptId) {
        return undefined;
    }
    return {
        capability,
        executionAttemptId,
        runtime: options.runtime || process.env.CODEBUDDY_SANDBOX_BROKER_RUNTIME || 'unknown',
    };
}

function nextBrokerWireId(prefix) {
    brokerWireSequence++;
    return `broker-${prefix}-${process.pid}-${brokerWireSequence}`;
}

function resolveBrokerDataCommand(request) {
    return BROKER_DATA_COMMANDS[request && request.command] || request.command;
}

function buildBrokerProtocolRequest(request, context) {
    const command = resolveBrokerDataCommand(request);
    const requestId = String(request && (request.id || request.requestId) || nextBrokerWireId('request'));
    const data = { ...request, requestId };
    delete data.id;
    delete data.command;
    delete data.sessionId;
    delete data.toolCallId;
    delete data.brokerTraceId;
    if (command === 'sandbox.broker.program_check') {
        if (!data.command && data.program) {
            data.command = data.program;
        }
        delete data.program;
        if (!Array.isArray(data.argv)) {
            data.argv = [];
        }
    }
    return {
        messageId: nextBrokerWireId('request'),
        command,
        executionAttemptId: context.executionAttemptId,
        data,
    };
}

function buildBrokerHandshake(context) {
    return {
        messageId: nextBrokerWireId('handshake'),
        command: 'sandbox.broker.handshake',
        capability: context.capability,
        executionAttemptId: context.executionAttemptId,
        data: {
            capability: context.capability,
            executionAttemptId: context.executionAttemptId,
            protocolVersion: BROKER_PROTOCOL_VERSION,
            runtime: context.runtime,
        },
    };
}

function unwrapBrokerProtocolResponse(response) {
    if (response && response.success !== true) {
        const error = new Error(response && response.error ? String(response.error) : 'Broker request failed');
        error.code = 'CODEBUDDY_BROKER_PROTOCOL_ERROR';
        throw error;
    }
    return response && response.data && typeof response.data === 'object' ? response.data : {};
}

function validateBrokerHandshakeResponse(response) {
    if (response && response.success !== true) {
        throw new Error(response && response.error ? String(response.error) : 'Broker handshake rejected');
    }
    const data = response && response.data;
    if (!data || data.accepted !== true || data.protocolVersion !== BROKER_PROTOCOL_VERSION) {
        throw new Error('Broker handshake rejected');
    }
}

function parseBrokerResponse(line) {
    try {
        return JSON.parse(String(line || '').trim());
    } catch (error) {
        throw new Error(`Invalid broker response: ${error && error.message ? error.message : error}`);
    }
}

function markBrokerRequestState(error, requestSent) {
    const brokerError = error instanceof Error ? error : new Error(String(error));
    brokerError.brokerRequestSent = requestSent;
    return brokerError;
}

function nativeSyncErrorMayHaveBeenSent(error) {
    const message = error && error.message ? error.message : String(error);
    return ![
        'requestBrokerSync requires socketPath and line',
        'socket failed:',
        'setsockopt timeout failed:',
        'broker socket path is too long',
        'connect failed:',
    ].some(prefix => message.startsWith(prefix));
}

async function sendBrokerRequestDirect(request, options = {}) {
    if (process.platform !== 'darwin') {
        return unsupportedPlatformResponse();
    }
    const socketPath = options.socketPath || brokerSocketPath();
    const timeoutMs = options.timeoutMs || brokerTimeoutMs();
    if (!socketPath) {
        throw markBrokerRequestState(new Error('Broker socket unavailable'), false);
    }

    const startedAt = Date.now();
    await acquireRequestSlot(timeoutMs, options);
    try {
        const remainingTimeoutMs = timeoutMs - (Date.now() - startedAt);
        if (remainingTimeoutMs <= 0) {
            throw requestQueueTimeoutError();
        }
        const context = brokerProtocolContext(options);
        const protocolRequest = context ? buildBrokerProtocolRequest(request, context) : undefined;
        const line = JSON.stringify(protocolRequest || request);
        return await new Promise((resolve, reject) => {
            let settled = false;
            let requestSent = false;
            let buffer = '';
            let handshakeComplete = !context;
            const socket = net.createConnection(socketPath);
            const finish = (error, response) => {
                if (settled) { return; }
                settled = true;
                clearTimeout(timer);
                socket.once('close', () => {
                    if (error) { reject(markBrokerRequestState(error, requestSent)); } else { resolve(response); }
                });
                socket.destroy();
            };
            const timer = setTimeout(() => finish(requestTimeoutError()), remainingTimeoutMs);

            socket.setEncoding('utf8');
            socket.on('connect', () => {
                requestSent = true;
                if (context) {
                    socket.write(`${JSON.stringify(buildBrokerHandshake(context))}\n`);
                } else {
                    socket.write(`${line}\n`);
                }
            });
            socket.on('data', chunk => {
                buffer += chunk;
                if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) {
                    finish(new Error('Broker response exceeded frame limit'));
                    return;
                }
                let newlineIndex;
                while (!settled && (newlineIndex = buffer.indexOf('\n')) !== -1) {
                    const responseLine = buffer.slice(0, newlineIndex);
                    buffer = buffer.slice(newlineIndex + 1);
                    try {
                        const response = parseBrokerResponse(responseLine);
                        if (context && !handshakeComplete) {
                            validateBrokerHandshakeResponse(response);
                            handshakeComplete = true;
                            socket.write(`${line}\n`);
                        } else {
                            finish(undefined, context ? unwrapBrokerProtocolResponse(response) : response);
                        }
                    } catch (error) {
                        finish(error);
                    }
                }
            });
            socket.on('error', error => finish(error));
            socket.on('end', () => {
                if (!settled) {
                    finish(new Error('Broker closed without a response'));
                }
            });
        });
    } finally {
        releaseRequestSlot();
    }
}

async function sendBrokerRequest(request, options = {}) {
    return sendBrokerRequestDirect(request, options);
}

function sendBrokerRequestSyncDirect(request, options = {}) {
    if (process.platform !== 'darwin') {
        return unsupportedPlatformResponse();
    }
    const socketPath = options.socketPath || brokerSocketPath();
    if (!socketPath) {
        throw markBrokerRequestState(new Error('Broker socket unavailable'), false);
    }

    const timeoutMs = options.timeoutMs || brokerTimeoutMs();
    const context = brokerProtocolContext(options);
    const line = JSON.stringify(request);
    const nativeAddon = options.nativeAddon;
    if (context && nativeAddon && typeof nativeAddon.requestBrokerSyncWithHandshake === 'function') {
        try {
            const handshakeLine = JSON.stringify(buildBrokerHandshake(context));
            const requestLine = JSON.stringify(buildBrokerProtocolRequest(request, context));
            const responses = nativeAddon.requestBrokerSyncWithHandshake(
                socketPath,
                handshakeLine,
                requestLine,
                timeoutMs,
                responseLine => {
                    validateBrokerHandshakeResponse(parseBrokerResponse(responseLine));
                    return true;
                },
            );
            if (!Array.isArray(responses) || responses.length !== 2) {
                throw new Error('Invalid native broker handshake response');
            }
            validateBrokerHandshakeResponse(parseBrokerResponse(responses[0]));
            return unwrapBrokerProtocolResponse(parseBrokerResponse(responses[1]));
        } catch (error) {
            throw markBrokerRequestState(error, nativeSyncErrorMayHaveBeenSent(error));
        }
    }
    if (!context && nativeAddon && typeof nativeAddon.requestBrokerSync === 'function') {
        try {
            return parseBrokerResponse(nativeAddon.requestBrokerSync(socketPath, line, timeoutMs));
        } catch (error) {
            throw markBrokerRequestState(error, nativeSyncErrorMayHaveBeenSent(error));
        }
    }

    const nodeBin = process.env.CODEBUDDY_NODE_BIN || process.execPath;
    const childEnv = { ...process.env };
    delete childEnv.NODE_OPTIONS;
    if (context) {
        childEnv.CODEBUDDY_SANDBOX_BROKER_CAPABILITY = context.capability;
        childEnv.CODEBUDDY_SANDBOX_BROKER_EXECUTION_ATTEMPT_ID = context.executionAttemptId;
        childEnv.CODEBUDDY_SANDBOX_BROKER_RUNTIME = context.runtime;
    } else {
        delete childEnv.CODEBUDDY_SANDBOX_BROKER_CAPABILITY;
        delete childEnv.CODEBUDDY_SANDBOX_BROKER_EXECUTION_ATTEMPT_ID;
        delete childEnv.CODEBUDDY_SANDBOX_BROKER_RUNTIME;
    }
    if (childEnv.CODEBUDDY_NODE_RUN_AS_NODE === '1') {
        childEnv.ELECTRON_RUN_AS_NODE = '1';
    }
    const result = spawnSync(nodeBin, [
        __filename,
        '__request-sync',
        socketPath,
        line,
        String(timeoutMs),
    ], {
        encoding: 'utf8',
        timeout: timeoutMs + 1_000,
        windowsHide: true,
        env: childEnv,
    });

    if (result.error) {
        const requestSent = !['ENOENT', 'EACCES', 'ENOEXEC'].includes(result.error.code);
        throw markBrokerRequestState(result.error, requestSent);
    }
    if (result.status !== 0) {
        throw markBrokerRequestState(
            new Error((result.stderr || '').trim() || `Broker sync helper exited with ${result.status}`),
            result.status !== 3 && result.status !== 123,
        );
    }
    try {
        return parseBrokerResponse(result.stdout);
    } catch (error) {
        throw markBrokerRequestState(error, true);
    }
}

function sendBrokerRequestSync(request, options = {}) {
    return sendBrokerRequestSyncDirect(request, options);
}

function runSyncRequestCli(argv) {
    const [, , mode, socketPath, line, timeoutValue] = argv;
    if (mode !== '__request-sync') {
        process.stderr.write('[broker-ipc-client] unsupported mode\n');
        process.exit(2);
    }
    if (process.platform !== 'darwin') {
        process.stdout.write(JSON.stringify(unsupportedPlatformResponse()));
        process.exit(0);
    }
    const timeoutMs = Number.parseInt(timeoutValue || '', 10) || DEFAULT_TIMEOUT_MS;
    const context = brokerProtocolContext();
    const request = JSON.parse(line);
    const protocolRequest = context ? buildBrokerProtocolRequest(request, context) : undefined;
    const requestLine = JSON.stringify(protocolRequest || request);
    let settled = false;
    let requestSent = false;
    let buffer = '';
    let handshakeComplete = !context;
    const socket = net.createConnection(socketPath);
    const finish = (code, message) => {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        if (message) {
            (code === 0 ? process.stdout : process.stderr).write(message);
        }
        process.exit(code);
    };
    const timer = setTimeout(() => finish(requestSent ? 124 : 123, 'Broker request timed out'), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect', () => {
        requestSent = true;
        if (context) {
            socket.write(`${JSON.stringify(buildBrokerHandshake(context))}\n`);
        } else {
            socket.write(`${requestLine}\n`);
        }
    });
    socket.on('data', chunk => {
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES) {
            finish(1, 'Broker response exceeded frame limit');
            return;
        }
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
            const responseLine = buffer.slice(0, newlineIndex);
            buffer = buffer.slice(newlineIndex + 1);
            try {
                const response = parseBrokerResponse(responseLine);
                if (context && !handshakeComplete) {
                    validateBrokerHandshakeResponse(response);
                    handshakeComplete = true;
                    socket.write(`${requestLine}\n`);
                    continue;
                }
                finish(0, context ? JSON.stringify(unwrapBrokerProtocolResponse(response)) : responseLine);
                break;
            } catch (error) {
                finish(1, error && error.message ? error.message : String(error));
                break;
            }
        }
    });
    socket.on('error', error => finish(requestSent ? 1 : 3, error && error.message ? error.message : String(error)));
    socket.on('end', () => finish(2, 'Broker closed without a response'));
}

module.exports = {
    brokerTimeoutMs,
    parseBrokerResponse,
    sendBrokerRequest,
    sendBrokerRequestSync,
};

if (require.main === module) {
    runSyncRequestCli(process.argv);
}
