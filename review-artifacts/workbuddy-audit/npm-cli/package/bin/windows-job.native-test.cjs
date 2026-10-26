'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const addonPath = path.join(__dirname, 'native', `win32-${process.arch}`, 'job-object.node');
const bootstrap = `const b=require(${JSON.stringify(addonPath)});b.ensureKillOnCloseJob();`;
const childCode = 'setInterval(()=>{},1000)';
const winTest = (name, run) => test(name, { skip: process.platform !== 'win32', timeout: 20000 }, run);
winTest('napi-rs validates process membership queries', () => {
    // Loading the binding must not join the test runner to a kill-on-close Job.
    const binding = createRequire(__filename)(addonPath);
    assert.throws(() => binding.isProcessInJob(0), { code: 'ERR_AGENT_CLI_WINDOWS_JOB' });
});
function alive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function reaped(pid) {
    for (let i = 0; i < 100 && alive(pid); i++) {await delay(25);}
    assert.equal(alive(pid), false, `process ${pid} survived its host`);
}
function owner(code) {
    return spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
}
async function report(child) {
    let output = '';
    let errors = '';
    child.stdout.on('data', value => { output += value; });
    child.stderr.on('data', value => { errors += value; });
    for (let i = 0; i < 200 && !output.includes('\n'); i++) {
        if (child.exitCode !== null) {break;}
        await delay(25);
    }
    assert.ok(output.includes('\n'), `No report: ${output} ${errors}`);
    return JSON.parse(output.split('\n')[0]);
}
const spawnOrdinary = `const cp=require('node:child_process');
    const children=Array.from({length:6},()=>{
        const c=cp.spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',detached:true});c.unref();return c;
    });
    console.log(JSON.stringify({host:process.pid,pids:children.map(c=>c.pid),members:children.map(c=>b.isProcessInJob(c.pid)),self:b.isProcessInJob(process.pid)}));`;
for (const hard of [false, true]) {
    winTest(`${hard ? 'hard kill with blocked JS' : 'normal exit'} reaps six ordinary detached children without wrappers`, async () => {
        const host = owner(bootstrap + spawnOrdinary + (hard ? 'while(true){}' : 'process.exitCode=23;'));
        let pids = [];
        try {
            const result = await report(host);
            pids = result.pids;
            assert.equal(result.self, true);
            assert.deepEqual(result.members, Array(6).fill(true));
            if (hard) {host.kill('SIGKILL');}
            await reaped(host.pid);
            if (!hard) {
                if (host.exitCode === null) {await once(host, 'exit');}
                assert.equal(host.exitCode, 23);
            }
            await Promise.all(pids.map(reaped));
        } finally {
            host.kill('SIGKILL');
            for (const pid of pids) { if (alive(pid)) {process.kill(pid, 'SIGKILL');} }
        }
    });
}
winTest('grandchild survives its direct parent and is reaped only when CLI host exits', async () => {
    const middle = `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childCode)}],{stdio:'ignore',detached:true});c.unref();console.log(c.pid);`;
    const host = owner(bootstrap + `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(middle)}],{windowsHide:true});
        let data='';c.stdout.on('data',v=>data+=v);c.on('close',()=>{console.log(JSON.stringify({pid:Number(data),inJob:b.isProcessInJob(Number(data))}));setInterval(()=>{},1000);});`);
    let pid;
    try {
        const result = await report(host);
        pid = result.pid;
        assert.equal(result.inJob, true);
        assert.ok(alive(pid));
        host.kill('SIGKILL');
        await reaped(pid);
    } finally { host.kill('SIGKILL'); if (pid && alive(pid)) {process.kill(pid, 'SIGKILL');} }
});
winTest('Worker teardown cannot close the process-wide Job', async () => {
    const worker = bootstrap + "require('node:worker_threads').parentPort.postMessage('ready');";
    const host = owner(`const {Worker}=require('node:worker_threads');const w=new Worker(${JSON.stringify(worker)},{eval:true});
        w.once('message',async()=>{await w.terminate();${bootstrap + spawnOrdinary}});`);
    const { pids, self, members } = await report(host);
    assert.equal(self, true);
    assert.deepEqual(members, Array(6).fill(true));
    await reaped(host.pid);
    await Promise.all(pids.map(reaped));
});
winTest('a CLI already inside a parent CLI Job can initialize its own nested Job', async () => {
    const nested = bootstrap + spawnOrdinary;
    const host = owner(bootstrap + `const c=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(nested)}],{windowsHide:true});c.stdout.pipe(process.stdout);c.stderr.pipe(process.stderr);`);
    const { pids, self } = await report(host);
    assert.equal(self, true);
    await reaped(host.pid);
    await Promise.all(pids.map(reaped));
});

