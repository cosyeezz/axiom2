'use strict';

/**
 * POSIX SSH_ASKPASS helper.
 *
 * The helper is invoked by ssh with the per-attempt config path supplied by a
 * generated launcher. It never prints diagnostics: stdout is reserved for the
 * secret so a failed request cannot accidentally become a password.
 */

const fs = require('node:fs');
const net = require('node:net');

const MAX_RESPONSE_BYTES = 16 * 1024;
const MAX_SECRET_BYTES = 8 * 1024;
const MAX_CONFIG_BYTES = 8 * 1024;

function fail() {
    process.exitCode = 1;
}

function parseConfig(configPath) {
    const configStat = fs.lstatSync(configPath);
    if (!configStat.isFile() || configStat.isSymbolicLink()) {
        throw new Error('config must be a regular file');
    }
    if (configStat.size > MAX_CONFIG_BYTES) {
        throw new Error('config is too large');
    }
    if (typeof process.getuid === 'function' && configStat.uid !== process.getuid()) {
        throw new Error('config owner mismatch');
    }
    if ((configStat.mode & 0o077) !== 0) {
        throw new Error('config permissions are too broad');
    }

    const configBytes = fs.readFileSync(configPath);
    if (configBytes.length > MAX_CONFIG_BYTES) {
        throw new Error('config is too large');
    }
    const parsed = JSON.parse(configBytes.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('invalid config');
    }
    if (
        parsed.version !== 1
        || typeof parsed.socketPath !== 'string'
        || typeof parsed.token !== 'string'
        || !Number.isSafeInteger(parsed.expiresAt)
        || !parsed.scope
        || typeof parsed.scope !== 'object'
    ) {
        throw new Error('invalid config fields');
    }
    return parsed;
}

function main() {
    const configPath = process.argv[2];
    const prompt = process.argv[3];
    if (
        typeof configPath !== 'string'
        || configPath.length === 0
        || typeof prompt !== 'string'
        || prompt.length === 0
        || !/^[\x20-\x7e]*$/.test(prompt)
    ) {
        fail();
        return;
    }

    let config;
    try {
        config = parseConfig(configPath);
    } catch {
        fail();
        return;
    }
    if (Date.now() > config.expiresAt) {
        fail();
        return;
    }

    const socket = net.connect(config.socketPath);
    let response = '';
    let completed = false;
    const timeoutMs = Math.max(1, Math.min(5_000, config.expiresAt - Date.now()));

    socket.setEncoding('utf8');
    socket.setTimeout(timeoutMs);
    socket.on('connect', () => {
        socket.write(`${JSON.stringify({
            version: 1,
            token: config.token,
            prompt,
            helperPid: process.pid,
            sshPid: process.ppid,
        })}\n`);
    });
    socket.on('data', chunk => {
        if (completed) {
            // Never write a second secret. Any bytes after the first complete
            // response are a protocol violation and make the helper fail.
            fail();
            return;
        }
        response += chunk;
        if (Buffer.byteLength(response, 'utf8') > MAX_RESPONSE_BYTES + 1) {
            completed = true;
            socket.destroy();
            fail();
            return;
        }
        const newline = response.indexOf('\n');
        if (newline === -1) {
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(response.slice(0, newline));
        } catch {
            socket.destroy();
            fail();
            return;
        }
        const trailing = response.slice(newline + 1);
        if (
            !parsed
            || parsed.version !== 1
            || parsed.ok !== true
            || typeof parsed.secret !== 'string'
            || parsed.secret.length === 0
            || Buffer.byteLength(parsed.secret, 'utf8') > MAX_SECRET_BYTES
            || parsed.secret.includes('\0')
            || parsed.secret.includes('\r')
            || parsed.secret.includes('\n')
            || trailing.length !== 0
        ) {
            completed = true;
            socket.destroy();
            fail();
            return;
        }

        completed = true;
        process.stdout.write(`${parsed.secret}\n`, error => {
            socket.destroy();
            if (error) {
                fail();
            }
        });
    });
    process.stdout.on('error', () => {
        fail();
    });
    socket.on('timeout', () => {
        socket.destroy();
        if (!completed) {
            fail();
        }
    });
    socket.on('error', () => {
        socket.destroy();
        if (!completed) {
            fail();
        }
    });
    socket.on('close', () => {
        if (!completed) {
            fail();
        }
    });
}

main();
