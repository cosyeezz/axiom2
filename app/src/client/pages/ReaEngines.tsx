import { Icon } from "../Icon.js";
import { BuiltinRecovery } from "./BuiltinRecovery.js";
import { LocalPath, revealLocalPath } from "../LocalPath.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { useState } from "react";
import { compareEngineVersions, engineDownloadSatisfied, engineRecommendationSatisfied, supportedReaEngineContract, reaEngineLabels, reaEngineStatusLabels, type ReaEngineReleaseState, type ReaEngineState } from "../../shared/rea-engines.js";
import type { ReaState } from "../../shared/rea.js";
import type { CleanupScope } from "../../shared/cleanup-scope.js";

export type ReaFeedback = { text: string; error?: boolean; jobId?: string };
type Action = (op: string, params?: Record<string, unknown>) => Promise<void>;
const ghidraJavaRequirement = "Ghidra 需要依赖 JDK 21，请先在上方「JDK 21」组件中下载并安装；安装 Ghidra 不会自动安装 JDK。";
export function ReaEngines({ state, busy, blocked, sending, feedback, action, reportedErrorResources }: { state: ReaState; busy: boolean; blocked: boolean; sending: string[]; feedback: Record<string, ReaFeedback>; action: Action; reportedErrorResources: string[] }) {
  return <section className="section tools-section rea-engines-section" aria-labelledby="rea-engines-heading">
    <div className="section-heading"><h3 id="rea-engines-heading">分析引擎与配套组件</h3><p>REA {state.version ?? "未安装"}{state.engineHost && ` · ${({ win32: "Windows", darwin: "macOS", linux: "Linux" } as Record<string, string>)[state.engineHost.platform] ?? state.engineHost.platform} ${state.engineHost.arch}`}</p></div>
    {state.engines?.map(engine => <Engine key={engine.id} engine={engine} state={state} uninstallBusy={busy} blocked={blocked} sending={sending.includes(`rea:${engine.id}`)} feedback={feedback[`rea:${engine.id}`]} action={action} reportedError={reportedErrorResources.includes(`rea:${engine.id}`)} />)}
  </section>;
}
function installLabel(engine: ReaEngineState) {
  if (!engine.version) return "安装";
  const comparison = engine.available ? compareEngineVersions(engine.available.version, engine.version) : undefined;
  return comparison === 0 ? "修复" : comparison === -1 ? "切换推荐版" : "更新";
}
function Engine({ engine, state, uninstallBusy, blocked, sending, feedback, action, reportedError }: { engine: ReaEngineState; state: ReaState; uninstallBusy: boolean; blocked: boolean; sending: boolean; feedback?: ReaFeedback; action: Action; reportedError: boolean }) {
  const job = (state.jobs ?? (state.job ? [state.job] : [])).find(job => job.engine === engine.id);
  const busy = blocked || sending || !!job?.running;
  const revision = engine.revision ?? state.revision;
  const [openError, setOpenError] = useState("");
  const error = openError || (feedback?.error ? feedback.text : !feedback ? job?.error : undefined);
  const [uninstall, setUninstall] = useState<string>();
  const [externalUninstall, setExternalUninstall] = useState(false);
  const [clearDownload, setClearDownload] = useState<{ revision: string; scope: CleanupScope }>();
  const [confirm, setConfirm] = useState<{ revision: string; version: string; operation: "install" | "download" | "open"; release?: ReaEngineReleaseState; downloadPath?: string; recommendedVersion?: string }>();
  const unsupported = engine.status === "unsupported", label = reaEngineLabels[engine.id];
  const manual = !engine.installable && (engine.id === "ghidra" || engine.id === "hopper" && state.engineHost?.platform === "darwin");
  const downloadable = engine.installable || manual;
  const unavailable = busy || !state.supported || !!state.supportError || unsupported || !supportedReaEngineContract(state.version);
  const current = engineRecommendationSatisfied(engine), downloaded = engineDownloadSatisfied(engine);
  const recommended = engine.available?.version ?? engine.recommendedVersion;
  const cachedInstall = !!engine.download && (engine.installable || engine.id === "hopper" && state.engineHost?.platform === "darwin") && (downloaded || !recommended);
  const stale = !!confirm && (confirm.revision !== revision || (confirm.release ? confirm.release.token !== engine.available?.token : confirm.downloadPath !== engine.download?.path || confirm.version !== engine.download?.version || confirm.recommendedVersion !== recommended));
  const installerOpened = job?.kind === "engine-open-installer" && !job.running && !job.error && job.message.startsWith("已打开");
  const status = current ? engine.id === "hopper" ? "已安装 · 待许可验证" : "已是推荐版本" : installerOpened ? "待完成系统安装" : downloaded ? "已下载 · 待安装" : reaEngineStatusLabels[engine.status];
  const selectRelease = (operation: "install" | "download") => engine.available && setConfirm({ revision, version: engine.available.version, release: engine.available, operation });
  const downloadId = engine.id === "ghidra" || engine.id === "hopper" ? engine.id : undefined;
  const downloadCleanup = downloadId ? state.downloadCleanup?.[downloadId] : undefined;
  const downloadCleanupError = downloadId ? state.downloadCleanupErrors?.[downloadId] : undefined;
  const staleDownloadCleanup = !!clearDownload && (clearDownload.revision !== state.revision || clearDownload.scope.revision !== downloadCleanup?.revision || !!downloadCleanupError);
  const externalHopper = engine.id === "hopper" && !!engine.path && !["missing", "unsupported"].includes(engine.status);
  const hopperApplication = state.engineHost?.platform === "darwin" ? /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(engine.path)?.[1] : undefined;
  return <BackendMaintenance resource={`rea:${engine.id}`} label={label} activeOnly showError={!reportedError} location="">
    <div className="rea-engine-summary">
      <dl className="rea-engine-versions"><div><dt>当前版本</dt><dd>{engine.version ?? (engine.path ? "待检测" : "未安装")}</dd></div><div><dt>{engine.id === "hopper" ? "官方版本" : "推荐版本"}</dt><dd>{recommended ?? (engine.id === "java" && supportedReaEngineContract(state.version) ? "21 · 待检查修订" : "待检查")}</dd></div></dl>
      <span className="tag">{status}</span>
    </div>
    {error && <div className="tools-feedback" aria-live="polite"><p className="tools-error" role="alert">{error}</p></div>}
    {!error && !job?.running && job?.message.includes("已取消") && <p className="field-help" role="status">{job.kind === "engine-open-installer" ? job.message : "操作已取消。"}</p>}
    {!error && installerOpened && !current && <p className="field-help" role="status">{job.message}</p>}
    {!error && job?.kind === "clearDownloads" && !job.running && <p className="field-help" role="status">{job.message}</p>}
    {engine.pendingOperation && !job?.running && <BuiltinRecovery label={label} operationId={engine.pendingOperation} disabled={uninstallBusy || busy} reconcile={force => void action("rea.reconcile", { engine: engine.id, operationId: engine.pendingOperation, force })} />}
    {engine.id === "ghidra" && <p className="field-help">{ghidraJavaRequirement}</p>}
    <div className="tools-actions">
      <button className="btn" disabled={unavailable} onClick={() => void action("rea.engine-check", { engine: engine.id })}><Icon name="refresh-cw" />{downloadable ? `检查${label}更新` : `检测${label}`}</button>
      {cachedInstall && !current && <button className="btn" disabled={unavailable} onClick={() => setConfirm({ revision, version: engine.download!.version, downloadPath: engine.download!.path, recommendedVersion: recommended, operation: engine.id === "hopper" ? "open" : "install" })}><Icon name="package" />安装{label}</button>}
      {downloadable && !current && !cachedInstall && !(manual && downloaded) && <button className="btn" disabled={unavailable || !engine.available} onClick={() => selectRelease(manual ? "download" : "install")}><Icon name="download" />{manual ? `下载${label}安装包` : `${installLabel(engine)}${label}`}</button>}
      {engine.id === "ghidra" && engine.installable && !current && !downloaded && <button className="btn btn-ghost" disabled={unavailable || !engine.available} onClick={() => selectRelease("download")}><Icon name="download" />下载{label}安装包</button>}
      {engine.download && <button className="btn" onClick={() => { setOpenError(""); void revealLocalPath({ path: engine.download!.path }).catch(error => setOpenError(error.message)); }}><Icon name="folder-open" />查看安装包</button>}
      {downloadId && (engine.download || !!downloadCleanup?.paths.length || downloadCleanupError) && <button className="btn" disabled={uninstallBusy || busy || !downloadCleanup?.paths.length || !!downloadCleanupError} onClick={() => downloadCleanup && setClearDownload({ revision: state.revision, scope: downloadCleanup })}><Icon name="trash-2" />清理安装包</button>}
      {engine.id !== "hopper" && (engine.managed || engine.removalPending) && <button className="btn" disabled={uninstallBusy} onClick={() => setUninstall(revision)}><Icon name="trash-2" />{engine.removalPending ? "清理残留文件" : "卸载托管组件"}</button>}
      {externalHopper && <button className="btn" onClick={() => setExternalUninstall(value => !value)} aria-expanded={externalUninstall}><Icon name="trash-2" />卸载说明</button>}
      {manual && downloaded && <a className="btn btn-ghost" href={engine.id === "ghidra" ? "https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/GhidraDocs/GettingStarted.md#building-native-components" : "https://www.hopperapp.com/download.html"} target="_blank" rel="noreferrer">安装说明</a>}
    </div>
    {downloadId && (downloadCleanupError || engine.download && !downloadCleanup) && <p className="field-help">安装包暂不能自动清理：{downloadCleanupError || "后台尚未提供可核实的清理范围，请刷新或更新后台。"}</p>}
    {externalUninstall && externalHopper && <div className="tools-conflict inline-confirmation" role="group" aria-label="Hopper卸载说明">
      <p>Hopper 是系统管理的外部应用，Axiom 不会直接删除它。</p>
      <p>请先结束相关分析任务并退出 Hopper，{hopperApplication ? "在运行后台的 Mac 上，将下方应用移到废纸篓；" : "在运行后台的电脑上，使用原安装方式卸载；"}然后点击“检查Hopper更新”核实。许可与个人数据需按官方说明另行处理。</p>
      <p className="tools-path">{hopperApplication ? "应用位置" : "启动程序"} <LocalPath path={hopperApplication ?? engine.path} openLabel={hopperApplication ? "在后台 Mac 打开应用所在文件夹" : "在后台电脑定位程序"} onOpen={hopperApplication ? () => revealLocalPath({ path: hopperApplication.slice(0, hopperApplication.lastIndexOf("/")) || "/" }) : undefined} /></p>
      <p>“清理安装包”只删除 Axiom 登记的下载包，不会卸载 Hopper，也不会删除已交给系统安装器的副本。</p>
      <div className="tools-actions"><button className="btn" onClick={() => setExternalUninstall(false)}>收起说明</button></div>
    </div>}
    {clearDownload && <div className="tools-conflict inline-confirmation" role="group" aria-label={`确认清理${label}安装包`}>
      <p>清理 {label} 的已登记安装包？再次安装时需要重新下载。保留已安装程序、设置、未登记文件及已交给系统安装器的副本。</p>
      {clearDownload.scope.paths.map(path => <p className="tools-path" key={path}><LocalPath path={path} /></p>)}
      {staleDownloadCleanup && <p role="alert">安装包清理范围已变化，请重新确认。</p>}
      <div className="tools-actions"><button className="btn" onClick={() => setClearDownload(undefined)}>暂不清理</button><button className="btn confirm-danger" disabled={uninstallBusy || busy || staleDownloadCleanup} onClick={() => {
        const selection = clearDownload; setClearDownload(undefined);
        void action("rea.clearDownloads", { engine: engine.id, revision: selection.revision, cleanupRevision: selection.scope.revision, confirm: true });
      }}><Icon name="trash-2" />确认清理安装包</button></div>
    </div>}
    {!error && ["error", "incompatible"].includes(engine.status) && <details className="tools-diagnostic"><summary>检测详情</summary><pre>{engine.detail}</pre></details>}
    {uninstall !== undefined && <div className="tools-conflict inline-confirmation" role="group" aria-label={`确认卸载${label}`}>
      <p>卸载 Axiom 安装的 {label}？</p>
      {uninstall !== revision && <p role="alert">此组件已变化，请重新确认。</p>}
      <div className="tools-actions"><button className="btn" onClick={() => setUninstall(undefined)}>暂不卸载</button><button className="btn confirm-danger" disabled={uninstallBusy || uninstall !== revision} onClick={() => { const revision = uninstall; setUninstall(undefined); void action("rea.engine-uninstall", { engine: engine.id, revision, confirm: true }); }}><Icon name="trash-2" />确认卸载</button></div>
    </div>}
    {confirm && <div className="tools-conflict inline-confirmation" role="group" aria-label={`确认${confirm.operation === "download" ? "下载" : "安装"}${label}`}>
      <p>{confirm.operation === "download" ? "下载" : "安装"} {label} {confirm.version}？{confirm.operation === "open" ? "将在后台 Mac 打开安装映像，请在系统窗口完成安装。" : confirm.downloadPath ? "将使用已下载的安装包。" : confirm.operation === "download" ? "下载后可继续安装。" : ""}</p>
      {engine.id === "ghidra" && <p>{ghidraJavaRequirement}</p>}
      {confirm.operation === "install" && engine.id === "ghidra" && state.engineHost?.platform === "darwin" && <p>macOS 还需要 Xcode 命令行工具；会自动准备 Gradle 并构建本机组件。</p>}
      {stale && <p role="alert">此组件或安装版本已变化，请重新确认。</p>}
      <div className="tools-actions"><button className="btn" onClick={() => setConfirm(undefined)}>暂不{confirm.operation === "download" ? "下载" : "安装"}</button><button className="btn btn-primary" disabled={busy || stale} onClick={() => {
        const selection = confirm; setConfirm(undefined);
        void action(selection.operation === "open" ? "rea.engine-open-installer" : selection.operation === "download" ? "rea.engine-download" : "rea.engine-install", { engine: engine.id, revision: selection.revision, token: selection.release?.token, version: selection.version, ...(selection.downloadPath ? { downloaded: true, confirm: true } : {}) });
      }}>{confirm.operation === "download" ? "确认下载" : confirm.operation === "open" ? "打开安装程序" : confirm.downloadPath ? "确认安装" : "确认下载安装"}</button></div>
    </div>}
  </BackendMaintenance>;
}
