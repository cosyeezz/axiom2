'use strict';
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { readBriefDaemonStatus } = require('./daemon-status-brief.cjs');

/** spawnSync 返回时子进程已退出并被回收，其 pid 不再存活。 */
function deadPid() {
    return spawnSync(process.execPath, ['-e', ''], { stdio: 'ignore' }).pid;
}

function setup(entries) {
    const configDir = mkdtempSync(path.join(tmpdir(), 'daemon-status-brief-'));
    const sessions = path.join(configDir, 'sessions');
    mkdirSync(sessions, { recursive: true });
    for (const [file, entry] of Object.entries(entries)) {
        writeFileSync(path.join(sessions, file), typeof entry === 'string' ? entry : JSON.stringify(entry));
    }
    return configDir;
}

test('returns the live daemon entry and ignores dead, non-daemon and corrupt files', () => {
    const dead = deadPid();
    const configDir = setup({
        [`${dead}.json`]: { pid: dead, kind: 'daemon', endpoint: 'http://127.0.0.1:1' },
        [`${process.ppid}.json`]: { pid: process.ppid, kind: 'bg' },
        'broken.json': '{',
        [`${process.pid}.json`]: { pid: process.pid, kind: 'daemon', endpoint: 'http://127.0.0.1:9527', startedAt: 1 },
    });
    try {
        assert.deepEqual(readBriefDaemonStatus(__dirname, { CODEBUDDY_CONFIG_DIR: configDir }), {
            status: 'running', pid: process.pid, endpoint: 'http://127.0.0.1:9527', startedAt: 1,
        });
    } finally { rmSync(configDir, { recursive: true, force: true }); }
});

test('reports stopped when no live daemon is registered', () => {
    const configDir = setup({ [`${process.pid}.json`]: { pid: process.pid, kind: 'prewarm' } });
    try {
        assert.deepEqual(readBriefDaemonStatus(__dirname, { CODEBUDDY_CONFIG_DIR: configDir }), { status: 'stopped' });
        assert.deepEqual(readBriefDaemonStatus(__dirname, { CODEBUDDY_CONFIG_DIR: path.join(configDir, 'missing') }), { status: 'stopped' });
    } finally { rmSync(configDir, { recursive: true, force: true }); }
});

test('falls back to the full command when registry semantics cannot be reproduced', () => {
    const configDir = setup({ 'manual-x.json': { pid: -1, manual: true, kind: 'daemon', lastHeartbeat: Date.now() } });
    const customBin = path.join(mkdtempSync(path.join(tmpdir(), 'daemon-status-brief-custom-')), 'bin');
    mkdirSync(customBin);
    writeFileSync(path.join(customBin, '..', 'customization.json'), '{}');
    try {
        assert.equal(readBriefDaemonStatus(__dirname, { CODEBUDDY_CONFIG_DIR: configDir }), undefined);
        assert.equal(readBriefDaemonStatus(__dirname, { CODEBUDDY_CONFIG_DIR: configDir, CODEBUDDY_REMOTE_TARGET_HOST_ID: 'h' }), undefined);
        assert.equal(readBriefDaemonStatus(customBin, { CODEBUDDY_CONFIG_DIR: configDir }), undefined);
    } finally {
        rmSync(configDir, { recursive: true, force: true });
        rmSync(path.dirname(customBin), { recursive: true, force: true });
    }
});

test('bin/codebuddy answers brief status without loading the bundle, only when the host opts in', () => {
    const configDir = setup({ [`${process.pid}.json`]: { pid: process.pid, kind: 'daemon', endpoint: 'http://127.0.0.1:9527' } });
    try {
        const env = { ...process.env, CODEBUDDY_CONFIG_DIR: configDir, CODEBUDDY_DAEMON_STATUS_BRIEF: '1' };
        delete env.CODEBUDDY_REMOTE_TARGET_HOST_ID;
        const out = execFileSync(process.execPath, [path.join(__dirname, 'codebuddy'), 'daemon', 'status'], { env, encoding: 'utf8' });
        assert.deepEqual(JSON.parse(out), { status: 'running', pid: process.pid, endpoint: 'http://127.0.0.1:9527' });
    } finally { rmSync(configDir, { recursive: true, force: true }); }
});
