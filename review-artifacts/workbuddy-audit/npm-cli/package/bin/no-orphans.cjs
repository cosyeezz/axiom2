'use strict';
const { loadBinding } = require('./windows-job.cjs');

const STATE = Symbol.for('codebuddy.no-orphans');
const NO_ORPHANS_FLAG = '--no-orphans';
// Keep the existing operator kill switch compatible with earlier releases.
const DISABLE_ENV = 'CODEBUDDY_DISABLE_CHILD_PROCESS_CONTAINMENT';

function isDisabled(environment = process.env) {
    const value = environment[DISABLE_ENV];
    if (value === undefined || ['', '0', 'false'].includes(value)) {return false;}
    if (['1', 'true'].includes(value)) {return true;}
    throw new Error(`${DISABLE_ENV} must be 0, 1, true, false, or unset`);
}

// CLI entry only, before business imports (including prewarm). Like Bun's
// ensure_kill_on_close_job, cleanup belongs to this OS process. We deliberately
// do not install Bun's parent-death watchdog: daemon/bg processes must outlive
// their launcher while still cleaning up their own descendants on exit.
function install({ platform = process.platform, environment = process.env, args = process.argv.slice(2),
    state = globalThis, loadBinding: load = loadBinding,
    warn = message => process.emitWarning(message) } = {}) {
    if (state[STATE] !== undefined) {return state[STATE];}
    if (platform !== 'win32') {return (state[STATE] = false);}
    // Read the startup flag before loading the application. Leave argv intact
    // for CLI parsing and daemon/bg respawn; arguments after -- are literal.
    const terminator = args.indexOf('--');
    const requested = args.slice(0, terminator < 0 ? args.length : terminator).includes(NO_ORPHANS_FLAG);
    if (!requested && isDisabled(environment)) {return (state[STATE] = false);}
    require('./daemon-supervisor.cjs').prepare();
    try {
        load().ensureKillOnCloseJob();
        return (state[STATE] = true);
    } catch (error) {
        // Retain the existing distribution/outer-Job compatibility fallback.
        state[STATE] = false;
        warn(`Windows no-orphans cleanup unavailable: ${error.message}`);
        return false;
    }
}

function isEnabled() {
    return process.platform === 'win32' && globalThis[STATE] === true;
}
module.exports = { install, isEnabled, isDisabled, DISABLE_ENV, NO_ORPHANS_FLAG };
