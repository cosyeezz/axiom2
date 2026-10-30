import { Icon } from "../Icon.js";
import { LocalPath, revealLocalPath } from "../LocalPath.js";
import { BackendMaintenance } from "../maintenance/BackendMaintenance.js";
import { ComponentAction, ComponentActions } from "../maintenance/ComponentCard.js";
import { componentInstallAction } from "../../shared/component-actions.js";
import { useState } from "react";
import { useConnectionState } from "../transport.js";
import { compareEngineVersions, engineDownloadSatisfied, engineRecommendationSatisfied, supportedReaEngineContract, reaEngineLabels, reaEngineStatusLabels, type ReaEngineReleaseState, type ReaEngineState } from "../../shared/rea-engines.js";
import type { ReaState } from "../../shared/rea.js";
import type { CleanupScope } from "../../shared/cleanup-scope.js";

export type ReaFeedback = { text: string; error?: boolean; jobId?: string };
type Action = (op: string, params?: Record<string, unknown>) => Promise<void>;
const ghidraJavaRequirement = "Ghidra 需要依赖 JDK 21，请先在上方「JDK 21」组件中下载并安装；安装 Ghidra 不会自动安装 JDK。";
export function ReaEngines({ state, busy, blocked, sending, feedback, action, reportedErrorResources }: { state: ReaState; busy: boolean; blocked: boolean; sending: string[]; feedback: Record<string, ReaFeedback>; action: Action; reportedErrorResources: string[] }) {
  return <>{state.engines?.map(engine => <Engine key={engine.id} engine={engine} state={state} uninstallBusy={busy} blocked={blocked} sending={sending.includes(`rea:${engine.id}`)} feedback={feedback[`rea:${engine.id}`]} action={action} reportedError={reportedErrorResources.includes(`rea:${engine.id}`)} />)}</>;
}
function Engine({ engine, state, uninstallBusy, blocked, sending, feedback, action, reportedError }: { engine: ReaEngineState; state: ReaState; uninstallBusy: boolean; blocked: boolean; sending: boolean; feedback?: ReaFeedback; action: Action; reportedError: boolean }) {
  const job = (state.jobs ?? (state.job ? [state.job] : [])).find(job => job.engine === engine.id);
  const busy = blocked || sending || !!job?.running;
  const connected = useConnectionState().connected;
  // Component standard: install/update/uninstall stay available; only an in-flight request or a lost connection blocks them.
  const locked = sending || !connected;
  const revision = engine.revision ?? state.revision;
  const [openError, setOpenError] = useState("");
  const error = openError || (feedback?.error ? feedback.text : !feedback ? job?.error : undefined);
  const [uninstall, setUninstall] = useState(false);
  const [externalUninstall, setExternalUninstall] = useState(false);
  const [clearDownload, setClearDownload] = useState<{ revision: string; scope: CleanupScope }>();
  const [confirm, setConfirm] = useState<{ revision: string; version: string; operation: "install" | "download" | "open"; release?: ReaEngineReleaseState; downloadPath?: string; recommendedVersion?: string }>();
  const unsupported = engine.status === "unsupported", label = reaEngineLabels[engine.id];
  const manual = !engine.installable && (engine.id === "ghidra" || engine.id === "hopper" && state.engineHost?.platform === "darwin");
  const downloadable = engine.installable || manual;
  const hostReason = !state.version ? state.packageRoot ? "REA 版本尚无法确认，暂不能匹配配套组件契约。" : "请先安装 REA，再维护配套组件。" : !supportedReaEngineContract(state.version) ? "当前 REA 版本的组件契约尚未适配。" : state.supportError;
  const installAction = componentInstallAction({ label, installation: ["error", "incompatible"].includes(engine.status) && !!engine.path ? "incomplete" : engine.path || engine.version ? "installed" : engine.status === "missing" ? "missing" : "unknown", version: engine.version, target: engine.available?.version ?? engine.recommendedVersion, targetLabel: engine.id === "hopper" ? "最新" : "推荐", compare: compareEngineVersions, repairByReinstall: true });
  const current = engineRecommendationSatisfied(engine), downloaded = engineDownloadSatisfied(engine);
  const recommended = engine.available?.version ?? engine.recommendedVersion;
  const cachedInstall = !!engine.download && downloaded && engine.id === "ghidra" && engine.installable;
  const canOpenInstaller = !!engine.download && engine.id === "hopper" && state.engineHost?.platform === "darwin";
  // Cached-package actions keep their confirmation bound to that exact package.
  const stalePackage = !!confirm?.downloadPath && (confirm.revision !== revision || confirm.downloadPath !== engine.download?.path || confirm.version !== engine.download?.version || confirm.recommendedVersion !== recommended);
  const selectionLocked = (selection: { operation: string; downloadPath?: string }) => selection.operation === "open" || selection.downloadPath ? busy || !connected || stalePackage : locked;
  const installerOpened = job?.kind === "engine-open-installer" && !job.running && !job.error && job.message.startsWith("已打开");
  const status = current ? engine.id === "hopper" ? "已安装 · 待许可验证" : undefined : installerOpened ? "待完成系统安装" : downloaded ? "已下载 · 待安装" : engine.status === "unchecked" ? undefined : reaEngineStatusLabels[engine.status];
  const selectRelease = (operation: "install" | "download") => setConfirm({ revision, version: engine.available?.version ?? recommended ?? "最新版", release: engine.available, operation });
  const downloadId = engine.id === "ghidra" || engine.id === "hopper" ? engine.id : undefined;
  const downloadCleanup = downloadId ? state.downloadCleanup?.[downloadId] : undefined;
  const downloadCleanupError = downloadId ? state.downloadCleanupErrors?.[downloadId] : undefined;
  const staleDownloadCleanup = !!clearDownload && (clearDownload.revision !== state.revision || clearDownload.scope.revision !== downloadCleanup?.revision || !!downloadCleanupError);
  const externalHopper = engine.id === "hopper" && !!engine.path && !["missing", "unsupported"].includes(engine.status);
  const hopperApplication = state.engineHost?.platform === "darwin" ? /^(\/.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(engine.path)?.[1] : undefined;
  return <BackendMaintenance kind="dependency" className="rea-engine" resource={`rea:${engine.id}`} label={label} version={engine.version ?? (engine.status === "missing" ? "未安装" : engine.path ? "已安装" : undefined)} status={current && engine.id !== "hopper" || ["ready", "missing"].includes(engine.status) && !downloaded && !installerOpened ? undefined : status} showError={!error && !reportedError}
    description={{ java: "Java 开发环境", ghidra: "原生程序反编译", hopper: "原生程序反编译", jadx: "Android APK 反编译", wabt: "WebAssembly 文件分析" }[engine.id]}
    availableVersion={recommended} availableVersionLabel={engine.id === "hopper" ? "最新" : "推荐"}
    location={engine.path && <LocalPath path={engine.path} />}
    actions={<>
      <ComponentActions context={{ connected, sending, taskRunning: busy }} capabilities={[
        { id: "check-versions", label: downloadable ? `检查${label}更新` : `检测${label}`, support: unsupported ? "unsupported" : "supported", blockedReason: hostReason, conflictsWithTask: true, execute: () => void action("rea.engine-check", { engine: engine.id }) },
        { ...installAction, support: engine.installable ? "supported" : "unsupported", blockedReason: hostReason, execute: () => selectRelease("install") },
        { id: "download-package", label: `下载${label}安装包`, support: downloadId && downloadable ? "supported" : "unsupported", applicable: !downloaded, primary: manual, blockedReason: hostReason, conflictsWithTask: true, execute: () => selectRelease("download") },
        { id: "install-cached", label: `使用缓存安装 ${label}`, applicable: cachedInstall, blockedReason: hostReason, conflictsWithTask: true, execute: () => setConfirm({ revision, version: engine.download!.version, downloadPath: engine.download!.path, recommendedVersion: recommended, operation: "install" }) },
        { id: "open-installer", label: `打开${label}系统安装器`, applicable: canOpenInstaller, blockedReason: hostReason, conflictsWithTask: true, execute: () => setConfirm({ revision, version: engine.download!.version, downloadPath: engine.download!.path, recommendedVersion: recommended, operation: "open" }) },
        { id: "cleanup-package", label: "清理安装包", applicable: !!downloadId && (!!engine.download || !!downloadCleanup?.paths.length || !!downloadCleanupError), blockedReason: downloadCleanupError || (!downloadCleanup?.paths.length ? "尚无可核实的登记包清理范围，请刷新后重试。" : uninstallBusy ? "REA 正在维护，完成或取消后可清理登记包。" : undefined), conflictsWithTask: true, execute: () => { if (downloadCleanup) setClearDownload({ revision: state.revision, scope: downloadCleanup }); } },
        { id: "uninstall", label: "卸载托管组件", support: engine.id === "hopper" ? "unsupported" : "supported", danger: true, execute: () => setUninstall(true) },
      ]} />
      {engine.download && <ComponentAction icon="folder-open" label="查看安装包" onClick={() => { setOpenError(""); void revealLocalPath({ path: engine.download!.path }).catch(error => setOpenError(error.message)); }} />}
      {externalHopper && <ComponentAction icon="trash-2" label="卸载说明" onClick={() => setExternalUninstall(value => !value)} aria-expanded={externalUninstall} />}
      {manual && downloaded && <a className="maintenance-icon-button component-action" aria-label="安装说明" data-tooltip="安装说明" href={engine.id === "ghidra" ? "https://github.com/NationalSecurityAgency/ghidra/blob/Ghidra_12.1.4_build/GhidraDocs/GettingStarted.md#building-native-components" : "https://www.hopperapp.com/download.html"} target="_blank" rel="noreferrer"><Icon name="file-text" /><span className="component-action-label">安装说明</span></a>}
    </>}>
    {error && <div className="tools-feedback" aria-live="polite"><p className="tools-error" role="alert">{error}</p></div>}
    {!error && !job?.running && job?.message.includes("已取消") && <p className="field-help" role="status">{job.kind === "engine-open-installer" ? job.message : "操作已取消。"}</p>}
    {!error && installerOpened && !current && <p className="field-help" role="status">{job.message}</p>}
    {!error && job?.kind === "clearDownloads" && !job.running && <p className="field-help" role="status">{job.message}</p>}
    {engine.id === "ghidra" && <p className="field-help">{ghidraJavaRequirement}</p>}
    {hostReason && <p className="field-help">{hostReason}</p>}
    {engine.download && <p className="field-help">安装包已登记；使用缓存或打开系统安装器前会重新校验，登记与版本匹配不代表已经安装。</p>}
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
    {uninstall && <div className="tools-conflict inline-confirmation" role="group" aria-label={`确认卸载${label}`}>
      <p>强制卸载 Axiom 托管的 {label} 及其旧版本、清除对应安装路径登记；外部程序文件保留。进行中的组件维护会被中止，使用该组件的分析可能失败。</p>
      <div className="tools-actions"><button className="btn" onClick={() => setUninstall(false)}>暂不卸载</button><button className="btn confirm-danger" disabled={locked} onClick={() => { setUninstall(false); void action("rea.engine-uninstall", { engine: engine.id }); }}><Icon name="trash-2" />确认卸载</button></div>
    </div>}
    {confirm && <div className="tools-conflict inline-confirmation" role="group" aria-label={confirm.operation === "open" ? `确认打开${label}安装器` : `确认${confirm.operation === "download" ? "下载" : "安装"}${label}`}>
      <p>{confirm.operation === "download" ? `下载 ${label} 安装包` : confirm.operation === "open" ? `打开 ${label} 系统安装器` : confirm.downloadPath ? `使用缓存安装 ${label}` : installAction.label} {confirm.version}？{confirm.operation === "open" ? "将在后台 Mac 校验并打开安装映像，请在系统窗口完成安装；打开不代表安装完成。" : confirm.downloadPath ? "将重新校验已登记包，不能通过校验时不会使用。安装失败仍会按组件安装流程清理托管安装并重试一次，不能保证保留原安装。" : confirm.operation === "download" ? "只下载安装包，不改变当前安装。" : "执行时重新解析目标，可能降级；失败会强制清理该托管组件后重试一次，不能保证保留原安装。"}</p>
      {engine.id === "ghidra" && <p>{ghidraJavaRequirement}</p>}
      {confirm.operation === "install" && engine.id === "ghidra" && state.engineHost?.platform === "darwin" && <p>macOS 还需要 Xcode 命令行工具；会自动准备 Gradle 并构建本机组件。</p>}
      {stalePackage && <p role="alert">安装包或目标版本已变化，请重新确认。</p>}
      <div className="tools-actions"><button className="btn" onClick={() => setConfirm(undefined)}>暂不{confirm.operation === "download" ? "下载" : confirm.operation === "open" ? "打开" : "安装"}</button><button className="btn btn-primary" disabled={selectionLocked(confirm)} onClick={() => {
        const selection = confirm; setConfirm(undefined);
        void action(selection.operation === "open" ? "rea.engine-open-installer" : selection.operation === "download" ? "rea.engine-download" : "rea.engine-install", { engine: engine.id, revision: selection.revision, token: selection.release?.token, version: selection.version, ...(selection.downloadPath ? { downloaded: true, confirm: true } : { reinstall: ["reinstall", "repair"].includes(installAction.id) }) });
      }}>{confirm.operation === "download" ? "确认下载" : confirm.operation === "open" ? "打开安装程序" : confirm.downloadPath ? "确认安装" : "确认下载安装"}</button></div>
    </div>}
  </BackendMaintenance>;
}
