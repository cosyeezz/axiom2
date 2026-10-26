/**
 * CodeBuddy Node brokered fs shim
 *
 * Loaded by node-language-shim.cjs. Installs brokered file-token and host-op hooks.
 */

'use strict';

// Broker 只存在于 macOS。即使旧进程把 Broker 环境变量带到其它平台，也不能
// 加载或 monkey-patch fs，避免非 macOS 进入一条无效的 Broker 运行时。
if (process.platform !== 'darwin') {
    return;
}

const fs = require('fs');
const path = require('path');
const url = require('url');
const brokerIpc = require('./broker-ipc-client.cjs');

const SESSION_ID = process.env.CODEBUDDY_SESSION_ID
    || process.env.CLAUDE_SESSION_ID;

if (!SESSION_ID) {
    return;
}

const BROKERED_FS_HOOK_ENABLED = process.env.CODEBUDDY_BROKERED_FS_HOOK_ENABLED === '1'
    || process.env.CODEBUDDY_SAFE_DELETE_SANDBOX === '1';

if (!BROKERED_FS_HOOK_ENABLED) {
    return;
}

if (global.__CODEBUDDY_NODE_BROKERED_FS_SHIM_LOADED__) {
    return;
}
global.__CODEBUDDY_NODE_BROKERED_FS_SHIM_LOADED__ = true;

const PLATFORM = process.platform; // 'darwin' | 'win32' | 'linux' | ...
const NATIVE_DELETE_DIAGNOSTICS_ENABLED = PLATFORM === 'darwin'
    && process.env.CODEBUDDY_SAFE_DELETE_ENABLED === '0';
const BROKER_HOST_OP_DEFAULT_TIMEOUT_MS = 5_000;
const BROKER_FILE_READ_DEFAULT_TIMEOUT_MS = 125_000;
const MKDIR_RESULT_CACHE_TTL_MS = 1_000;
const MAX_MKDIR_RESULT_CACHE_ENTRIES = 4096;
const SHIM_DIR = __dirname;
const BROKER_FALLBACK_DEBUG = process.env.CODEBUDDY_SANDBOX_BROKER_DEBUG === '1';
let brokerRequestSeq = 0;
let brokerNativeAddonLoaded = false;
/**
 * @typedef {object} BrokerNativeAddon
 * @property {(token: string) => bigint | number} consumeSandboxExtension
 * @property {(socketPath: string, line: string, timeoutMs: number) => string} requestBrokerSync
 */
/** @type {BrokerNativeAddon | undefined} */
let brokerNativeAddon;
const mkdirResultCache = new Map();

// broker 连接失败会静默退化为原生 fs 调用（fail-open）。默认不打印，避免污染被
// hook 的任意子进程的 stdout/stderr；排查问题时可设 CODEBUDDY_SANDBOX_BROKER_DEBUG=1 开启。
function logBrokerFallback(kind, operation, filePath, error) {
    if (!BROKER_FALLBACK_DEBUG) { return; }
    const reason = error && error.message ? error.message : String(error);
    process.stderr.write(`[CodeBuddy][brokered-fs] fallback to native fs: kind=${kind} operation=${operation} path=${filePath == null ? '' : filePath} reason=${reason}\n`);
}

// 保存原始引用（必须在所有 patch 之前）
const origMkdirSync = fs.mkdirSync.bind(fs);
const origRenameSync = fs.renameSync.bind(fs);
const origCopyFileSync = fs.copyFileSync.bind(fs);
const origCpSync = fs.cpSync ? fs.cpSync.bind(fs) : null;
const origChmodSync = fs.chmodSync.bind(fs);
const origLinkSync = fs.linkSync.bind(fs);
const origSymlinkSync = fs.symlinkSync.bind(fs);
const origExistsSync = fs.existsSync.bind(fs);
const origLstatSync = fs.lstatSync.bind(fs);
const origRealpathSync = fs.realpathSync.native
    ? fs.realpathSync.native.bind(fs.realpathSync)
    : fs.realpathSync.bind(fs);

const origMkdir = fs.mkdir.bind(fs);
const origRename = fs.rename.bind(fs);
const origCopyFile = fs.copyFile.bind(fs);
const origCp = fs.cp ? fs.cp.bind(fs) : null;
const origChmod = fs.chmod.bind(fs);
const origLink = fs.link.bind(fs);
const origSymlink = fs.symlink.bind(fs);

const origPromisesMkdir = fs.promises ? fs.promises.mkdir.bind(fs.promises) : null;
const origPromisesRename = fs.promises ? fs.promises.rename.bind(fs.promises) : null;
const origPromisesCopyFile = fs.promises ? fs.promises.copyFile.bind(fs.promises) : null;
const origPromisesCp = fs.promises && fs.promises.cp ? fs.promises.cp.bind(fs.promises) : null;
const origPromisesChmod = fs.promises ? fs.promises.chmod.bind(fs.promises) : null;
const origPromisesLink = fs.promises ? fs.promises.link.bind(fs.promises) : null;
const origPromisesSymlink = fs.promises ? fs.promises.symlink.bind(fs.promises) : null;

const origOpenSync = fs.openSync.bind(fs);
const origReadFileSync = fs.readFileSync.bind(fs);
const origWriteFileSync = fs.writeFileSync.bind(fs);
const origAppendFileSync = fs.appendFileSync.bind(fs);
const origCreateReadStream = fs.createReadStream.bind(fs);
const origCreateWriteStream = fs.createWriteStream.bind(fs);
const origUnlinkSync = fs.unlinkSync.bind(fs);
const origRmSync = fs.rmSync ? fs.rmSync.bind(fs) : null;
const origRmdirSync = fs.rmdirSync ? fs.rmdirSync.bind(fs) : null;

