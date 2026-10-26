'use strict';
const assert = require('node:assert/strict');
const { spawn, spawnSync, execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync } = require('node:fs');
const { rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { test } = require('node:test');

const supervisor = path.join(__dirname, 'daemon-supervisor.cjs');
const policy = path.join(__dirname, 'no-orphans.cjs');
function alive(pid) {try {process.kill(pid, 0); return true;} catch {return false;}}
async function until(check, description) {
    for (let i = 0; i < 200; i++) {if (check()) {return;} await delay(25);}
    assert.fail(typeof description === 'function' ? description() : description);
}
function records(file) {
    try {return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);} catch {return [];}
}

const hasBun = spawnSync('bun', ['--version'], { windowsHide: true }).status === 0;
for (const compiled of [false, true]) {
    test(`${compiled ? 'Bun SFE' : 'Node'} daemon survives starter exit, self-restarts, and supervisor exits after stop`, { timeout: 30000, skip: compiled && !hasBun }, async () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'daemon-中文-'));
        const report = path.join(dir, 'report.jsonl');
        const worker = path.join(dir, 'worker.cjs');
        const starter = path.join(dir, 'starter.cjs');
        const stop = path.join(dir, 'restart');
        const append = `const fs=require('node:fs');const report=x=>fs.appendFileSync(${JSON.stringify(report)},JSON.stringify(x)+'\\n');`;
        const workerSource = `const s=require(${JSON.stringify(supervisor)});s.prepare('win32');require(${JSON.stringify(policy)}).install();
            ${append}
            const generation=Number(process.env.GENERATION||0);
            const c=require('node:child_process').spawn(${JSON.stringify(process.execPath)},['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});
            report({kind:'worker',pid:process.pid,child:c.pid,generation,value:process.env.TEST_VALUE});
            const timer=setInterval(async()=>{
                if(generation || !fs.existsSync(${JSON.stringify(stop)}))return;
                clearInterval(timer);
                try {await s.spawnDaemon(process.execPath,${compiled ? "['--serve']" : "[__filename,'--serve']"},{env:{...process.env,CODEBUDDY_SESSION_KIND:'daemon',GENERATION:'1'},cwd:process.cwd()});process.exit(0);}
                catch(e){report({error:e.message});process.exit(2);}
            },25);`;
        const starterSource = `const s=require(${JSON.stringify(supervisor)});const helper=s.prepare('win32');require(${JSON.stringify(policy)}).install();
            ${append}
            report({kind:'supervisor',pid:helper.pid});
            (async()=>{
                try {await s.spawnDaemon('missing-daemon-executable', ['--serve'],{env:{...process.env,CODEBUDDY_SESSION_KIND:'daemon'}});throw Error('missing executable accepted');}
                catch(e){if(!e.message.includes('missing-daemon-executable'))throw e;}
                const result=await s.spawnDaemon(process.execPath,${JSON.stringify(compiled ? ['--serve'] : [worker, '--serve'])},{env:{...process.env,CODEBUDDY_SESSION_KIND:'daemon',TEST_VALUE:'环境🚀'},cwd:${JSON.stringify(dir)}});
                report({kind:'started',pid:result.pid});
            })().catch(e=>{report({error:e.message});process.exitCode=1;});`;
        let executable = process.execPath;
        if (compiled) {
            const addon = path.join(__dirname, 'native', `win32-${process.arch}`, 'job-object.node');
            writeFileSync(starter, `globalThis.__CODEBUDDY_WINDOWS_JOB_NATIVE__=()=>require(${JSON.stringify(addon)});
                const supervisor=require(${JSON.stringify(supervisor)});
                if(process.argv[2]===supervisor.FLAG && process.send){supervisor.run();}
                else if(process.argv.includes('--serve')){${workerSource}}
                else {${starterSource}}`);
            executable = path.join(dir, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
            execFileSync('bun', ['build', '--compile', starter, '--outfile', executable], { windowsHide: true, stdio: 'pipe' });
        } else {
            writeFileSync(worker, workerSource);
            writeFileSync(starter, starterSource);
        }
        const host = spawn(executable, compiled ? ['daemon', 'start'] : [starter, 'daemon', 'start'], { stdio: 'ignore', windowsHide: true });
        try {
            await until(() => records(report).some(x => x.kind === 'worker'), () => 'daemon did not report: ' + JSON.stringify(records(report)));
            await until(() => host.exitCode !== null, 'starter stayed alive after daemon startup');
            assert.equal(host.exitCode, 0);
            const first = records(report).find(x => x.kind === 'worker');
            assert.equal(first.value, '环境🚀');
            assert.ok(alive(first.pid), 'daemon must survive the starter Job');
            writeFileSync(stop, 'restart');
            await until(() => records(report).some(x => x.generation === 1), 'replacement daemon did not report');
            await until(() => !alive(first.pid), 'old daemon did not exit');
            const second = records(report).find(x => x.generation === 1);
            assert.ok(alive(second.pid), 'replacement must survive the old daemon Job');
            if (process.platform === 'win32') {
                await until(() => !alive(first.child), 'old daemon leaked its child');
            }
            process.kill(second.pid, 'SIGKILL');
            if (process.platform === 'win32') {
                await until(() => !alive(second.child), 'stopped daemon leaked its child');
            }
            const helper = records(report).find(x => x.kind === 'supervisor');
            await until(() => !alive(helper.pid), 'supervisor leaked after its last daemon stopped');
            assert.deepEqual(records(report).filter(x => x.error), []);
        } finally {
            host.kill('SIGKILL');
            for (const row of records(report)) {
                for (const pid of [row.pid, row.child]) {if (pid && alive(pid)) {process.kill(pid, 'SIGKILL');}}
            }
            // Windows may release the compiled executable after process exit.
            // Yield between bounded retries; keep the lifecycle assertions above.
            await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        }
    });

}
