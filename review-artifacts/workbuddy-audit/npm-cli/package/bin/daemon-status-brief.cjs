'use strict';

/**
 * `daemon status` 的宿主快路径：只回答「daemon 是否在跑、endpoint 是什么」，不加载主 bundle。
 *
 * CodeBuddy Desktop 每次连接 / 等待就绪都要执行 `daemon status`，完整路径要求值 25MB+ bundle、
 * 装配 DI 容器并构建 agent（约 1.2s），而它只读取 status / endpoint。宿主仅对这一次调用设置
 * `CODEBUDDY_DAEMON_STATUS_BRIEF=1`（不注入 daemon 环境，终端里的 `daemon status` 不受影响）。
 *
 * 判定与 `DaemonServiceImpl.findRunningDaemon()` 默认分支、`SessionRegistryImpl.list()` 保持一致：
 * `<config>/sessions/<pid>.json` 中 kind==='daemon' 且 kill(pid, 0) 存活的第一条（readdir 顺序）。
 * 以下情形返回 undefined，由调用方回退到完整路径，避免与 registry 语义分叉：
 * - 远端宿主作用域（CODEBUDDY_REMOTE_TARGET_HOST_ID）：需要进程身份校验与按 host 过滤；
 * - 定制包（customization.json 可改写配置目录名）；
 * - 存在 kind==='daemon' 的手动条目（心跳语义），或读取过程出现意外错误。
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const PID_FILE_PATTERN = /^(\d+|manual-.+)\.json$/;

function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) { return false; }
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function readBriefDaemonStatus(binDir, env = process.env) {
    if (env.CODEBUDDY_REMOTE_TARGET_HOST_ID !== undefined) { return undefined; }
    if (fs.existsSync(path.join(binDir, '..', 'customization.json'))) { return undefined; }
    try {
        const configDir = env.CODEBUDDY_CONFIG_DIR && env.CODEBUDDY_CONFIG_DIR.trim() !== ''
            ? env.CODEBUDDY_CONFIG_DIR
            : path.join(os.homedir(), '.codebuddy');
        const dir = path.join(configDir, 'sessions');
        let files;
        try {
            files = fs.readdirSync(dir);
        } catch {
            return { status: 'stopped' };
        }
        for (const file of files) {
            if (!PID_FILE_PATTERN.test(file)) { continue; }
            const manual = file.startsWith('manual-');
            if (!manual && !isProcessAlive(Number.parseInt(file, 10))) { continue; }
            let entry;
            try {
                entry = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
            } catch {
                // 与 registry 一致：并发删除或半写入的文件跳过。
                continue;
            }
            if (!entry || entry.kind !== 'daemon') { continue; }
            if (manual) { return undefined; }
            return { status: 'running', pid: entry.pid, endpoint: entry.endpoint, startedAt: entry.startedAt };
        }
        return { status: 'stopped' };
    } catch {
        return undefined;
    }
}

module.exports = { readBriefDaemonStatus };