const origOpen = fs.open.bind(fs);
const origReadFile = fs.readFile.bind(fs);
const origWriteFile = fs.writeFile.bind(fs);
const origAppendFile = fs.appendFile.bind(fs);
const origUnlink = fs.unlink.bind(fs);
const origRm = fs.rm ? fs.rm.bind(fs) : null;
const origRmdir = fs.rmdir ? fs.rmdir.bind(fs) : null;

const origPromisesOpen = fs.promises ? fs.promises.open.bind(fs.promises) : null;
const origPromisesReadFile = fs.promises ? fs.promises.readFile.bind(fs.promises) : null;
const origPromisesWriteFile = fs.promises ? fs.promises.writeFile.bind(fs.promises) : null;
const origPromisesAppendFile = fs.promises ? fs.promises.appendFile.bind(fs.promises) : null;
const origPromisesUnlink = fs.promises ? fs.promises.unlink.bind(fs.promises) : null;
const origPromisesRm = fs.promises && fs.promises.rm ? fs.promises.rm.bind(fs.promises) : null;
const origPromisesRmdir = fs.promises && fs.promises.rmdir ? fs.promises.rmdir.bind(fs.promises) : null;

/**
 * 将 fs API 的 filePath 参数转为绝对路径。
 * 处理 URL 对象（如 new URL('file:///tmp/x')），避免 String(URL) 产生无效路径绕过 shim。
 * @param {string|Buffer|URL} filePath
 * @returns {string} 绝对路径
 */
function toAbsPath(filePath) {
    if (filePath instanceof URL) {
        return url.fileURLToPath(filePath);
    }
    // 防御跨 VM context 的 URL 对象（instanceof 跨 realm 返回 false）
    if (filePath && typeof filePath === 'object' && filePath.href && typeof filePath.protocol === 'string') {
        return url.fileURLToPath(filePath);
    }
    return path.resolve(String(filePath));
}


function isBrokerHostOperationEnabled() {
    return PLATFORM === 'darwin'
        && BROKERED_FS_HOOK_ENABLED
        && !!process.env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS
        && !!process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID
        && !!process.env.CODEBUDDY_SANDBOX_HOST_FILE_OPERATION_COMMAND;
}

function loadBrokerNativeAddon() {
    if (process.env.CODEBUDDY_SANDBOX_NATIVE_ADDON_DISABLED === '1') {
        return undefined;
    }
    if (brokerNativeAddonLoaded) {
        return brokerNativeAddon;
    }
    brokerNativeAddonLoaded = true;

    const candidates = [
        process.env.CODEBUDDY_SANDBOX_NATIVE_ADDON_PATH,
        path.join(__dirname, 'native', `${process.platform}-${process.arch}`, 'brokered-sandbox-native.node'),
        path.join(__dirname, 'native', 'brokered-sandbox-native.node'),
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            const loaded = require(candidate);
            if (loaded
                && typeof loaded.consumeSandboxExtension === 'function'
                && typeof loaded.requestBrokerSync === 'function') {
                brokerNativeAddon = loaded;
                return brokerNativeAddon;
            }
        } catch (_) {
            // Optional native support. Without it, token-based Node fs access falls back to the OS sandbox.
        }
    }
    return undefined;
}

function isBrokerFileTokenEnabled() {
    return PLATFORM === 'darwin'
        && BROKERED_FS_HOOK_ENABLED
        && !!process.env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS
        && !!process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID
        && !!process.env.CODEBUDDY_SANDBOX_FILE_TOKEN_OPERATION_COMMAND
        && !!loadBrokerNativeAddon();
}

function brokerTimeoutMs() {
    return brokerIpc.brokerTimeoutMs ? brokerIpc.brokerTimeoutMs() : BROKER_HOST_OP_DEFAULT_TIMEOUT_MS;
}

function brokerFileTokenTimeoutMs() {
    const configuredReadTimeout = Number.parseInt(process.env.CODEBUDDY_SANDBOX_BROKER_READ_TIMEOUT_MS || '', 10);
    const readTimeout = Number.isFinite(configuredReadTimeout) && configuredReadTimeout > 0
        ? configuredReadTimeout
        : BROKER_FILE_READ_DEFAULT_TIMEOUT_MS;
    return Math.max(brokerTimeoutMs(), readTimeout);
}

function buildBrokerHostOperationRequest(operation, fields) {
    const request = {
        id: `node-${process.pid}-${++brokerRequestSeq}`,
        runtime: 'node',
        command: process.env.CODEBUDDY_SANDBOX_HOST_FILE_OPERATION_COMMAND || 'sandbox.broker.file_operation',
        operation,
        sessionId: process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID || SESSION_ID,
        ...fields,
    };
    if (process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID) {
        request.toolCallId = process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID;
    }
    if (process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID) {
        request.brokerTraceId = process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID;
    }
    return request;
}

function buildBrokerFileTokenRequest(operation, filePath) {
    const request = {
        id: `node-${process.pid}-${++brokerRequestSeq}`,
        runtime: 'node',
        command: process.env.CODEBUDDY_SANDBOX_FILE_TOKEN_OPERATION_COMMAND || 'sandbox.broker.file_token',
        operation,
        path: toAbsPath(filePath),
        sessionId: process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID || SESSION_ID,
    };
    if (process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID) {
        request.toolCallId = process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID;
    }
    if (process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID) {
        request.brokerTraceId = process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID;
    }
    return request;
}

