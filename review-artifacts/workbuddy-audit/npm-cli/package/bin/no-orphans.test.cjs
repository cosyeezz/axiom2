'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { install, DISABLE_ENV } = require('./no-orphans.cjs');

test('non-Windows never loads native code or parses the Windows startup flag', () => {
    for (const platform of ['darwin', 'linux']) {
        assert.equal(install({ platform, environment: { [DISABLE_ENV]: 'invalid' }, args: ['--no-orphans'], state: {},
            loadBinding() { throw new Error('must not load'); } }), false);
    }
});
test('disabled at startup stays disabled after prewarm environment changes', () => {
    const state = {}; const environment = { [DISABLE_ENV]: '1' };
    const loadBinding = () => { throw new Error('must not load'); };
    assert.equal(install({ platform: 'win32', state, environment, loadBinding }), false);
    environment[DISABLE_ENV] = '0';
    assert.equal(install({ platform: 'win32', state, environment, args: ['--no-orphans'], loadBinding }), false);
});
test('explicit --no-orphans enables cleanup even when inherited environment disables it', () => {
    for (const args of [['--no-orphans', '--serve'], ['daemon', 'start', '--no-orphans'], ['--bg', '--no-orphans']]) {
        let calls = 0;
        const environment = { [DISABLE_ENV]: '1' };
        const originalArgs = [...args];
        assert.equal(install({ platform: 'win32', state: {}, environment, args,
            loadBinding: () => ({ ensureKillOnCloseJob() { calls++; } }) }), true);
        assert.equal(calls, 1);
        assert.deepEqual(args, originalArgs);
        assert.equal(environment[DISABLE_ENV], '1');
    }
});
test('literal arguments and option values are not startup flags', () => {
    for (const args of [['--', '--no-orphans'], ['--system-prompt=--no-orphans'], ['explain --no-orphans']]) {
        assert.equal(install({ platform: 'win32', state: {}, environment: { [DISABLE_ENV]: '1' }, args,
            loadBinding() { throw new Error('must not load'); } }), false);
    }
});
test('one initialization survives repeated calls and later disable flag changes', () => {
    let count = 0;
    const state = {}; const environment = {}; const binding = { ensureKillOnCloseJob() { count++; } };
    const options = { platform: 'win32', state, environment, loadBinding: () => binding };
    assert.equal(install(options), true);
    environment[DISABLE_ENV] = '1';
    assert.equal(install(options), true);
    assert.equal(count, 1);
});
test('startup validates boolean configuration before any native side effect', () => {
    for (const value of ['yes', 'True', '2']) {
        assert.throws(() => install({ platform: 'win32', state: {}, environment: { [DISABLE_ENV]: value } }), /must be/);
    }
});
test('missing addon or incompatible outer Job degrades once with a diagnostic', () => {
    for (const failsDuringLoad of [true, false]) {
        let calls = 0;
        const warnings = [];
        const options = { platform: 'win32', state: {}, environment: {}, warn: value => warnings.push(value), loadBinding() {
            calls++;
            if (failsDuringLoad) {throw new Error('missing addon');}
            return { ensureKillOnCloseJob() { throw new Error('outer Job incompatible'); } };
        } };
        assert.equal(install(options), false);
        assert.equal(install(options), false);
        assert.equal(calls, 1);
        assert.equal(warnings.length, 1);
    }
});
