'use strict';
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(path.join(__dirname, 'windows-job.cjs'), 'utf8');
const packageRoot = path.resolve(__dirname, '..');
for (const directory of ['bin', 'dist']) {
    test(`native loader resolves bin/native from ${directory} without installing cleanup`, () => {
        const loaded = [];
        const binding = { ensureKillOnCloseJob() { throw new Error('loading must not install'); } };
        const context = {
            process: { platform: 'win32', arch: 'arm64' },
            __dirname: path.join(packageRoot, directory),
            __filename: path.join(packageRoot, directory, 'codebuddy.js'),
            module: { exports: {} },
            require(name) {
                if (name === 'node:module') {
                    return { createRequire: () => filename => { loaded.push(filename); return binding; } };
                }
                if (name === 'node:path') {return require('node:path');}
                throw new Error(`Unexpected module: ${name}`);
            },
        };
        vm.runInNewContext(source, context);
        assert.deepEqual(loaded, []);
        assert.equal(context.module.exports.loadBinding(), binding);
        assert.equal(context.module.exports.loadBinding(), binding);
        assert.deepEqual(loaded, [path.join(packageRoot, 'bin/native/win32-arm64/job-object.node')]);
    });
}
test('Bun SFE uses the embedded native binding without filesystem resolution', () => {
    let loads = 0;
    const binding = {};
    const context = {
        process: { platform: 'win32', arch: 'x64' }, module: { exports: {} }, require,
        __CODEBUDDY_WINDOWS_JOB_NATIVE__: () => { loads++; return binding; },
    };
    vm.runInNewContext(source, context);
    assert.equal(context.module.exports.loadBinding(), binding);
    assert.equal(context.module.exports.loadBinding(), binding);
    assert.equal(loads, 1);
});
