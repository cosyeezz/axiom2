// @tencent-ai/agent-cli/server — CJS entry. import 零副作用：运行时 bundle
// 的装载期效果（内核 env 预设、凭据 env 清空）随 bundle 一起推迟到首个动词
// 调用（memoized 同步 require——subscribe 是同步签名，装载必须同步）。灰度
// 双链路的隔离边界因此是「不调用」而非「不 require」：spawn 车道 pod 顶层
// 引入本入口是惰性安全的。值导出来自 dist-server/lite 零依赖小产物，与
// bundle 内联副本的宇称由 scripts/verify-server-export.cjs 断言。
//
// 进程全局封印的权威层在本 facade：基线在 require bundle 之前采集——必须在
// bundle 外，bundle 内首 import 采基线曾因 rspack 拼接序翻转失效（实测判例
// 2026-08-20）。装载完成（含失败路径）即还原：剥离装载期新增的进程监听器、
// 重挂被移除的基线监听器（shim 会整体置换 'warning' 通道）、还原
// process.emitWarning / globalThis.require / win32 child_process 七方法。
// 宿主装载前注册的处理器在基线内不动，装载后注册的发生在还原之后同样不动。
// bundle 内 server/process-seal.ts 保留为第二层。
'use strict';
const childProcess = require('node:child_process');

const CHILD_PROCESS_METHODS = ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork', 'execSync', 'exec'];

function captureProcessBaseline() {
    return {
        listeners: new Map(process.eventNames().map(name => [name, [...process.rawListeners(name)]])),
        emitWarning: process.emitWarning,
        globalRequire: globalThis.require,
        childProcess: new Map(CHILD_PROCESS_METHODS.map(name => [name, childProcess[name]])),
    };
}

function restoreProcessBaseline(baseline) {
    const names = new Set([...process.eventNames(), ...baseline.listeners.keys()]);
    for (const name of names) {
        const base = baseline.listeners.get(name) ?? [];
        const current = process.rawListeners(name);
        for (const listener of current) {
            if (!base.includes(listener)) {
                process.removeListener(name, listener);
            }
        }
        for (const listener of base) {
            if (!current.includes(listener)) {
                process.on(name, listener);
            }
        }
    }
    if (process.emitWarning !== baseline.emitWarning) {
        process.emitWarning = baseline.emitWarning;
    }
    if (globalThis.require !== baseline.globalRequire) {
        globalThis.require = baseline.globalRequire;
    }
    for (const [name, fn] of baseline.childProcess) {
        if (childProcess[name] !== fn) {
            childProcess[name] = fn;
        }
    }
}

let impl;
const load = () => {
    if (!impl) {
        const baseline = captureProcessBaseline();
        try {
            const trace = globalThis.__CODEBUDDY_STARTUP_PROFILER__;
            const loadBundle = () => require('./dist-server/codebuddy.js');
            impl = trace ? trace.measure('agent.kernel-module-load', 'Agent kernel module evaluation', loadBundle) : loadBundle();
        } finally {
            restoreProcessBaseline(baseline);
        }
    }
    return impl;
};
const forward = name => (...args) => load()[name](...args);

module.exports = {
    start: forward('start'),
    hasSessionWork: forward('hasSessionWork'),
    notifyConfigChange: forward('notifyConfigChange'),
    readSession: forward('readSession'),
    readSessionCatalog: forward('readSessionCatalog'),
    createSession: forward('createSession'),
    query: forward('query'),
    recover: forward('recover'),
    reload: forward('reload'),
    setSecurityReviewConfig: forward('setSecurityReviewConfig'),
    steer: forward('steer'),
    rewind: forward('rewind'),
    interrupt: forward('interrupt'),
    cancelBackgroundTask: forward('cancelBackgroundTask'),
    listBackgroundTasks: forward('listBackgroundTasks'),
    getBackgroundTask: forward('getBackgroundTask'),
    cancelTask: forward('cancelTask'),
    subscribe: forward('subscribe'),
    close: forward('close'),
    sandboxFromDriver: forward('sandboxFromDriver'),
    bash: forward('bash'),
    local: forward('local'),
    InMemorySessionStore: require('./dist-server/lite/in-memory-session-store.js').InMemorySessionStore,
    WORKBUDDY_TOOLS: require('./dist-server/lite/tool-presets.js').WORKBUDDY_TOOLS,
    // 宿主自定义工具 helper：实现依赖 @modelcontextprotocol/sdk（bundle 内），
    // 走动词同款惰性装载——宿主定义工具与 start() 同源共担 bundle 装载。
    tool: forward('tool'),
    createSdkMcpServer: forward('createSdkMcpServer'),
    partitionToolsOption: forward('partitionToolsOption'),
    // 宿主 fs 组装件（just-bash 同名类）：facade 侧用「构造器返回值」技巧保持
    // 惰性——new 时才 load() 并返回 bundle 类实例（实例身份=bundle 类；
    // instanceof facade 壳为 false，fs 类无此消费面，可接受）。
    MountableFs: class MountableFs { constructor(options) { return new (load().MountableFs)(options); } },
    InMemoryFs: class InMemoryFs { constructor(...args) { return new (load().InMemoryFs)(...args); } },
    OverlayFs: class OverlayFs { constructor(options) { return new (load().OverlayFs)(options); } },
    ReadWriteFs: class ReadWriteFs { constructor(options) { return new (load().ReadWriteFs)(options); } },
    // 具名错误类走 lite 副本（零依赖、facade 即得）；跨副本判别用 guard（name 判别）。
    SessionRewindError: require('./dist-server/lite/errors.js').SessionRewindError,
    isSessionRewindError: require('./dist-server/lite/errors.js').isSessionRewindError,
    ToolsOptionError: require('./dist-server/lite/errors.js').ToolsOptionError,
    isToolsOptionError: require('./dist-server/lite/errors.js').isToolsOptionError,
    AgentOptionError: require('./dist-server/lite/errors.js').AgentOptionError,
    isAgentOptionError: require('./dist-server/lite/errors.js').isAgentOptionError,
};
