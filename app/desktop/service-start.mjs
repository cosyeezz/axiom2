import { spawn } from 'node:child_process';

const uncertain = message => Object.assign(Error(message), { code: 'stop-unconfirmed' });

// This starts an independently managed daemon. It must not inherit the npm Job
// or Linux namespace. Cancellation only stops this request, never the daemon.
export async function startService({ file = process.execPath, args, cwd, env, signal, barrier }) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn(file, barrier ? [barrier.wrapper, barrier.nonce, ...args] : args, { cwd, env, windowsHide: true, detached: false, stdio: barrier ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'] });
    let output = [], received = 0, errorTail = Buffer.alloc(0), failure, timer, done = false, requestStopped = false;
    const preparation = new AbortController();
    let arming = Promise.resolve();
    const finish = async (error, value) => {
      if (done) return;
      done = true; preparation.abort(); clearTimeout(timer); signal.removeEventListener('abort', stop);
      await arming;
      child.stdout.destroy(); child.stderr.destroy(); if (child.connected) child.disconnect(); child.unref();
      if (error) reject(Object.assign(error, { requestStopped })); else resolve(value);
    };
    const stop = () => {
      failure ||= uncertain('后台启动请求已中断，服务可能已经启动；请重新读取服务状态。');
      preparation.abort();
      child.kill();
      timer ??= setTimeout(() => finish(failure), 8000);
    };
    signal.addEventListener('abort', stop, { once: true });
    if (barrier) {
      let receivedReady = false;
      child.on('message', message => {
        if (receivedReady || message?.kind !== 'service-ready' || message.nonce !== barrier.nonce || message.pid !== child.pid) return;
        receivedReady = true;
        arming = (async () => { try {
          await barrier.arm(child.pid, AbortSignal.any([signal, preparation.signal]));
          signal.throwIfAborted();
          if (done || !child.connected) throw uncertain('后台启动许可尚未送达，已保留请求记录。');
          child.send({ kind: 'service-go', nonce: barrier.nonce }, error => {
            if (error && !done) { failure ||= uncertain(error.message); stop(); }
          });
        } catch (error) { if (!done) { failure ||= uncertain(error.message); stop(); } } })();
      });
    }
    if (signal.aborted) stop();
    child.stdout.on('data', bytes => {
      received += bytes.length;
      if (received > 65536) { failure ||= uncertain('后台启动响应超过 64 KiB，服务状态尚未确认。'); stop(); }
      else output.push(bytes);
    });
    child.stderr.on('data', bytes => { errorTail = Buffer.concat([errorTail, bytes]).subarray(-32768); });
    child.once('error', error => { requestStopped = !child.pid; finish(child.pid ? uncertain(`后台启动请求失败，服务状态尚未确认：${error.message}`) : error); });
    child.once('close', code => {
      requestStopped = true;
      if (failure) return finish(failure);
      if (code !== 0) return finish(uncertain(`后台启动请求退出 ${code}，服务状态尚未确认。${errorTail.toString('utf8')}`));
      try {
        const service = JSON.parse(Buffer.concat(output).toString('utf8'));
        if (service.state !== 'running') throw Error('后台尚未就绪');
        if (signal.aborted) return finish(uncertain('后台启动期间操作已中断，请重新读取服务状态。'));
        finish(null, service);
      } catch (error) { finish(uncertain(`后台启动结果无法确认：${error.message}`)); }
    });
  });
}
