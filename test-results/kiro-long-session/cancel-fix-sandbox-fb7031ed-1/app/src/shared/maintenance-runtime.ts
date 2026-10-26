import { defaultMaintenanceBudgets, MaintenanceError, maintenanceActive, type MaintenanceBudgets, type MaintenancePhase, type MaintenanceTask } from "./maintenance.js";

/** Execution-local state; adapters own persistence, permission checks and side effects. */
export class MaintenanceExecution {
  private timer: ReturnType<typeof setInterval>;
  private phaseStartedAt = Date.now();
  private lastPublished = 0;
  constructor(readonly task: MaintenanceTask, readonly controller: AbortController, private publish: () => void) {
    this.timer = setInterval(() => {
      if (!task.capabilities.extend) return;
      if (task.startedAt && Date.now() - task.startedAt >= task.budgets.totalMs) this.abort("total-timeout", "任务已达到总时限，请核实当前安装状态后重试。");
      if (task.phase === "installing" && Date.now() - this.phaseStartedAt >= task.budgets.installMs) this.abort("install-timeout", "安装阶段已达到时限，请核实当前安装状态。");
    }, 250);
  }
  get signal() { return this.controller.signal; }
  get budgets() { return this.task.budgets; }
  remainingBudget() {
    const now = Date.now(), total = this.budgets.totalMs - (now - (this.task.startedAt ?? now));
    const install = this.task.phase === "installing" ? this.budgets.installMs - (now - this.phaseStartedAt) : Infinity;
    return install < total ? { remainingMs: install, code: "install-timeout" as const } : { remainingMs: total, code: "total-timeout" as const };
  }
  abort(code: ConstructorParameters<typeof MaintenanceError>[0], message: string) {
    if (!this.signal.aborted) this.controller.abort(new MaintenanceError(code, message));
  }
  update(force = false) {
    this.task.updatedAt = Date.now();
    if (force || this.task.updatedAt - this.lastPublished >= 250) { this.lastPublished = this.task.updatedAt; this.publish(); }
  }
  phase(phase: MaintenancePhase, message?: string) {
    if (phase !== this.task.phase) {
      this.task.phase = phase; this.phaseStartedAt = Date.now(); delete this.task.transfer;
      const step = this.task.steps.indexOf(phase);
      if (step >= 0) this.task.completedSteps = Math.max(this.task.completedSteps, step);
    }
    if (phase !== "queued" && !this.task.startedAt) this.task.startedAt = Date.now();
    if (message) this.task.message = message;
    this.update(true);
  }
  fail(error: unknown) {
    // Cleanup uncertainty cannot be downgraded by a later cancellation catch.
    if (this.task.status === "unknown") return;
    const unconfirmed = error instanceof MaintenanceError && error.code === "stop-unconfirmed";
    const reason = unconfirmed ? error : this.signal.aborted ? this.signal.reason : error;
    const code = reason instanceof MaintenanceError ? reason.code : this.signal.aborted ? "cancelled" : "operation";
    this.task.status = code === "stop-unconfirmed" ? "unknown" : code === "cancelled" ? "cancelled" : "failed";
    this.task.error = { code, message: reason instanceof MaintenanceError ? reason.message : "操作未完成，请到来源页面核实安装结果。", phase: this.task.phase };
  }
  finish() {
    clearInterval(this.timer);
    if (maintenanceActive(this.task)) {
      if (this.signal.aborted) this.fail(this.signal.reason);
      else { this.task.status = "succeeded"; this.task.completedSteps = this.task.steps.length; }
    }
    this.task.finishedAt = Date.now(); this.task.capabilities = { cancel: false, extend: false }; this.update(true);
  }
}

// Fetch/undici can surface only `TypeError: terminated` when a response body
// breaks. Keep the cause for diagnostics, never persist its raw text/URLs in UI.
const networkFailure = (error: unknown) => error instanceof TypeError ? Object.assign(new MaintenanceError("network", "下载连接失败或中断，请检查网络后重试。"), { cause: error }) : error;