winTest('ordinary fork retains IPC while inheriting the Job before child JavaScript', async () => {
    const { writeFileSync } = require('node:fs');
    const directory = mkdtempSync(path.join(os.tmpdir(), 'host-fork-'));
    const file = path.join(directory, 'child.cjs');
    writeFileSync(file, 'process.send({pid:process.pid,ppid:process.ppid});setInterval(()=>{},1000);');
    const host = owner(bootstrap + `const c=require('node:child_process').fork(${JSON.stringify(file)},[],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
        c.on('message',data=>{console.log(JSON.stringify({...data,member:b.isProcessInJob(data.pid),host:process.pid}));});`);
    let pid;
    try {
        const result = await report(host);
        pid = result.pid;
        assert.equal(result.ppid, result.host);
        assert.equal(result.member, true);
        host.kill('SIGKILL');
        await reaped(pid);
    } finally {
        host.kill('SIGKILL');
        if (pid && alive(pid)) {process.kill(pid, 'SIGKILL');}
        rmSync(directory, { recursive: true, force: true });
    }
});

winTest('original node-pty inherits the host Job and keeps PTY resize/input APIs', async () => {
    const ptyPath = require.resolve('@lydell/node-pty');
    const script = "process.stdin.setRawMode(true);console.log('READY');process.stdin.on('data',()=>console.log('INPUT'));";
    const host = owner(bootstrap + `const p=require(${JSON.stringify(ptyPath)}).spawn(process.execPath,['-e',${JSON.stringify(script)}],{cols:80,rows:24,env:process.env});
        let output='',sent=false,reported=false;p.onData(data=>{output+=data;
            if(output.includes('READY')&&!sent){sent=true;p.resize(100,40);p.write('x');}
            if(output.includes('INPUT')&&!reported){reported=true;console.log(JSON.stringify({pid:p.pid,member:b.isProcessInJob(p.pid)}));}
        });`);
    let pid;
    try {
        const result = await report(host);
        pid = result.pid;
        assert.equal(result.member, true);
        host.kill('SIGKILL');
        await reaped(pid);
    } finally { host.kill('SIGKILL'); if (pid && alive(pid)) {process.kill(pid, 'SIGKILL');} }
});

for (const background of [false, true]) {
    winTest(`Git Bash ${background ? 'background' : 'foreground'} native descendants cannot break away`, async () => {
        const { existsSync } = require('node:fs');
        const candidates = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'],
            path.join(process.env.LOCALAPPDATA || '', 'Programs')]
            .filter(Boolean).map(root => path.join(root, 'Git', 'bin', 'bash.exe'));
        const bash = candidates.find(existsSync);
        assert.ok(bash, 'Git for Windows is required for the MSYS breakaway regression test');
        const directory = mkdtempSync(path.join(os.tmpdir(), 'job-git-bash-'));
        const pidFile = path.join(directory, 'pid');
        const script = path.join(directory, 'child.cjs');
        writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000);`);
        const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
        const command = `${quote(process.execPath)} ${quote(script)}${background ? ' >/dev/null 2>&1 &' : ''}`;
        const host = owner(bootstrap + `const fs=require('node:fs');
            const shell=require('node:child_process').spawn(${JSON.stringify(bash)},['-c',${JSON.stringify(command)}],{stdio:'ignore',windowsHide:true});
            const poll=setInterval(()=>{
                if(!fs.existsSync(${JSON.stringify(pidFile)}))return;
                if(${background} && shell.exitCode===null)return;
                const pid=Number(fs.readFileSync(${JSON.stringify(pidFile)},'utf8'));if(!pid)return;clearInterval(poll);
                console.log(JSON.stringify({pid,member:b.isProcessInJob(pid)}));setInterval(()=>{},1000);
            },25);`);
        let pid;
        try {
            const result = await report(host);
            pid = result.pid;
            assert.equal(result.member, true, 'MSYS descendant escaped our specific Job');
            host.kill('SIGKILL');
            await reaped(pid);
        } finally {
            host.kill('SIGKILL');
            if (pid && alive(pid)) {process.kill(pid, 'SIGKILL');}
            rmSync(directory, { recursive: true, force: true });
        }
    });
}