function buildBrokerFileWriteCompletedRequest(filePath) {
    const request = {
        id: `node-${process.pid}-${++brokerRequestSeq}`,
        runtime: 'node',
        command: 'sandbox.broker.file_write_completed',
        operation: 'write',
        path: toAbsPath(filePath),
        sessionId: process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID || SESSION_ID,
    };
    if (process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID) {
        request.toolCallId = process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID;
    }
    if (process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID) {
        request.brokerTraceId = process.env.CODEBUDDY_SANDBOX_BROKER_TRACE_ID;
    }
    return request;
}

function createBrokerPolicyError(response) {
    const message = response && response.error
        ? String(response.error)
        : `Brokered Node host operation refused: ${response && response.operation ? response.operation : 'unknown'}`;
    const error = new Error(message);
    error.code = 'CODEBUDDY_BROKER_DENY';
    error.decision = response && response.decision;
    error.path = response && response.path;
    error.operation = response && response.operation;
    error.__codebuddyBrokerPolicyError = true;
    return error;
}

/**
 * 策略已放行（decision=host-op）但宿主代执行失败：这是普通文件系统错误，
 * 不是策略拒绝。按协议返回的结构化 errorCode 还原 errno 语义，让调用方能像
 * 处理本地 fs 错误一样处理（例如 EEXIST 视为“目录已存在”）。
 */
function createBrokerHostOperationError(response) {
    const message = response && response.error
        ? String(response.error)
        : `Brokered Node host operation failed: ${response && response.operation ? response.operation : 'unknown'}`;
    const error = new Error(message);
    error.code = (response && response.errorCode) || 'EIO';
    error.syscall = response && response.operation;
    error.path = response && response.path;
    error.decision = response && response.decision;
    error.__codebuddyBrokerHostOperationError = true;
    return error;
}

function createBrokerOutcomeUnknownError(error) {
    const message = error && error.message ? error.message : String(error);
    const outcomeError = new Error(`Broker request outcome unknown: ${message}`);
    outcomeError.code = 'CODEBUDDY_BROKER_OUTCOME_UNKNOWN';
    outcomeError.cause = error;
    return outcomeError;
}

function handleBrokerHostOperationResponse(response) {
    if (response && response.ok === true) {
        return true;
    }
    if (response && response.decision === 'sandbox') {
        return false;
    }
    if (response && response.ok === false && response.decision === 'host-op') {
        throw createBrokerHostOperationError(response);
    }
    throw createBrokerPolicyError(response);
}

function handleBrokerFileTokenResponse(response) {
    if (response && response.ok === true && typeof response.token === 'string' && response.token) {
        const nativeAddon = loadBrokerNativeAddon();
        if (!nativeAddon) {
            return false;
        }
        nativeAddon.consumeSandboxExtension(response.token);
        return true;
    }
    if (response && response.decision === 'sandbox') {
        return false;
    }
    throw createBrokerPolicyError(response);
}

function parseBrokerHostOperationResponse(line) {
    return brokerIpc.parseBrokerResponse(line);
}

function requestBrokerHostOperation(request) {
    if (request.command === 'sandbox.broker.file_write_completed') {
        return brokerIpc.sendBrokerRequest(request, {
            queuePriority: 'normal',
            queueEvictLowerPriority: true,
        });
    }
    return brokerIpc.sendBrokerRequest(request, {
        queuePriority: 'low',
        queueEvictable: true,
    });
}

function isPathLikeFileAccessTarget(filePath) {
    return typeof filePath !== 'number';
}

function existedBeforeWrite(filePath) {
    if (!isPathLikeFileAccessTarget(filePath)) {
        return true;
    }
    try {
        return origExistsSync(toAbsPath(filePath));
    } catch (_) {
        return true;
    }
}

