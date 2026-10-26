'use strict';

// Loaded only by an explicitly profiled CLI entry, before the application bundle.
// Keep this independent of CellJS, logging, settings, and the business module graph.
const { performance } = require('node:perf_hooks');
const { AsyncLocalStorage } = require('node:async_hooks');

function parseOptions(args, env = process.env) {
    const options = { enabled: env.CODEBUDDY_STARTUP_PROFILE === '1', markdown: env.CODEBUDDY_STARTUP_PROFILE === '1' };
    let i = 0;
    for (; i < args.length; i++) {
        const [flag, ...parts] = args[i].split('=');
        if (!flag.startsWith('--startup-prof')) { break; }
        if (['--startup-prof', '--startup-prof-md'].includes(flag)) {
            if (parts.length) { throw new Error(`${flag} does not take a value`); }
            options.enabled = true;
            if (flag === '--startup-prof-md') { options.markdown = true; }
        } else {
            const key = { '--startup-prof-dir': 'directory', '--startup-prof-name': 'name' }[flag];
            if (!key) { throw new Error(`Unknown startup profiling option: ${flag}`); }
            const value = parts.length ? parts.join('=') : args[++i];
            // Reject control characters in portable output paths and file names.
            // eslint-disable-next-line no-control-regex
            if (!value || value.startsWith('--') || /[\x00-\x1f]/.test(value)) { throw new Error(`Missing or invalid value for ${flag}`); }
            options[key] = value;
        }
    }
    if (!options.enabled && i) { throw new Error('Use --startup-prof or --startup-prof-md to enable collection'); }
    // File stems deliberately follow Windows rules on every OS for portable commands.
    if (options.name && (/[<>:"/\\|?*]/.test(options.name) || /[. ]$/.test(options.name)
        || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(options.name))) {
        throw new Error('--startup-prof-name must be a portable file stem, not a path');
    }
    return { options, args: args.slice(i) };
}

function unionDuration(intervals) {
    let total = 0; let end = 0;
    for (const [start, stop] of intervals.sort((a, b) => a[0] - b[0])) {
        total += Math.max(0, stop - Math.max(start, end));
        end = Math.max(end, stop);
    }
    return total;
}

function createRecorder({ origin = performance.now(), epoch = Date.now(), until = 'first-model-request', limit = 10000, now = () => performance.now() } = {}) {
    const context = new AsyncLocalStorage();
    const spans = []; const events = []; const active = new Map(); const legacy = new Map();
    const milestones = {}; const warnings = new Set();
    let finished; let nextId = 1; let dropped = 0;
    const time = () => Math.max(0, now() - origin);
    const room = () => {
        if (spans.length + events.length < limit) { return true; }
        dropped++; return false;
    };
    const recorder = {
        epoch, until, bundle: 'unknown',
        isRecording: () => !finished,
        begin(phase, label = phase) {
            if (finished || !room()) { return undefined; }
            const span = { id: nextId++, parentId: context.getStore(), phase, label, startMs: time() };
            spans.push(span); active.set(span.id, span);
            return span.id;
        },
        end(id, status = 'complete') {
            if (finished || id === undefined) { return; }
            const span = active.get(id);
            if (!span) { return; }
            span.endMs = time(); span.status = status;
            active.delete(id);
        },
        labelCurrentSpan(phase, label) {
            if (finished) { return; }
            const span = active.get(context.getStore());
            if (span?.phase === phase && !span.sourceLabel) {
                span.label = label;
                span.sourceLabel = true;
            }
        },
        // Compatibility with existing markStart/markEnd probes. New concurrent
        // work uses begin/end tokens or measure, never phase names as identities.
        markStart(phase, label = phase) {
            if (finished) { return; }
            const key = `${context.getStore() ?? 0}:${phase}`;
            const stack = legacy.get(key) ?? [];
            if (stack.length && warnings.size < 64) { warnings.add(`Overlapping legacy phase: ${phase}; pairing is LIFO within its async context.`); }
            const id = recorder.begin(phase, label);
            if (id !== undefined) { stack.push(id); legacy.set(key, stack); }
        },
        markEnd(phase) {
            if (finished) { return; }
            const key = `${context.getStore() ?? 0}:${phase}`;
            const stack = legacy.get(key);
            if (!stack?.length) { if (warnings.size < 64) { warnings.add(`Unmatched phase end: ${phase}`); } return; }
            recorder.end(stack.pop());
        },
        markEvent(phase, label = phase) {
            if (finished) { return; }
            const atMs = time();
            if (room()) {
                events.push({ phase, label, atMs });
                milestones[phase] ??= atMs;
            }
            // The cap limits stored diagnostics, never the startup stop boundary.
            if (phase === until) { milestones[phase] ??= atMs; }
            if (phase === until) { recorder.finish('target-reached'); }
        },
        measure(phase, label, fn) {
            if (finished) { return fn(); }
            const id = recorder.begin(phase, label);
            return context.run(id, () => {
                try {
                    const result = fn();
                    if (result && typeof result.then === 'function') {
                        return result.then(value => { recorder.end(id); return value; }, error => { recorder.end(id, 'error'); throw error; });
                    }
                    recorder.end(id); return result;
                } catch (error) { recorder.end(id, 'error'); throw error; }
            });
        },
        finish(reason, exitCode) {
            if (finished) { return; }
            finished = { reason, exitCode, durationMs: time() };
            context.disable();
            recorder.onFinish?.();
        },
        report() {
            const durationMs = finished?.durationMs ?? time();
            const timeline = spans.map(span => ({ ...span, endMs: span.endMs ?? durationMs,
                durationMs: (span.endMs ?? durationMs) - span.startMs, status: span.status ?? 'pending' }));
            const coveredMs = unionDuration(timeline.map(span => [span.startMs, span.endMs]));
            return { schemaVersion: 1, startedAt: new Date(epoch).toISOString(), clock: 'monotonic milliseconds from CLI entry',
                target: until, reason: finished?.reason ?? 'recording', exitCode: finished?.exitCode,
                durationMs, coveredMs, uncoveredMs: Math.max(0, durationMs - coveredMs),
                bundle: recorder.bundle, milestones: { ...milestones }, spans: timeline,
                events: [...events], warnings: [...warnings], droppedEntries: dropped };
        },
    };
    return recorder;
}

function formatMarkdown(report) {
    const cell = value => String(value ?? '').replace(/[\r\n]/g, ' ').replace(/\|/g, '\\|').replace(/`/g, "'");
    const ms = value => Number(value).toFixed(3);
    const applicationName = cell(report.applicationName ?? 'CodeBuddy Code');
    const lines = [`# ${applicationName} startup profile`, '',
        `- Runtime: ${cell(report.runtime)} ${cell(report.runtimeVersion)}; platform: ${cell(report.platform)}/${cell(report.arch)}`,
        `- ${applicationName}: ${cell(report.version)}; bundle: ${cell(report.bundle)}; PID: ${report.pid}`,
        `- Started: ${report.startedAt}; target: ${report.target}; result: ${report.reason}`,
        `- Captured wall time: **${ms(report.durationMs)} ms**; uncovered: ${ms(report.uncoveredMs)} ms`,
        `- Runtime uptime at entry (outside this timeline): ${ms(report.runtimeUptimeAtEntryMs ?? 0)} ms`, '',
        'Times are elapsed wall time, not CPU self time. Nested and concurrent spans overlap; do not add their durations.',
        'Pending spans are clipped at the capture boundary, not counted as completed work. Uncovered time has no active instrumented span.',
        'Collection stops automatically at the startup milestone for this CLI mode, before model response time. Report formatting and final file writes happen after capture.', '',
        '## Milestones', '', '| Event | Since entry (ms) |', '|---|---:|'];
    for (const [phase, at] of Object.entries(report.milestones)) { lines.push(`| ${cell(phase)} | ${ms(at)} |`); }
    lines.push('', '## Longest spans (inclusive wall time)', '', '| ID | Phase | Duration (ms) | Status |', '|---:|---|---:|---|');
    for (const span of [...report.spans].sort((a, b) => b.durationMs - a.durationMs).slice(0, 30)) {
        lines.push(`| ${span.id} | ${cell(span.label)} | ${ms(span.durationMs)} | ${span.status} |`);
    }
    lines.push('', '## Complete timeline', '', '| ID | Parent | Phase | Label | Start (ms) | End (ms) | Duration (ms) | Status |', '|---:|---:|---|---|---:|---:|---:|---|');
    for (const span of report.spans) {
        lines.push(`| ${span.id} | ${span.parentId ?? ''} | ${cell(span.phase)} | ${cell(span.label)} | ${ms(span.startMs)} | ${ms(span.endMs)} | ${ms(span.durationMs)} | ${span.status} |`);
    }
    if (report.resources) { lines.push('', '## Process resources at capture end', '', '```json', JSON.stringify(report.resources, null, 2), '```'); }
    lines.push('', '## Capture limits', '', '- CLI entry is the first observable point; OS process creation and earlier runtime/native imports are outside the timeline.',
        '- DI resolution includes constructors and PostConstruct; lifecycle spans measure initialize/onStart separately.',
        '- Labels identify instrumented boundaries; gaps and work inside a span need CPU profiles for deeper attribution.',
        `- Dropped entries: ${report.droppedEntries} (bounded collection).`);
    for (const warning of report.warnings) { lines.push(`- ${cell(warning)}`); }
    return `${lines.join('\n')}\n`;
}

function bootstrap({ origin = performance.now(), epoch = Date.now(), runtimeUptimeAtEntryMs = process.uptime() * 1000, target, applicationName = 'CodeBuddy Code', version: applicationVersion, bundle } = {}) {
    if (globalThis.__CODEBUDDY_STARTUP_PROFILER__) { return; }
    const { options, args } = parseOptions(process.argv.slice(2));
    if (!options.enabled) { return; }
    process.argv.splice(2, process.argv.length - 2, ...args);
    const path = require('node:path');
    const fs = require('node:fs');
    const directory = path.resolve(options.directory ?? '.');
    const name = options.name ?? `Startup.${new Date(epoch).toISOString().replace(/[:.]/g, '-')}.${process.pid}`;
    const until = target ?? (args.some(arg => ['--serve', '--acp', '--a2a', '--prewarm'].includes(arg)) || args[0] === 'daemon'
        ? 'application-ready' : args.includes('-p') || args.includes('--print') || !process.stdout.isTTY
            ? 'first-model-request' : 'ui-ready');
    // Fail before starting the workload if the requested destination cannot be used.
    fs.mkdirSync(directory, { recursive: true });
    const jsonFile = path.join(directory, `${name}.json`);
    const mdFile = path.join(directory, `${name}.md`);
    const destinations = options.markdown ? [jsonFile, mdFile] : [jsonFile];
    const created = [];
    try {
        for (const file of destinations) {
            fs.closeSync(fs.openSync(file, 'wx', 0o600)); created.push(file);
        }
    } catch (error) {
        for (const file of created) { fs.unlinkSync(file); }
        throw error;
    }
    const recorder = createRecorder({ origin, epoch, until });
    if (bundle) { recorder.bundle = bundle; }
    let saved = false;
    let report;
    const save = () => {
        if (saved || !report) { return; }
        saved = true;
        try {
            fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`);
            if (options.markdown) { fs.writeFileSync(mdFile, formatMarkdown(report)); }
            process.stderr.write(`[startup-profile] ${options.markdown ? mdFile : jsonFile}\n`);
        } catch (error) { process.stderr.write(`[startup-profile] Cannot write report: ${error.message}\n`); }
    };
    const onExit = code => { recorder.finish('exit-before-target', code); save(); };
    const timer = setTimeout(() => recorder.finish('timeout'), 60000);
    timer.unref();
    process.once('exit', onExit);
    recorder.onFinish = () => {
        clearTimeout(timer);
        // Keep the bounded, frozen recorder for /doctor and the legacy DI facade.
        // Subsequent probes return before reading the clock or allocating entries.
        report = recorder.report();
        let version = applicationVersion ?? process.env.CLIENT_INFO_PRODUCT_VERSION;
        try { const pkg = require('../package.json'); version ??= pkg.publishConfig?.customPackage?.version ?? pkg.version; } catch { /* optional metadata */ }
        Object.assign(report, { applicationName, version: version ?? 'unknown', pid: process.pid, platform: process.platform, arch: process.arch,
            runtime: process.versions.bun ? 'bun' : 'node', runtimeVersion: process.versions.bun ?? process.versions.node,
            runtimeUptimeAtEntryMs, resources: { memoryBytes: process.memoryUsage(), cpuMicroseconds: process.cpuUsage() } });
        // Defer formatting until the current startup/request continuation has yielded.
        setImmediate(() => { save(); process.removeListener('exit', onExit); });
    };
    globalThis.__CODEBUDDY_STARTUP_PROFILER__ = recorder;
    recorder.markEvent('collector-ready', 'Collector setup complete (entry is time zero)');
    recorder.markStart('bootstrap', 'CLI bootstrap');
}

module.exports = { bootstrap, createRecorder, formatMarkdown, parseOptions, unionDuration };
