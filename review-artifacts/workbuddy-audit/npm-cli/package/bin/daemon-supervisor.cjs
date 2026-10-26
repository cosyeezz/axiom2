'use strict';
const { spawn } = require('node:child_process');
const { openSync, closeSync } = require('node:fs');
const path = require('node:path');

const STATE = Symbol.for('codebuddy.daemon-supervisor');
const CHANNEL_ENV = 'CODEBUDDY_INTERNAL_DAEMON_CHANNEL';
const FLAG = '--internal-daemon-supervisor';

// Only daemon starters create this process, before joining the strict Job.
// The supervisor loads no application bundle and never joins a worker's Job.
function prepare(platform = process.platform) {
    if (platform !== 'win32') {return;}
    if (globalThis[STATE]) {return globalThis[STATE];}
    if (process.env[CHANNEL_ENV]) {
        delete process.env[CHANNEL_ENV];
        if (process.send && process.connected) {
            globalThis[STATE] = process;
            process.channel?.unref?.();
            return process;
        }
    }
    const args = process.argv.slice(2);
    if (args[0] !== 'daemon' || !['start', 'restart', 'install'].includes(args[1])) {return;}
    return start();
}

function start() {
    const compiled = process.versions.bun && /^(\/\$bunfs\/|[A-Za-z]:[\\/]~BUN[\\/])/.test(process.argv[1] || '');
    const args = compiled ? [FLAG] : [path.resolve(__dirname, '../bin/daemon-supervisor.cjs')];
    const child = spawn(process.execPath, args, {
        detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    });
    // A failed supervisor must reject the eventual daemon request, not crash
    // the starter with an unhandled ChildProcess error.
    child.on('error', error => { child.supervisorError = error; });
    child.unref();
    child.channel?.unref?.();
    globalThis[STATE] = child;
    return child;
}

let sequence = 0;
function spawnDaemon(command, args, options) {
    const channel = globalThis[STATE];
    if (!channel?.connected || channel.supervisorError) {
        return Promise.reject(channel?.supervisorError || new Error('Daemon supervisor unavailable; start it with codebuddy daemon start'));
    }
    const id = ++sequence;
    return new Promise((resolve, reject) => {
        // Bun's IPC channel lacks ref()/unref(). Keep both runtimes alive only
        // while a startup reply is pending, including after the last JS timer.
        const keepAlive = setInterval(() => {}, 60_000);
        const finish = (error, result) => {
            clearInterval(keepAlive);
            channel.off('message', onMessage);
            channel.off('disconnect', onDisconnect);
            channel.channel?.unref?.();
            if (error) {reject(error);} else {resolve(result);}
        };
        const onDisconnect = () => finish(new Error('Daemon supervisor disconnected during startup'));
        const onMessage = message => {
            if (message?.type !== 'daemon-started' || message.id !== id) {return;}
            finish(message.error ? new Error(message.error) : undefined, { pid: message.pid });
        };
        channel.on('message', onMessage);
        channel.once('disconnect', onDisconnect);
        channel.channel?.ref?.();
        try {
            channel.send({ type: 'start-daemon', id, command, args, options }, error => {
                if (error) {finish(error);}
            });
        } catch (error) {
            finish(error);
        }
    });
}

function run() {
    if (!process.send) {throw new Error('Daemon supervisor requires an inherited IPC channel');}
    const workers = new Set();
    const maybeExit = () => {
        if (!process.connected && workers.size === 0) {process.exit(0);}
    };
    const listen = channel => {
        let handedOff = false;
        channel.on('message', message => {
            if (message?.type !== 'start-daemon') {return;}
            const { id, command, args, options } = message;
            const reply = result => {
                if (channel.connected) {channel.send({ type: 'daemon-started', id, ...result }, () => {});}
            };
            if (handedOff) {reply({ error: 'Daemon already handed off by this process' }); return;}
            if (!Array.isArray(args) || !args.includes('--serve') || options?.env?.CODEBUDDY_SESSION_KIND !== 'daemon') {
                reply({ error: 'Supervisor only starts daemon workers' }); return;
            }
            let log;
            try {
                log = options.logPath === undefined ? undefined : openSync(options.logPath, 'a');
                const worker = spawn(command, args, {
                    cwd: options.cwd, env: { ...options.env, [CHANNEL_ENV]: '1' },
                    detached: true, windowsHide: true,
                    stdio: ['ignore', log ?? 'ignore', log ?? 'ignore', 'ipc'],
                });
                handedOff = true;
                workers.add(worker);
                listen(worker);
                worker.once('spawn', () => reply({ pid: worker.pid }));
                worker.once('error', error => {
                    handedOff = false;
                    workers.delete(worker);
                    reply({ error: error.message });
                    maybeExit();
                });
                worker.once('exit', () => { workers.delete(worker); maybeExit(); });
            } catch (error) {
                reply({ error: error.message });
            } finally {
                if (log !== undefined) {closeSync(log);}
            }
        });
    };
    listen(process);
    process.on('disconnect', maybeExit);
}

module.exports = { prepare, start, spawnDaemon, run, FLAG };
if (require.main === module) {run();}