/** Header and stream-idle budgets are independent. No timer is inferred from installer console silence. */
export async function maintenanceFetch(url: string, init: RequestInit = {}, execution?: MaintenanceExecution, budgets: MaintenanceBudgets = defaultMaintenanceBudgets, fetcher: typeof fetch = fetch): Promise<Response> {
  const origin = new URL(url).origin;
  const controller = new AbortController(), signal = AbortSignal.any([controller.signal, ...(init.signal ? [init.signal] : []), ...(execution ? [execution.signal] : [])]);
  const started = Date.now(); let requestStarted = started, lastData = started, headers = false, retrying = false, closed = false, attempt = 0;
  let received = 0, sampleBytes = 0, sampleTime = started, rate: number | undefined;
  const effective = () => execution?.budgets ?? budgets;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, output: ReadableStreamDefaultController<Uint8Array> | undefined;
  const abort = () => { if (closed) return; output?.error(signal.reason); void reader?.cancel(signal.reason).catch(() => {}); close(); };
  const close = () => { if (closed) return; closed = true; clearInterval(timer); signal.removeEventListener("abort", abort); };
  const timer = setInterval(() => {
    const now = Date.now(), limits = effective();
    if (!execution && now - started >= limits.totalMs) controller.abort(new MaintenanceError("total-timeout", "下载已达到总时限。"));
    else if (!headers && !retrying && now - requestStarted >= limits.headersMs) controller.abort(new MaintenanceError("headers-timeout", "等待下载源响应头超时，可延长连接等待后重试。"));
    else if (headers && now - lastData >= limits.idleMs) controller.abort(new MaintenanceError("idle-timeout", "下载源长时间没有返回数据，可延长无数据等待后重试。"));
    if (!retrying && execution?.task.transfer && now - lastData >= 2000) {
      execution.task.transfer.connection = "waiting"; execution.task.transfer.bytesPerSecond = 0; execution.update();
    }
  }, 250);
  signal.addEventListener("abort", abort, { once: true });
  if (execution) {
    execution.phase("downloading");
    // Only the origin is retained: subscription paths and query strings may contain credentials.
    execution.task.transfer = { received: 0, updatedAt: started, connection: "connecting", source: origin }; execution.update(true);
  }
  try {
    signal.throwIfAborted();
    const retryable = ["GET", "HEAD"].includes((init.method ?? "GET").toUpperCase()) && init.body == null;
    let response: Response;
    while (true) {
      requestStarted = Date.now(); retrying = false;
      let failure: unknown;
      let receivedResponse: Response | undefined;
      try { receivedResponse = await fetcher(url, { ...init, signal }); signal.throwIfAborted(); }
      catch (error) { if (signal.aborted || !(error instanceof TypeError)) throw error; failure = error; }
      if (!retryable || attempt >= 2 || receivedResponse && ![408, 429, 502, 503, 504].includes(receivedResponse.status)) {
        if (!receivedResponse) throw failure;
        response = receivedResponse; break;
      }
      const retryAfter = receivedResponse?.headers.get("retry-after");
      const requestedWait = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter.trim()) ? Number(retryAfter) * 1000 : retryAfter ? Date.parse(retryAfter) - Date.now() : NaN;
      const wait = Number.isFinite(requestedWait) ? Math.max(0, requestedWait) : 300 * 2 ** attempt;
      const remaining = effective().totalMs - (Date.now() - (execution?.task.startedAt ?? started));
      // Do not violate Retry-After or retry a side-effecting operation beyond its budget.
      if (wait >= remaining) { if (!receivedResponse) throw failure; response = receivedResponse; break; }
      void receivedResponse?.body?.cancel().catch(() => {});
      attempt++; retrying = true;
      if (execution) { execution.task.transfer = { received: 0, updatedAt: Date.now(), source: origin, connection: "retrying", attempt, retryAt: Date.now() + wait }; execution.update(true); }
      await new Promise<void>((resolve, reject) => {
        const abortWait = () => { clearTimeout(waitTimer); signal.removeEventListener("abort", abortWait); reject(signal.reason); };
        const waitTimer = setTimeout(() => { signal.removeEventListener("abort", abortWait); resolve(); }, wait);
        signal.addEventListener("abort", abortWait, { once: true }); if (signal.aborted) abortWait();
      });
      signal.throwIfAborted();
      if (execution) { execution.task.transfer = { received: 0, updatedAt: Date.now(), source: origin, connection: "connecting", attempt }; execution.update(true); }
    }
    headers = true; lastData = Date.now();
    if (!response.body) { close(); return response; }
    const length = response.headers.get("content-length"), rawTotal = length === null ? NaN : Number(length);
    const total = !response.headers.get("content-encoding") && Number.isSafeInteger(rawTotal) && rawTotal > 0 ? rawTotal : undefined;
    reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      start(stream) { output = stream; if (signal.aborted) abort(); },
      async pull(stream) {
        try {
          signal.throwIfAborted(); const item = await reader!.read();
          signal.throwIfAborted();
          if (item.done) {
            if (total !== undefined && received !== total) throw new MaintenanceError("network", "下载字节数与响应长度不符，请重新下载；未继续使用不完整文件。");
            close();
            if (execution?.task.transfer) { execution.task.transfer.connection = "finished"; execution.task.transfer.bytesPerSecond = undefined; execution.update(true); }
            stream.close(); return;
          }
          received += item.value.byteLength; lastData = Date.now();
          if (lastData - sampleTime >= 500) { rate = (received - sampleBytes) * 1000 / (lastData - sampleTime); sampleBytes = received; sampleTime = lastData; }
          if (execution) {
            execution.task.transfer = { received, total: total && received <= total ? total : undefined, bytesPerSecond: rate, updatedAt: lastData, connection: "receiving", source: origin, attempt }; execution.update();
          }
          stream.enqueue(item.value);
        } catch (error) { if (!closed) { close(); void reader!.cancel().catch(() => {}); stream.error(signal.aborted ? signal.reason : networkFailure(error)); } }
      },
      cancel(reason) { close(); controller.abort(reason); void reader!.cancel(reason).catch(() => {}); },
    });
    const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    Object.defineProperties(result, { url: { value: response.url }, redirected: { value: response.redirected }, type: { value: response.type } });
    return result;
  } catch (error) { close(); throw signal.aborted ? signal.reason : networkFailure(error); }
}