function isUnderShimDir(absPath) {
    const rel = path.relative(SHIM_DIR, absPath);
    return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

// Avoid broker file-token interception while require() reads sibling shim modules.
function shouldBypassBrokerFileToken(operation, filePath) {
    return operation === 'read'
        && isPathLikeFileAccessTarget(filePath)
        && isUnderShimDir(toAbsPath(filePath));
}

function tryBrokerFileTokenSync(operation, filePath) {
    if (!isPathLikeFileAccessTarget(filePath)
        || shouldBypassBrokerFileToken(operation, filePath)
        || !isBrokerFileTokenEnabled()) {
        return false;
    }
    const request = buildBrokerFileTokenRequest(operation, filePath);
    const response = brokerIpc.sendBrokerRequestSync(request, {
        nativeAddon: loadBrokerNativeAddon(),
        timeoutMs: brokerFileTokenTimeoutMs(operation),
    });
    return handleBrokerFileTokenResponse(response);
}

async function tryBrokerFileToken(operation, filePath) {
    if (!isPathLikeFileAccessTarget(filePath)
        || shouldBypassBrokerFileToken(operation, filePath)
        || !isBrokerFileTokenEnabled()) {
        return false;
    }
    const request = buildBrokerFileTokenRequest(operation, filePath);
    return handleBrokerFileTokenResponse(await brokerIpc.sendBrokerRequest(request, {
        timeoutMs: brokerFileTokenTimeoutMs(operation),
        queuePriority: 'high',
        queueEvictLowerPriority: true,
    }));
}

function isBrokerFileWriteCompletedEnabled(filePath) {
    return PLATFORM === 'darwin'
        && BROKERED_FS_HOOK_ENABLED
        && isPathLikeFileAccessTarget(filePath)
        && !!process.env.CODEBUDDY_SANDBOX_BROKER_IPC_ADDRESS
        && !!process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID;
}

function notifyBrokerFileWriteCompletedSync(filePath, existedBefore) {
    if (existedBefore) {
        return;
    }
    if (!isBrokerFileWriteCompletedEnabled(filePath)) {
        return;
    }
    try {
        requestBrokerHostOperationSync(buildBrokerFileWriteCompletedRequest(filePath));
    } catch (error) {
        logBrokerFallback('file-write-completed-sync', 'write', filePath, error);
    }
}

async function notifyBrokerFileWriteCompleted(filePath, existedBefore) {
    if (existedBefore) {
        return;
    }
    if (!isBrokerFileWriteCompletedEnabled(filePath)) {
        return;
    }
    try {
        await requestBrokerHostOperation(buildBrokerFileWriteCompletedRequest(filePath));
    } catch (error) {
        logBrokerFallback('file-write-completed', 'write', filePath, error);
    }
}

function requestBrokerHostOperationSync(request) {
    return brokerIpc.sendBrokerRequestSync(request, { nativeAddon: loadBrokerNativeAddon() });
}

function existingDirectoryIdentity(filePath) {
    try {
        const stat = origLstatSync(filePath);
        if (!stat.isDirectory() || stat.isSymbolicLink()) {
            return undefined;
        }
        return `${origRealpathSync(filePath)}\0${stat.dev}\0${stat.ino}`;
    } catch (_) {
        return undefined;
    }
}

function mkdirResultCacheKey(fields) {
    return JSON.stringify([
        process.env.CODEBUDDY_SANDBOX_BROKER_SESSION_ID || SESSION_ID || '',
        process.env.CODEBUDDY_SANDBOX_BROKER_TOOL_CALL_ID || '',
        fields.path,
        fields.recursive === true,
        fields.mode ?? null,
    ]);
}

function monotonicNowMs() {
    const [seconds, nanoseconds] = process.hrtime();
    return seconds * 1_000 + nanoseconds / 1_000_000;
}

function prepareMkdirResultCache(operation, fields) {
    if (operation !== 'mkdir' || !fields || !fields.path) {
        return undefined;
    }
    const key = mkdirResultCacheKey(fields);
    const identity = existingDirectoryIdentity(fields.path);
    const cached = mkdirResultCache.get(key);
    if (!cached) {
        return { key, identity };
    }
    if (!identity || identity !== cached.identity || cached.expiresAt <= monotonicNowMs()) {
        mkdirResultCache.delete(key);
        return { key, identity };
    }
    mkdirResultCache.delete(key);
    mkdirResultCache.set(key, cached);
    return { key, identity, response: cached.response };
}

function isCacheableMkdirResponse(fields, response) {
    if (!response || response.operation !== 'mkdir' || response.decision !== 'host-op'
        || response.approvedByUser === true || response.policyReason !== undefined) {
        return false;
    }
    try {
        const matchedRule = JSON.parse(response.matchedRuleJson);
        if (typeof matchedRule?.pattern !== 'string' || !matchedRule.pattern) {
            return false;
        }
    } catch (_) {
        return false;
    }
    if (fields.recursive === true) {
        return response.ok === true;
    }
    return response.ok === false && (response.errorCode === 'EEXIST'
        || /^EEXIST(?::|$)/.test(String(response.error || '')));
}

function rememberMkdirResult(cacheState, fields, response) {
    if (!cacheState || !cacheState.identity || !isCacheableMkdirResponse(fields, response)
        || existingDirectoryIdentity(fields.path) !== cacheState.identity) {
        return;
    }
    mkdirResultCache.delete(cacheState.key);
    mkdirResultCache.set(cacheState.key, {
        identity: cacheState.identity,
        response,
        expiresAt: monotonicNowMs() + MKDIR_RESULT_CACHE_TTL_MS,
    });
    if (mkdirResultCache.size > MAX_MKDIR_RESULT_CACHE_ENTRIES) {
        mkdirResultCache.delete(mkdirResultCache.keys().next().value);
    }
}

function tryBrokerHostOperationSync(operation, fields) {
    if (!isBrokerHostOperationEnabled()) {
        return false;
    }
    const cacheState = prepareMkdirResultCache(operation, fields);
    const request = buildBrokerHostOperationRequest(operation, fields);
    try {
        const response = cacheState && cacheState.response
            ? cacheState.response
            : requestBrokerHostOperationSync(request);
        if (!cacheState?.response) {
            rememberMkdirResult(cacheState, fields, response);
        }
        return handleBrokerHostOperationResponse(response);
    } catch (error) {
        if (error && (error.__codebuddyBrokerPolicyError || error.__codebuddyBrokerHostOperationError)) {
            throw error;
        }
        if (error && error.brokerRequestSent) {
            throw createBrokerOutcomeUnknownError(error);
        }
        logBrokerFallback('host-op-sync', operation, fields && (fields.path || fields.to || fields.from), error);
        return false;
    }
}

async function tryBrokerHostOperation(operation, fields) {
    if (!isBrokerHostOperationEnabled()) {
        return false;
    }
    const cacheState = prepareMkdirResultCache(operation, fields);
    const request = buildBrokerHostOperationRequest(operation, fields);
    try {
        const response = cacheState && cacheState.response
            ? cacheState.response
            : await requestBrokerHostOperation(request);
        if (!cacheState?.response) {
            rememberMkdirResult(cacheState, fields, response);
        }
        return handleBrokerHostOperationResponse(response);
    } catch (error) {
        if (error && (error.__codebuddyBrokerPolicyError || error.__codebuddyBrokerHostOperationError)) {
            throw error;
        }
        if (error && error.brokerRequestSent) {
            throw createBrokerOutcomeUnknownError(error);
        }
        logBrokerFallback('host-op', operation, fields && (fields.path || fields.to || fields.from), error);
        return false;
    }
}

function normalizeMode(mode) {
    if (typeof mode === 'number' && Number.isFinite(mode)) {
        return mode;
    }
    if (typeof mode === 'string' && mode.trim()) {
        const parsed = Number.parseInt(mode, 8);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function normalizeMkdirOptions(options) {
    if (typeof options === 'number' || typeof options === 'string') {
        return { mode: normalizeMode(options) };
    }
    if (options && typeof options === 'object') {
        return {
            recursive: !!options.recursive,
            mode: normalizeMode(options.mode),
        };
    }
    return {};
}

function brokerOperationForOpenFlags(flags) {
    const value = flags === undefined ? 'r' : flags;
    if (typeof value === 'number') {
        const constants = fs.constants || {};
        const writeMask = (constants.O_WRONLY || 0)
            | (constants.O_RDWR || 0)
            | (constants.O_CREAT || 0)
            | (constants.O_TRUNC || 0)
            | (constants.O_APPEND || 0);
        return (value & writeMask) ? 'write' : 'read';
    }
    const text = String(value);
    return /[wa+]/.test(text) ? 'write' : 'read';
}

function buildMkdirBrokerFields(filePath, options) {
    const normalized = normalizeMkdirOptions(options);
    return {
        path: toAbsPath(filePath),
        recursive: normalized.recursive,
        ...(normalized.mode !== undefined ? { mode: normalized.mode } : {}),
    };
}

function shouldBrokerCopyFileMode(mode) {
    return mode === undefined || mode === 0;
}

function isSimpleCpOptions(options) {
    if (options === undefined) {
        return true;
    }
    if (!options || typeof options !== 'object') {
        return false;
    }
    return Object.keys(options).every(key => key === 'recursive');
}


// ----- brokered file tokens（当前 Node 进程消费 sandbox token 后继续原生 fs）-----

// Node's readFileSync/writeFileSync/appendFileSync/writeFile/appendFile may call
// the exported fs.openSync/fs.open (depending on data type and encoding). The
// outer wrapper has already requested the token for the same path, so nested
// opens issued synchronously inside it must not request another one.
let suppressOpenInstrumentationDepth = 0;

function callWithoutOpenInstrumentation(fn) {
    suppressOpenInstrumentationDepth++;
    try {
        return fn();
    } finally {
        suppressOpenInstrumentationDepth--;
    }
}

function wrappedOpenSync(filePath, flags, mode) {
    if (suppressOpenInstrumentationDepth > 0) {
        return origOpenSync(filePath, flags, mode);
    }
    tryBrokerFileTokenSync(brokerOperationForOpenFlags(flags), filePath);
    return origOpenSync(filePath, flags, mode);
}

function wrappedOpen(filePath, flags, mode, callback) {
    const originalArgs = Array.prototype.slice.call(arguments);
    if (suppressOpenInstrumentationDepth > 0) {
        return origOpen(...originalArgs);
    }
    let openFlags = flags;
    let cb = callback;
    if (typeof flags === 'function') {
        openFlags = undefined;
        cb = flags;
    } else if (typeof mode === 'function') {
        cb = mode;
    }
    if (typeof cb !== 'function') {
        return origOpen(...originalArgs);
    }
    tryBrokerFileToken(brokerOperationForOpenFlags(openFlags), filePath)
        .then(() => origOpen(...originalArgs))
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesOpen(filePath, flags, mode) {
    await tryBrokerFileToken(brokerOperationForOpenFlags(flags), filePath);
    return origPromisesOpen(filePath, flags, mode);
}

function wrappedReadFileSync(filePath, options) {
    tryBrokerFileTokenSync('read', filePath);
    return callWithoutOpenInstrumentation(() => origReadFileSync(filePath, options));
}

function wrappedReadFile(filePath, options, callback) {
    const originalArgs = Array.prototype.slice.call(arguments);
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb !== 'function') {
        return origReadFile(...originalArgs);
    }
    tryBrokerFileToken('read', filePath)
        .then(() => origReadFile(...originalArgs))
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesReadFile(filePath, options) {
    await tryBrokerFileToken('read', filePath);
    return origPromisesReadFile(filePath, options);
}

// Node's real appendFileSync/appendFile implementations delegate internally to
// fs.writeFileSync/fs.writeFile (the same mutable exported properties this shim
// patches), so a naive append wrapper that also instruments would double-fire
// the broker token/write-completed calls. This depth counter lets the write
// wrappers detect "we're already inside an append call we instrumented" and
// fall back to the un-instrumented original, regardless of whether a given
// Node version happens to implement append via delegation or not.
let suppressWriteInstrumentationDepth = 0;

function wrappedWriteFileSync(filePath, data, options) {
    if (suppressWriteInstrumentationDepth > 0) {
        return origWriteFileSync(filePath, data, options);
    }
    const existedBefore = existedBeforeWrite(filePath);
    tryBrokerFileTokenSync('write', filePath);
    const result = callWithoutOpenInstrumentation(() => origWriteFileSync(filePath, data, options));
    notifyBrokerFileWriteCompletedSync(filePath, existedBefore);
    return result;
}

function wrappedWriteFile(filePath, data, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb !== 'function') {
        return origWriteFile.apply(fs, arguments);
    }
    if (suppressWriteInstrumentationDepth > 0) {
        return origWriteFile.apply(fs, arguments);
    }
    const existedBefore = existedBeforeWrite(filePath);
    const wrappedCallback = error => {
        if (error) {
            cb(error);
            return;
        }
        void notifyBrokerFileWriteCompleted(filePath, existedBefore);
        cb(null);
    };
    tryBrokerFileToken('write', filePath)
        .then(() => callWithoutOpenInstrumentation(() => {
            if (typeof options === 'function') {
                origWriteFile(filePath, data, wrappedCallback);
            } else {
                origWriteFile(filePath, data, options, wrappedCallback);
            }
        }))
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesWriteFile(filePath, data, options) {
    const existedBefore = existedBeforeWrite(filePath);
    await tryBrokerFileToken('write', filePath);
    const result = await origPromisesWriteFile(filePath, data, options);
    void notifyBrokerFileWriteCompleted(filePath, existedBefore);
    return result;
}

function wrappedAppendFileSync(filePath, data, options) {
    const existedBefore = existedBeforeWrite(filePath);
    tryBrokerFileTokenSync('write', filePath);
    suppressWriteInstrumentationDepth++;
    let result;
    try {
        result = callWithoutOpenInstrumentation(() => origAppendFileSync(filePath, data, options));
    } finally {
        suppressWriteInstrumentationDepth--;
    }
    notifyBrokerFileWriteCompletedSync(filePath, existedBefore);
    return result;
}

function wrappedAppendFile(filePath, data, options, callback) {
    const cb = typeof options === 'function' ? options : callback;
    if (typeof cb !== 'function') {
        return origAppendFile.apply(fs, arguments);
    }
    const existedBefore = existedBeforeWrite(filePath);
    const wrappedCallback = error => {
        if (error) {
            cb(error);
            return;
        }
        void notifyBrokerFileWriteCompleted(filePath, existedBefore);
        cb(null);
    };
    tryBrokerFileToken('write', filePath)
        .then(() => {
            suppressWriteInstrumentationDepth++;
            try {
                callWithoutOpenInstrumentation(() => {
                    if (typeof options === 'function') {
                        origAppendFile(filePath, data, wrappedCallback);
                    } else {
                        origAppendFile(filePath, data, options, wrappedCallback);
                    }
                });
            } finally {
                suppressWriteInstrumentationDepth--;
            }
        })
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesAppendFile(filePath, data, options) {
    const existedBefore = existedBeforeWrite(filePath);
    await tryBrokerFileToken('write', filePath);
    const result = await origPromisesAppendFile(filePath, data, options);
    void notifyBrokerFileWriteCompleted(filePath, existedBefore);
    return result;
}

function wrappedCreateReadStream(filePath, options) {
    tryBrokerFileTokenSync('read', filePath);
    return origCreateReadStream(filePath, options);
}

function wrappedCreateWriteStream(filePath, options) {
    tryBrokerFileTokenSync('write', filePath);
    return origCreateWriteStream(filePath, options);
}

// ----- native delete denial diagnostics（safe-delete 关闭时供 sandbox fallback 回查）-----

function emitNativeDeleteDenial(filePath, error) {
    if (!error || error.code !== 'EPERM') {
        return;
    }
    try {
        process.stderr.write(`node: ${toAbsPath(error.path ?? filePath)}: Operation not permitted\n`);
    } catch (_) {
        // 诊断失败不能覆盖原始删除异常。
    }
}

function wrapDeleteSync(deleteFn, filePath, args) {
    try {
        return deleteFn(...args);
    } catch (error) {
        emitNativeDeleteDenial(filePath, error);
        throw error;
    }
}

function wrappedUnlinkSync(filePath) {
    return wrapDeleteSync(origUnlinkSync, filePath, arguments);
}

function wrappedRmSync(filePath) {
    return wrapDeleteSync(origRmSync, filePath, arguments);
}

function wrappedRmdirSync(filePath) {
    return wrapDeleteSync(origRmdirSync, filePath, arguments);
}

function wrapDeleteCallback(deleteFn, filePath, args, callbackIndex) {
    const callback = args[callbackIndex];
    if (typeof callback !== 'function') {
        return deleteFn(...args);
    }
    args[callbackIndex] = error => {
        emitNativeDeleteDenial(filePath, error);
        callback(error);
    };
    return deleteFn(...args);
}

function wrappedUnlink(filePath, callback) {
    return wrapDeleteCallback(origUnlink, filePath, [filePath, callback], 1);
}

function wrappedRm(filePath, options, callback) {
    if (typeof options === 'function') {
        return wrapDeleteCallback(origRm, filePath, [filePath, options], 1);
    }
    return wrapDeleteCallback(origRm, filePath, [filePath, options, callback], 2);
}

function wrappedRmdir(filePath, options, callback) {
    if (typeof options === 'function') {
        return wrapDeleteCallback(origRmdir, filePath, [filePath, options], 1);
    }
    return wrapDeleteCallback(origRmdir, filePath, [filePath, options, callback], 2);
}

async function wrapDeletePromise(deleteFn, filePath, args) {
    try {
        return await deleteFn(...args);
    } catch (error) {
        emitNativeDeleteDenial(filePath, error);
        throw error;
    }
}

function wrappedPromisesUnlink(filePath) {
    return wrapDeletePromise(origPromisesUnlink, filePath, arguments);
}

function wrappedPromisesRm(filePath) {
    return wrapDeletePromise(origPromisesRm, filePath, arguments);
}

function wrappedPromisesRmdir(filePath) {
    return wrapDeletePromise(origPromisesRmdir, filePath, arguments);
}

// ----- brokered host operations（非删除类文件变更）-----

function wrappedMkdirSync(filePath, options) {
    if (tryBrokerHostOperationSync('mkdir', buildMkdirBrokerFields(filePath, options))) {
        return undefined;
    }
    return origMkdirSync(filePath, options);
}

function wrappedMkdir(filePath, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof options === 'function') {
        opts = undefined;
        cb = options;
    }
    if (typeof cb !== 'function') {
        return origMkdir(filePath, options, callback);
    }
    tryBrokerHostOperation('mkdir', buildMkdirBrokerFields(filePath, opts))
        .then(handled => {
            if (handled) {
                process.nextTick(() => cb(null));
                return;
            }
            origMkdir(filePath, options, callback);
        })
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesMkdir(filePath, options) {
    if (await tryBrokerHostOperation('mkdir', buildMkdirBrokerFields(filePath, options))) {
        return undefined;
    }
    return origPromisesMkdir(filePath, options);
}

function wrappedRenameSync(from, to) {
    if (tryBrokerHostOperationSync('rename', { from: toAbsPath(from), to: toAbsPath(to) })) {
        return undefined;
    }
    return origRenameSync(from, to);
}

function wrappedRename(from, to, callback) {
    if (typeof callback !== 'function') {
        return origRename(from, to, callback);
    }
    tryBrokerHostOperation('rename', { from: toAbsPath(from), to: toAbsPath(to) })
        .then(handled => {
            if (handled) {
                process.nextTick(() => callback(null));
                return;
            }
            origRename(from, to, callback);
        })
        .catch(error => process.nextTick(() => callback(error)));
    return undefined;
}

async function wrappedPromisesRename(from, to) {
    if (await tryBrokerHostOperation('rename', { from: toAbsPath(from), to: toAbsPath(to) })) {
        return undefined;
    }
    return origPromisesRename(from, to);
}

function wrappedCopyFileSync(from, to, mode) {
    if (shouldBrokerCopyFileMode(mode)
        && tryBrokerHostOperationSync('copy', { from: toAbsPath(from), to: toAbsPath(to), recursive: false })) {
        return undefined;
    }
    return origCopyFileSync(from, to, mode);
}

function wrappedCopyFile(from, to, mode, callback) {
    let copyMode = mode;
    let cb = callback;
    if (typeof mode === 'function') {
        copyMode = undefined;
        cb = mode;
    }
    if (typeof cb !== 'function' || !shouldBrokerCopyFileMode(copyMode)) {
        return origCopyFile(from, to, mode, callback);
    }
    tryBrokerHostOperation('copy', { from: toAbsPath(from), to: toAbsPath(to), recursive: false })
        .then(handled => {
            if (handled) {
                process.nextTick(() => cb(null));
                return;
            }
            origCopyFile(from, to, mode, callback);
        })
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesCopyFile(from, to, mode) {
    if (shouldBrokerCopyFileMode(mode)
        && await tryBrokerHostOperation('copy', { from: toAbsPath(from), to: toAbsPath(to), recursive: false })) {
        return undefined;
    }
    return origPromisesCopyFile(from, to, mode);
}

function wrappedCpSync(from, to, options) {
    if (isSimpleCpOptions(options)
        && tryBrokerHostOperationSync('copy', { from: toAbsPath(from), to: toAbsPath(to), recursive: !!(options && options.recursive) })) {
        return undefined;
    }
    return origCpSync(from, to, options);
}

function wrappedCp(from, to, options, callback) {
    let opts = options;
    let cb = callback;
    if (typeof options === 'function') {
        opts = undefined;
        cb = options;
    }
    if (typeof cb !== 'function' || !isSimpleCpOptions(opts)) {
        return origCp(from, to, options, callback);
    }
    tryBrokerHostOperation('copy', { from: toAbsPath(from), to: toAbsPath(to), recursive: !!(opts && opts.recursive) })
        .then(handled => {
            if (handled) {
                process.nextTick(() => cb(null));
                return;
            }
            origCp(from, to, options, callback);
        })
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesCp(from, to, options) {
    if (isSimpleCpOptions(options)
        && await tryBrokerHostOperation('copy', { from: toAbsPath(from), to: toAbsPath(to), recursive: !!(options && options.recursive) })) {
        return undefined;
    }
    return origPromisesCp(from, to, options);
}

function wrappedChmodSync(filePath, mode) {
    const normalizedMode = normalizeMode(mode);
    if (normalizedMode !== undefined
        && tryBrokerHostOperationSync('chmod', { path: toAbsPath(filePath), mode: normalizedMode })) {
        return undefined;
    }
    return origChmodSync(filePath, mode);
}

function wrappedChmod(filePath, mode, callback) {
    const normalizedMode = normalizeMode(mode);
    if (typeof callback !== 'function' || normalizedMode === undefined) {
        return origChmod(filePath, mode, callback);
    }
    tryBrokerHostOperation('chmod', { path: toAbsPath(filePath), mode: normalizedMode })
        .then(handled => {
            if (handled) {
                process.nextTick(() => callback(null));
                return;
            }
            origChmod(filePath, mode, callback);
        })
        .catch(error => process.nextTick(() => callback(error)));
    return undefined;
}

async function wrappedPromisesChmod(filePath, mode) {
    const normalizedMode = normalizeMode(mode);
    if (normalizedMode !== undefined
        && await tryBrokerHostOperation('chmod', { path: toAbsPath(filePath), mode: normalizedMode })) {
        return undefined;
    }
    return origPromisesChmod(filePath, mode);
}

function wrappedLinkSync(from, to) {
    if (tryBrokerHostOperationSync('link', { from: toAbsPath(from), to: toAbsPath(to), symbolic: false })) {
        return undefined;
    }
    return origLinkSync(from, to);
}

function wrappedLink(from, to, callback) {
    if (typeof callback !== 'function') {
        return origLink(from, to, callback);
    }
    tryBrokerHostOperation('link', { from: toAbsPath(from), to: toAbsPath(to), symbolic: false })
        .then(handled => {
            if (handled) {
                process.nextTick(() => callback(null));
                return;
            }
            origLink(from, to, callback);
        })
        .catch(error => process.nextTick(() => callback(error)));
    return undefined;
}

async function wrappedPromisesLink(from, to) {
    if (await tryBrokerHostOperation('link', { from: toAbsPath(from), to: toAbsPath(to), symbolic: false })) {
        return undefined;
    }
    return origPromisesLink(from, to);
}

function wrappedSymlinkSync(from, to, type) {
    if (tryBrokerHostOperationSync('link', { from: String(from), to: toAbsPath(to), symbolic: true })) {
        return undefined;
    }
    return origSymlinkSync(from, to, type);
}

function wrappedSymlink(from, to, type, callback) {
    let linkType = type;
    let cb = callback;
    if (typeof type === 'function') {
        linkType = undefined;
        cb = type;
    }
    if (typeof cb !== 'function') {
        return origSymlink(from, to, type, callback);
    }
    tryBrokerHostOperation('link', { from: String(from), to: toAbsPath(to), symbolic: true })
        .then(handled => {
            if (handled) {
                process.nextTick(() => cb(null));
                return;
            }
            origSymlink(from, to, linkType, cb);
        })
        .catch(error => process.nextTick(() => cb(error)));
    return undefined;
}

async function wrappedPromisesSymlink(from, to, type) {
    if (await tryBrokerHostOperation('link', { from: String(from), to: toAbsPath(to), symbolic: true })) {
        return undefined;
    }
    return origPromisesSymlink(from, to, type);
}


// ---------------------------------------------------------------------------
// 安装 brokered fs patch
// ---------------------------------------------------------------------------

fs.openSync = wrappedOpenSync;
fs.readFileSync = wrappedReadFileSync;
fs.writeFileSync = wrappedWriteFileSync;
fs.appendFileSync = wrappedAppendFileSync;
fs.createReadStream = wrappedCreateReadStream;
fs.createWriteStream = wrappedCreateWriteStream;
if (NATIVE_DELETE_DIAGNOSTICS_ENABLED) {
    fs.unlinkSync = wrappedUnlinkSync;
    if (origRmSync) fs.rmSync = wrappedRmSync;
    if (origRmdirSync) fs.rmdirSync = wrappedRmdirSync;
    fs.unlink = wrappedUnlink;
    if (origRm) fs.rm = wrappedRm;
    if (origRmdir) fs.rmdir = wrappedRmdir;
}

fs.open = wrappedOpen;
fs.readFile = wrappedReadFile;
fs.writeFile = wrappedWriteFile;
fs.appendFile = wrappedAppendFile;
fs.mkdirSync = wrappedMkdirSync;
fs.renameSync = wrappedRenameSync;
fs.copyFileSync = wrappedCopyFileSync;
if (origCpSync) fs.cpSync = wrappedCpSync;
fs.chmodSync = wrappedChmodSync;
fs.linkSync = wrappedLinkSync;
fs.symlinkSync = wrappedSymlinkSync;

fs.mkdir = wrappedMkdir;
fs.rename = wrappedRename;
fs.copyFile = wrappedCopyFile;
if (origCp) fs.cp = wrappedCp;
fs.chmod = wrappedChmod;
fs.link = wrappedLink;
fs.symlink = wrappedSymlink;

if (fs.promises) {
    fs.promises.open = wrappedPromisesOpen;
    fs.promises.readFile = wrappedPromisesReadFile;
    fs.promises.writeFile = wrappedPromisesWriteFile;
    fs.promises.appendFile = wrappedPromisesAppendFile;
    if (NATIVE_DELETE_DIAGNOSTICS_ENABLED) {
        fs.promises.unlink = wrappedPromisesUnlink;
        if (origPromisesRm) fs.promises.rm = wrappedPromisesRm;
        if (origPromisesRmdir) fs.promises.rmdir = wrappedPromisesRmdir;
    }
    fs.promises.mkdir = wrappedPromisesMkdir;
    fs.promises.rename = wrappedPromisesRename;
    fs.promises.copyFile = wrappedPromisesCopyFile;
    if (origPromisesCp) fs.promises.cp = wrappedPromisesCp;
    fs.promises.chmod = wrappedPromisesChmod;
    fs.promises.link = wrappedPromisesLink;
    fs.promises.symlink = wrappedPromisesSymlink;
}

try {
    require('module').syncBuiltinESMExports?.();
} catch (_) {
    // Best-effort only. CommonJS fs patching above remains active.
}
