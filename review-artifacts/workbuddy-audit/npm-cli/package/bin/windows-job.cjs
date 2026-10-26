'use strict';
const path = require('node:path');
const { createRequire } = require('node:module');

let binding;

// Loading the platform binding has no process-lifetime side effects. Policy
// belongs to no-orphans.install(); only it calls ensureKillOnCloseJob().
function loadBinding() {
    if (process.platform !== 'win32') {throw new Error('Windows Job binding requires win32');}
    if (!binding) {
        if (globalThis.__CODEBUDDY_WINDOWS_JOB_NATIVE__) {
            binding = globalThis.__CODEBUDDY_WINDOWS_JOB_NATIVE__();
        } else {
            // __dirname is bin/ for the bootstrap and dist/ inside the bundle.
            const filename = path.resolve(__dirname, '../bin/native', `win32-${process.arch}`, 'job-object.node');
            binding = createRequire(__filename)(filename);
        }
    }
    return binding;
}
module.exports = { loadBinding };
