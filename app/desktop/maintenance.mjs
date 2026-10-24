// Desktop adapter: Node built-ins only, usable before a backend is running.
import { randomUUID } from 'node:crypto';
export const budgetsDefault = { headersMs: 30000, idleMs: 60000, installMs: 600000, totalMs: 1200000 };
export const validBudgets = value => !!value && Object.keys(value).length === 4 && Object.keys(budgetsDefault).every(key => Number.isSafeInteger(value[key]) && value[key] >= 1000 && value[key] <= 86400000);
export function desktopTask(resource, action, budgets = budgetsDefault) {
  const now = Date.now();
  const checking = resource === 'check' || resource === 'pi-check' || resource === 'pi-refresh';
  return { id: randomUUID(), attemptId: randomUUID(), endpoint: 'desktop', scope: '当前电脑 · 应用级', resource, label: ({ check: '版本检查', 'pi-check': 'Pi 版本检查', 'pi-refresh': 'Pi 安装状态', client: '桌面客户端安装包', service: '后台服务', pi: '终端 Pi', node: 'Node.js 与 npm', tailscale: 'Tailscale', recover: '后台恢复' })[resource] ?? resource, action, status: 'running', phase: 'checking', steps: checking ? ['checking'] : resource === 'client' ? ['checking','downloading','verifying'] : ['checking','downloading','verifying','installing','validating'], completedSteps: 0, createdAt: now, startedAt: now, updatedAt: now, budgets: { ...budgets }, capabilities: { cancel: false, extend: false } };
}
export class DesktopExecution {
  constructor(task, publish, controls = async () => null) {
    this.task = task; this.publish = publish; this.controls = controls; this.controller = new AbortController(); this.phaseStart = Date.now(); this.pending = Promise.resolve();
    this.timer = setInterval(() => { void this.tick().catch(() => { this.abort('operation', '无法读取维护控制状态，请核实结果。'); }); }, 250);
  }
  get signal() { return this.controller.signal; }
  abort(code, message) { if (!this.signal.aborted) this.controller.abort(Object.assign(Error(message), { code })); }
  async tick() {
    if (this.polling || this.finished) return;
    this.polling = true;
    try {
      const control = await this.controls();
      if (this.finished) return;
      if (control?.budgets && validBudgets(control.budgets)) for (const key of Object.keys(budgetsDefault)) this.task.budgets[key] = Math.max(this.task.budgets[key], control.budgets[key]);
      if (control?.cancel && this.task.capabilities.cancel) { this.task.status = 'cancelling'; this.abort('cancelled', '已取消操作，等待清理完成。'); }
      if (this.task.capabilities.extend) {
        if (Date.now() - this.task.startedAt >= this.task.budgets.totalMs) this.abort('total-timeout', '任务达到总时限，请核实安装状态。');
        else if (this.task.phase === 'installing' && Date.now() - this.phaseStart >= this.task.budgets.installMs) this.abort('install-timeout', '安装阶段达到时限，请核实安装状态。');
      }
      await this.update();
    } finally { this.polling = false; }
  }
  update() {
    this.task.updatedAt = Date.now(); const snapshot = structuredClone(this.task);
    const pending = this.pending.then(() => this.publish(snapshot));
    this.pending = pending.catch(() => {}); return pending;
  }
  async phase(phase, message, controllable = true) {
    if (controllable) this.signal.throwIfAborted();
    if (this.task.phase !== phase) { this.phaseStart = Date.now(); this.task.phase = phase; delete this.task.transfer; }
    const step = this.task.steps.indexOf(phase); if (step >= 0) this.task.completedSteps = Math.max(this.task.completedSteps, step);
    this.task.message = message; this.task.capabilities = { cancel: controllable, extend: controllable }; await this.update();
  }
  async finish(error) {
    this.finished = true;
    clearInterval(this.timer);
    if (this.polling) await this.pending.catch(() => {});
    const cause = error?.code === 'stop-unconfirmed' ? error : this.signal.aborted ? this.signal.reason : error;
    this.task.status = cause ? cause.code === 'stop-unconfirmed' ? 'unknown' : cause.code === 'cancelled' ? 'cancelled' : 'failed' : 'succeeded';
    if (cause) this.task.error = { code: cause.code ?? 'operation', message: cause.message, phase: this.task.phase };
    else this.task.completedSteps = this.task.steps.length;
    this.task.finishedAt = Date.now(); this.task.capabilities = { cancel: false, extend: false }; await this.update();
  }
  async fetch(url, fetcher = fetch, init = {}) {
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, this.signal, ...(init.signal ? [init.signal] : [])]);
    let headers = false, last = Date.now(), reader, output, closed = false, retrying = false, attempt = 0, requestStarted = last;
    const started = last, source = new URL(url).origin;
    const networkFailure = error => error instanceof TypeError ? Object.assign(Error('下载连接失败，请检查网络后重试。', { cause: error }), { code: 'network' }) : error;
    this.task.transfer = { received: 0, connection: 'connecting', updatedAt: last, source }; await this.update();
    const close = () => { if (closed) return; closed = true; clearInterval(timer); signal.removeEventListener('abort', abort); };
    const abort = () => { if (closed) return; output?.error(signal.reason); void reader?.cancel(signal.reason).catch(() => {}); close(); };
    const timer = setInterval(() => {
      const limits = this.task.budgets, now = Date.now();
      if (now - (this.task.startedAt ?? started) >= limits.totalMs) controller.abort(Object.assign(Error('下载已达到总时限。'), { code: 'total-timeout' }));
      else if (!headers && !retrying && now - requestStarted >= limits.headersMs) controller.abort(Object.assign(Error('等待下载源响应头超时。'), { code: 'headers-timeout' }));
      else if (headers && now - last >= limits.idleMs) controller.abort(Object.assign(Error('下载源长时间没有返回数据。'), { code: 'idle-timeout' }));
      if (!retrying && this.task.transfer && now - last > 2000) { this.task.transfer.connection = 'waiting'; this.task.transfer.bytesPerSecond = 0; }
    }, 250);
    signal.addEventListener('abort', abort, { once: true });
    try {
      signal.throwIfAborted();
      const retryable = ['GET', 'HEAD'].includes((init.method ?? 'GET').toUpperCase()) && init.body == null;
      let response;
      while (true) {
        requestStarted = Date.now(); retrying = false;
        let failure, receivedResponse;
        try { receivedResponse = await fetcher(url, { ...init, signal }); signal.throwIfAborted(); }
        catch (error) { if (signal.aborted || !(error instanceof TypeError)) throw error; failure = error; }
        if (!retryable || attempt >= 2 || receivedResponse && ![408, 429, 502, 503, 504].includes(receivedResponse.status)) {
          if (!receivedResponse) throw failure;
          response = receivedResponse; break;
        }
        const retryAfter = receivedResponse?.headers.get('retry-after');
        const requestedWait = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
        const wait = Number.isFinite(requestedWait) ? Math.max(0, requestedWait) : 300 * 2 ** attempt;
        const remaining = this.task.budgets.totalMs - (Date.now() - (this.task.startedAt ?? started));
        if (wait >= remaining) { if (!receivedResponse) throw failure; response = receivedResponse; break; }
        void receivedResponse?.body?.cancel().catch(() => {});
        attempt++; retrying = true;
        this.task.transfer = { received: 0, updatedAt: Date.now(), source, connection: 'retrying', attempt, retryAt: Date.now() + wait }; await this.update();
        await new Promise((resolve, reject) => {
          const abortWait = () => { clearTimeout(waitTimer); signal.removeEventListener('abort', abortWait); reject(signal.reason); };
          const waitTimer = setTimeout(() => { signal.removeEventListener('abort', abortWait); resolve(); }, wait);
          signal.addEventListener('abort', abortWait, { once: true }); if (signal.aborted) abortWait();
        });
        signal.throwIfAborted();
        this.task.transfer = { received: 0, updatedAt: Date.now(), source, connection: 'connecting', attempt }; await this.update();
      }
      headers = true; last = Date.now();
      if (!response.body) { close(); return response; }
      reader = response.body.getReader();
      const raw = Number(response.headers.get('content-length')), total = !response.headers.get('content-encoding') && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined;
      let received = 0, sampleBytes = 0, sampleTime = last, rate;
      const body = new ReadableStream({
        start(stream) { output = stream; if (signal.aborted) abort(); },
        pull: async stream => {
          try {
            signal.throwIfAborted(); const item = await reader.read(); signal.throwIfAborted();
            if (item.done) {
              if (total !== undefined && received !== total) throw Object.assign(Error('下载字节数与响应长度不符，请重新下载。'), { code: 'network' });
              close(); if (this.task.transfer) { this.task.transfer.connection = 'finished'; delete this.task.transfer.bytesPerSecond; } stream.close(); return;
            }
            received += item.value.length; last = Date.now();
            if (last - sampleTime >= 500) { rate = (received - sampleBytes) * 1000 / (last - sampleTime); sampleBytes = received; sampleTime = last; }
            this.task.transfer = { received, total: received <= total ? total : undefined, bytesPerSecond: rate, connection: 'receiving', updatedAt: last, source, attempt };
            stream.enqueue(item.value);
          } catch (error) { if (!closed) { close(); void reader.cancel().catch(() => {}); stream.error(signal.aborted ? signal.reason : networkFailure(error)); } }
        },
        cancel: reason => { close(); controller.abort(reason); void reader.cancel(reason).catch(() => {}); },
      });
      const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperties(result, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
      return result;
    } catch (error) { close(); throw signal.aborted ? signal.reason : networkFailure(error); }
  }
}
