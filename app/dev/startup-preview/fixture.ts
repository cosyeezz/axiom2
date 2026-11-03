import { defaultMaintenanceBudgets, validMaintenanceBudgets, type MaintenanceTask } from "../../src/shared/maintenance.js";

export const scenarios = {
  update: "正常 · 有可用更新", latest: "正常 · 已是最新", stopped: "服务已停止", first: "首次安装 · 缺 Node/npm",
  missing: "后台未安装", downloading: "正在下载", forbidden: "下载失败 · HTTP 403", installFailure: "安装失败",
  interrupted: "任务中断 · 待核实", unknown: "服务状态读取失败", readonly: "环境目录不可写", windows: "Windows · MSI 待安装",
  connectionFailure: "远程连接失败", slowConnection: "连接迟到 · 可切换设备",
  clientDownloading: "客户端 · 下载中", clientForbidden: "客户端 · 下载遇到 403", clientCancelFailure: "客户端 · 取消失败",
  clientPending: "客户端 · 提交回执不完整", clientReady: "客户端 · 已下载待手动安装", clientNoAsset: "客户端 · 缺少本平台附件",
  clientLegacy: "旧桥 · 仅外链下载", windowsDownload: "Windows · 内置下载 MSI",
  windowsOlder: "Windows · 缓存包旧于新版", clientOlder: "macOS · 缓存包旧于新版",
} as const;
export type Scenario = keyof typeof scenarios;
export type PreviewCall = { name: string; args: any; at: number };
export function installFixture(scenario: Scenario, notify: (message: string) => void) {
  const windows = scenario === "windows" || scenario === "windowsDownload" || scenario === "windowsOlder", installed = !["first", "missing"].includes(scenario);
  Object.defineProperty(navigator, "platform", { configurable: true, value: windows ? "Win32" : "MacIntel" });
  // Only this dedicated origin's connection preferences are reset; no live application's storage is touched.
  localStorage.removeItem("axiom.connection.mode"); localStorage.removeItem("axiom.remote.address");
  sessionStorage.removeItem("axiom.desktop.cleanup.pending");
  let theme = localStorage.getItem("axiom.theme") || "dark", themeRevision = 0, navigation = 0;
  let serviceState = scenario === "stopped" ? "stopped" : installed ? "running" : "missing";
  let serviceVersion: string | null = installed ? "0.4.1" : null, clientVersion = "0.4.1";
  let nodeReady = scenario !== "first", tailscale = false, piVersion: string | null = null;
  let updateJob: any = null, setupJob: any = null, installer: any = ["windows", "windowsOlder"].includes(scenario) ? { version: "0.4.2", readyAt: Date.now() } : null;
  const clientAsset = windows ? "Axiom2.msi" : "Axiom2.dmg";
  let clientDownload: any = ["clientReady", "clientOlder"].includes(scenario) ? { version: "0.4.2", name: clientAsset, readyAt: Date.now(), path: `/preview-only/updates/${clientAsset}` } : null;
  const updateHistory: MaintenanceTask[] = [];
  let clientAttempts = 0, cancelAttempts = 0;
  let token: string | null = null, count = 0, view = "control";
  let updateBudgets = { ...defaultMaintenanceBudgets }, setupBudgets = { ...defaultMaintenanceBudgets };
  function budgets(value: unknown) { if (!validMaintenanceBudgets(value)) throw Error("模拟时限参数无效。"); return { ...value }; }
  const calls: PreviewCall[] = [], unexpected: string[] = [], blocked: string[] = [];
  const api = { scenario, calls, unexpected, blocked, installerOpened: false };
  (window as any).startupPreview = api;
  const latest = scenario === "latest" ? "0.4.1" : ["windowsOlder", "clientOlder"].includes(scenario) ? "0.4.3" : "0.4.2";
  const task = (resource: string, status: MaintenanceTask["status"] = "running"): MaintenanceTask => ({
    id: `preview-${++count}`, attemptId: `attempt-${count}`, endpoint: "desktop", scope: "preview-only", resource,
    action: "install", label: `${resource}（模拟）`, status, phase: "downloading", steps: ["checking", "downloading", "verifying", "installing", "validating"], completedSteps: 1,
    createdAt: Date.now(), updatedAt: Date.now(), budgets: { ...updateBudgets }, capabilities: { cancel: status === "running", extend: status === "running" },
    message: status === "interrupted" ? "模拟上次进程退出，需核实任务。" : "模拟下载与安装，不会修改系统。",
    ...(status === "running" ? { transfer: { received: 24_000_000, total: 80_000_000, bytesPerSecond: 2_000_000, updatedAt: Date.now(), connection: "receiving" as const } } : {}),
  });
  function job(kind: string, status: MaintenanceTask["status"] = "running") {
    const t = task(kind, status);
    return { kind, action: kind, id: t.id, running: status === "running", phase: status === "interrupted" ? "interrupted" : "downloading", message: t.message ?? "模拟任务", task: t, startedAt: t.createdAt, lines: [], version: latest };
  }
  if (scenario === "downloading") updateJob = job("service");
  if (scenario === "interrupted") updateJob = job("service", "interrupted");
  if (["forbidden", "installFailure"].includes(scenario)) {
    updateJob = job("service", "failed"); updateJob.phase = "error";
    updateJob.task.error = { code: scenario === "forbidden" ? "http" : "operation", phase: scenario === "forbidden" ? "downloading" : "installing", message: scenario === "forbidden" ? "下载失败: HTTP 403（模拟）" : "安装失败: 模拟安装器退出码 1" };
    updateJob.message = updateJob.task.error.message;
    updateJob.task.phase = updateJob.task.error.phase; updateJob.task.finishedAt = Date.now();
  }
  const snapshot = () => ({
    clientVersion, serviceVersion, managed: true, foregroundSupported: false, serviceInstallation: serviceVersion ? "registered" : "absent",
    clientSupported: windows, ...(scenario !== "clientLegacy" ? { clientDownloadSupported: true } : {}), clientDownload,
    clientPlatform: windows ? "win32" : "darwin", clientAsset, clientCheckedAt: Date.now(),
    release: { version: latest, checkedAt: Date.now(), assets: {} },
    clientRelease: { version: latest, checkedAt: Date.now(), assets: scenario === "clientNoAsset" ? {} : { [clientAsset]: { url: `https://github.com/cosyeezz/axiom2/releases/download/v${latest}/${clientAsset}` } } },
    clientInstaller: installer, recovery: false, log: "/preview-only/no-real-file.log", job: updateJob, budgets: updateBudgets,
    pi: { runtimeVersion: serviceVersion ? "1.1.0" : null, cli: { version: piVersion, ...(piVersion ? { packageRoot: "/preview-only/terminal-pi" } : {}) }, release: token ? { version: "1.1.1", checkedAt: Date.now(), token } : null },
  });
  const settle = (current: any, finish: () => void) => window.setTimeout(() => {
    if (!current.running) return;
    current.running = false; current.phase = "done"; current.message = "模拟完成（未执行系统操作）";
    Object.assign(current.task, { status: "succeeded", phase: "validating", completedSteps: 5, finishedAt: Date.now(), updatedAt: Date.now(), transfer: undefined, message: current.message, capabilities: { cancel: false, extend: false } });
    finish(); notify(current.message);
  }, 2800);
  function finishTask(current: any, status: "succeeded" | "failed" | "cancelled", message: string) {
    current.running = false; current.phase = status === "succeeded" ? "ready" : status === "failed" ? "error" : "cancelled"; current.message = message;
    Object.assign(current.task, { status, message, updatedAt: Date.now(), finishedAt: Date.now(), transfer: undefined, capabilities: { cancel: false, extend: false } });
    if (status === "succeeded") { current.task.phase = "verifying"; current.task.completedSteps = current.task.steps.length; }
  }
  function startClient() {
    clientAttempts++;
    const current = job("client");
    current.task.action = "download"; current.task.steps = ["checking", "downloading", "verifying"];
    current.task.message = current.message = "模拟内置客户端下载；不会访问下载源或执行安装。";
    const startedAt = Date.now();
    current.task.transfer = { received: 0, total: 80_000_000, updatedAt: startedAt, connection: "receiving" };
    const attempt = clientAttempts;
    const timer = window.setInterval(() => {
      // Never let an old timer resurrect a cancelled/failed/replaced task.
      if (!current.running || updateJob !== current) { window.clearInterval(timer); return; }
      const elapsed = Date.now() - startedAt;
      if (scenario === "clientForbidden" && attempt === 1 && elapsed >= 1500) {
        finishTask(current, "failed", "客户端下载失败（HTTP 403，模拟）；可重试，未执行安装。");
        current.task.error = { code: "http", phase: "downloading", message: current.message };
        window.clearInterval(timer); return;
      }
      current.task.updatedAt = Date.now();
      current.task.transfer = { received: Math.min(80_000_000, elapsed * 10_000), total: 80_000_000, bytesPerSecond: 10_000_000, updatedAt: Date.now(), connection: "receiving" };
      if (elapsed >= 8000) {
        finishTask(current, "succeeded", "模拟安装包已下载并校验，尚未安装。");
        if (windows) installer = { version: latest, readyAt: Date.now() };
        else clientDownload = { version: latest, name: clientAsset, readyAt: Date.now(), path: `/preview-only/updates/${clientAsset}` };
        window.clearInterval(timer); notify(current.message);
      }
    }, 500);
    return current;
  }
  if (["clientDownloading", "clientCancelFailure"].includes(scenario)) updateJob = startClient();
  function unsupported(name: string, action: string) {
    const message = `浏览器预览未模拟 ${name}:${action}；未执行系统操作。`;
    blocked.push(message); notify(message); throw Error(message);
  }
  const invoke = async (name: string, args: any = {}) => {
    calls.push({ name, args: structuredClone(args), at: Date.now() });
    window.dispatchEvent(new Event("preview-call"));
    if (name === "axiom_theme") { if (args.theme) { theme = args.theme; themeRevision++; } return { theme, revision: themeRevision }; }
    if (name === "axiom_peers") return { peers: [{ name: "模拟工作站", ip: "100.64.0.8" }] };
    if (name === "axiom_service") {
      if (scenario === "unknown") throw Error("模拟服务状态读取失败；禁止启停。");
      if (args.action === "start") { serviceState = "running"; notify("已模拟启动服务。"); }
      else if (args.action === "stop") { serviceState = "stopped"; notify("已模拟停止服务，真实后台不受影响。"); }
      else if (args.action !== "status") return unsupported(name, args.action);
      return { desktopView: view, state: serviceState, active: serviceState === "running" ? ["模拟会话 A", "模拟会话 B"] : [], artifact: { download: { state: "absent" }, installation: { state: serviceVersion ? "verified" : "absent" } }, background: true };
    }
    if (name === "axiom_setup") {
      if (args.action === "check") return { nodeReady, nodeVersion: nodeReady ? "v24.13.0" : "", writable: scenario !== "readonly", tailscale, platform: windows ? "win32" : "darwin" };
      if (args.action === "status") return { job: structuredClone(setupJob), budgets: setupBudgets };
      if (args.action === "history") return { tasks: setupJob ? [setupJob.task] : [] };
      if (["node", "tailscale", "service"].includes(args.action)) {
        if (setupJob?.running) throw Error("模拟任务正在运行；拒绝重复提交。");
        if (scenario === "readonly") throw Error("模拟安装目录不可写。");
        setupJob = job(args.action); setupJob.task.budgets = { ...setupBudgets };
        const current = setupJob;
        settle(current, () => { if (args.action === "node") nodeReady = true; if (args.action === "tailscale") tailscale = true; if (args.action === "service") { serviceVersion = latest; serviceState = "stopped"; } });
        return { job: structuredClone(setupJob) };
      }
      if (args.action === "defaults") { setupBudgets = budgets(args.maintenance?.budgets); return { job: structuredClone(setupJob), budgets: setupBudgets }; }
      if (["cancel", "extend", "reconcile-service", "acknowledge-interruption"].includes(args.action)) {
        if (!setupJob || args.maintenance?.id && args.maintenance.id !== setupJob.id) throw Error("模拟任务身份已失效。");
        if (args.action === "extend") setupJob.task.budgets = budgets(args.maintenance?.budgets);
        if (args.action !== "extend") { setupJob.running = false; setupJob.phase = "done"; setupJob.task.status = "cancelled"; }
        return { job: structuredClone(setupJob) };
      }
      return unsupported(name, args.action);
    }
    if (name === "axiom_update") {
      if (args.action === "history") return { tasks: structuredClone([...updateHistory, ...(updateJob ? [updateJob.task] : [])]) };
      if (["status", "check", "pi-refresh"].includes(args.action)) return structuredClone(snapshot());
      if (args.action === "pi-check") { token = `preview-token-${++count}`; return structuredClone(snapshot()); }
      if (["service", "pi", "client"].includes(args.action)) {
        if (updateJob?.running) throw Error("模拟更新正在运行；拒绝重复提交。");
        if (args.action === "pi" && (!token || args.version !== token)) throw Error("模拟确认令牌已失效。");
        if (args.action === "client") {
          if (scenario === "clientLegacy" || scenario === "clientNoAsset" || args.version !== latest) throw Error("模拟本平台附件或版本无效；未提交下载。");
          if (updateJob) updateHistory.push(structuredClone(updateJob.task));
          updateJob = startClient();
          if (scenario === "clientPending" && clientAttempts === 1) return {}; // Accepted, but response shape is unknown: UI must reconcile, not resubmit.
          return structuredClone(snapshot());
        }
        if (args.action === "pi") token = null;
        if (updateJob) updateHistory.push(structuredClone(updateJob.task));
        updateJob = job(args.action); const current = updateJob;
        settle(current, () => { if (args.action === "service") { serviceVersion = latest; serviceState = "stopped"; } if (args.action === "pi") piVersion = "1.1.1"; });
        return structuredClone(snapshot());
      }
      if (args.action === "installer") { if (!windows || !installer) throw Error("本平台不支持模拟打开安装器，或没有已校验的模拟安装包。"); api.installerOpened = true; notify("已模拟打开 MSI 向导；没有下载、退出客户端或运行安装器。"); return {}; }
      if (["cancel", "extend", "reconcile", "defaults"].includes(args.action)) {
        const payload = JSON.parse(args.version || "{}");
        if (args.action !== "defaults" && (!updateJob || payload.id !== updateJob.task.id)) throw Error("模拟任务身份已失效。");
        if (args.action === "defaults") updateBudgets = budgets(payload.budgets);
        if (args.action === "extend") updateJob.task.budgets = budgets(payload.budgets);
        if (args.action === "reconcile") { updateJob.reconciled = true; updateJob.phase = "done"; updateJob.task.status = "cancelled"; }
        if (args.action === "cancel") {
          if (scenario === "clientCancelFailure" && ++cancelAttempts === 1) throw Error("模拟取消失败；任务仍在运行，请重新读取。");
          if (!updateJob.running || !updateJob.task.capabilities.cancel) throw Error("模拟任务已结束，不能取消。");
          finishTask(updateJob, "cancelled", "模拟下载已取消，未执行安装。");
        }
        return structuredClone(snapshot());
      }
      return unsupported(name, args.action);
    }
    if (name === "axiom_cleanup") {
      if (["resources.get", "rea.get", "rtk.get", "ffmpeg.get", "opencli.get", "modelProxy.get"].includes(args.request?.op)) return { requestId: args.request.requestId, data: { revision: "preview-empty", items: [], scopes: [], warnings: [], installations: {}, engines: [] } };
      return unsupported(name, args.request?.op);
    }
    if (name === "axiom_environment") return null;
    if (name === "axiom_reveal_path") { notify("模拟文件路径，未打开本机目录。"); return; }
    if (name === "axiom_controls") { ++navigation; view = "control"; return; }
    if (name === "axiom_connection") return "disconnected";
    if (name === "axiom_backend_updates" && args.action === "get") return { runningVersion: serviceVersion, latest: null, checkedAt: null, checking: false, available: false, pending: false, error: null, sourceOrigin: location.origin };
    if (name === "axiom_local" || name === "axiom_remote") {
      const epoch = navigation;
      if (scenario === "slowConnection") await new Promise(resolve => setTimeout(resolve, 6000));
      if (scenario === "connectionFailure") throw Error("模拟连接失败；未访问远程设备。");
      if (navigation === epoch) { view = "control"; notify(`已模拟连接 ${name === "axiom_local" ? "本机" : args.address}:${args.port}，仍停留在测试页。`); }
      return { url: location.origin + "/#simulated-workbench" };
    }
    unexpected.push(`${name}:${args.action || ""}`); throw Error(`未定义的模拟 IPC：${name}。禁止回退至真实服务。`);
  };
  (window as any).__TAURI_INTERNALS__ = { invoke };
  return api;
}
