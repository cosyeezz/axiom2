import type { MaintenanceState } from '../../shared/maintenance.js';
import type { ResourceState } from '../../shared/resources.js';
import type { ReaState } from '../../shared/rea.js';
import type { RtkState } from '../../shared/rtk.js';
import type { OpenCliState } from '../../shared/builtin-tools.js';
import type { ModelProxyState, ProxyKernel } from '../../shared/model-proxy.js';
import { reaEngineLabels } from '../../shared/rea-engines.js';
export type CleanupStates = { resources: ResourceState; rea: ReaState; rtk: RtkState; opencli: OpenCliState; modelProxy: ModelProxyState };
export type CleanupFamily = keyof CleanupStates;
export const cleanupFamilies: CleanupFamily[] = ['resources', 'rea', 'rtk', 'opencli', 'modelProxy'];
export type CleanupRow = { id: string; family: CleanupFamily; label: string; op: string; revision: string; params: Record<string, string>; available: boolean; scope: string[]; retained: string[]; warning?: string; credentials?: boolean; readOnly?: boolean };
export function cleanupRows(states: Partial<CleanupStates>): CleanupRow[] {
  const rows: CleanupRow[] = [];
  const base = (family: CleanupFamily, label: string, available: boolean, scope: string[], retained: string[]): CleanupRow => ({ id: family, family, label, op: `${family}.uninstall`, revision: states[family]?.revision || '', params: {}, available, scope, retained });
  const r = states.resources;
  if (r) for (const item of r.items) rows.push({ ...base('resources', `${item.name} · ${r.scopes.find(scope => scope.id === item.scopeId)?.name || item.scopeId}`, item.removable && !item.builtin, item.cleanup, ['其他作用范围引用的内容、共享缓存和外部源按归属保留；已有会话需重载或新建。']), id: `resource:${item.id}`, op: 'resources.remove', params: { id: item.id }, warning: [item.note, ...r.warnings, item.builtin ? '由所属工具统一管理。' : ''].filter(Boolean).join(' '), credentials: item.kind === 'mcp' });
  const rea = states.rea;
  if (rea) {
    rows.push({ ...base('rea', 'REA 主程序', !!(rea.version || rea.packageRoot || rea.removalPending), ['已登记的 REA 托管程序及旧版本，停用所属技能与 MCP 接入。'], ['REA 设置、外部程序、各引擎及手动下载包需分别核实。']), warning: rea.error || rea.pendingOperation });
    for (const engine of rea.engines || []) rows.push({ ...base('rea', `REA · ${reaEngineLabels[engine.id]}`, engine.id !== 'hopper' && !!(engine.managed || engine.removalPending), ['此引擎已登记的托管版本及旧版本；使用它的分析任务必须先退出。'], ['外部路径与手动下载文件保留。']), id: `engine:${engine.id}`, op: 'rea.engine-uninstall', revision: engine.revision ?? rea.revision, params: { engine: engine.id }, warning: [engine.path, engine.download?.path, engine.pendingOperation, ...(engine.cleanupUnverified ?? []).map(path => `未登记残留（不可自动删除）：${path}`), engine.id === 'hopper' ? 'Hopper 由系统安装器管理。' : ''].filter(Boolean).join(' · ') });
    for (const engine of ['ghidra', 'hopper'] as const) if (rea.downloadCleanup?.[engine]?.paths.length || rea.downloadCleanupErrors?.[engine]) rows.push({ ...base('rea', `REA · ${reaEngineLabels[engine]} 登记下载包`, !!rea.downloadCleanup?.[engine]?.paths.length, ['删除此组件已登记的安装包与来源记录。'], ['REA 程序、已安装引擎、其他下载目录及交给系统安装器的副本保留。']), id: `download:${engine}`, op: 'rea.clearDownloads', params: { engine }, warning: rea.downloadCleanupErrors?.[engine] || '清理后再次安装需要重新下载。' });
    for (const kind of ['Skill', 'Mcp'] as const) rows.push({ ...base('rea', `REA ${kind === 'Skill' ? '技能' : 'MCP'}接入`, kind === 'Skill' ? rea.skillInstalled : rea.mcpInstalled, ['关闭此组件接入。'], ['组件代码随 REA 主程序保留；需要删除代码时卸载 REA 主程序。']), id: `rea:${kind}`, op: `rea.uninstall${kind}` });
  }
  const rtk = states.rtk;
  if (rtk) rows.push({ ...base('rtk', 'RTK', !!(rtk.version || rtk.executable || rtk.removalPending || rtk.cleanupPaths?.length), !rtk.cleanup && rtk.cleanupPaths?.length ? rtk.cleanupPaths.map(path => `托管版本目录：${path}`) : ['RTK 托管程序与旧版本。'], ['过滤设置、效果记录与原始输出保留。']), warning: rtk.offline ? rtk.offlineUninstall?.reason || '缺少历史工作进程退出证明，RTK 离线仅可查看范围，不允许删除。' : rtk.error });
  if (rtk?.dataCleanup) for (const kind of ['stats', 'originals'] as const) {
    const data = rtk.dataCleanup[kind];
    if (!data) continue;
    rows.push({ ...base('rtk', kind === 'stats' ? 'RTK 效果记录' : 'RTK 保留原文', data.count > 0, [kind === 'stats' ? `清空 ${data.count} 条效果记录；不会缩小或物理擦除数据库文件。` : `删除 ${data.count} 份原文；聊天中的旧回查路径将失效。`], ['RTK 程序、过滤设置和另一类数据保留。', ...data.retained.map(path => `未识别或存在链接的文件保留：${path}`)]), id: `rtk:${kind}`, op: kind === 'stats' ? 'rtk.cleanupStats' : 'rtk.cleanupOriginals', warning: '数据删除不可撤销。清理完成后，新任务仍会产生新数据。' });
  }
  const opencli = states.opencli;
  if (opencli) rows.push({ ...base('opencli', 'OpenCLI', !!(opencli.configured || opencli.removalPending), ['移除托管程序与旧版本，解除 Axiom 的程序配置引用。'], ['公共 npm 缓存、外部安装、浏览器扩展、浏览器档案与设置保留。']), warning: opencli.error || opencli.installationError || opencli.pendingOperation });
  const proxy = states.modelProxy;
  if (proxy) {
    for (const kernel of ['xray', 'mihomo'] as const) rows.push({ ...base('modelProxy', `模型代理 · ${kernel}`, !!(proxy.installations[kernel] || proxy.removalPending?.[kernel]), ['停止使用此内核的线路，删除本次确认的托管版本目录。'], ['订阅、线路配置及供应商绑定保留；历史运行目录需另行核实。']), id: `proxy:${kernel}`, params: { kernel }, warning: proxy.cleanupError || proxy.error });
    rows.push({ ...base('modelProxy', 'Xray 分享导入组件', !!(proxy.importer?.filesPresent || proxy.importer?.removalPending), ['已登记的 xray-knife 导入程序及对应下载包。'], ['现有线路与其他内核保留。']), id: 'proxy:importer', op: 'modelProxy.importerUninstall', warning: proxy.importer?.error || proxy.error });
  }
  return rows.map(row => {
    // Old hosts have no capability field: offline never implies deletion permission.
    if (row.family === 'rtk' && rtk?.offline) return { ...row, available: false, readOnly: true, scope: [...row.scope, ...(rtk.cleanup?.paths ?? rtk.cleanupPaths ?? []).map(path => `只读路径：${path}`)] };
    const scope = row.family === 'rtk' ? row.op === 'rtk.cleanupStats' ? rtk?.dataCleanup?.stats : row.op === 'rtk.cleanupOriginals' ? rtk?.dataCleanup?.originals : rtk?.cleanup
      : row.family === 'opencli' ? opencli?.cleanup
      : row.family === 'rea' ? row.op === 'rea.uninstall' ? rea?.cleanup : row.op === 'rea.engine-uninstall' ? rea?.engines?.find(engine => engine.id === row.params.engine)?.cleanup : row.op === 'rea.clearDownloads' ? rea?.downloadCleanup?.[row.params.engine as 'ghidra' | 'hopper'] : undefined
      : row.family === 'modelProxy' ? row.op === 'modelProxy.importerUninstall' ? proxy?.importer?.cleanup : proxy?.cleanup?.[row.params.kernel as ProxyKernel]
      : undefined;
    if (!scope) {
      const scoped = ['rtk.uninstall', 'opencli.uninstall', 'rea.uninstall', 'rea.engine-uninstall', 'rea.clearDownloads', 'modelProxy.uninstall', 'modelProxy.importerUninstall'].includes(row.op);
      if (scoped) return { ...row, available: false, warning: [row.warning, '未能核实具体卸载路径，请更新后台或解除路径错误后重新读取。'].filter(Boolean).join(' ') };
      return row;
    }
    return { ...row, available: row.available || (!row.op.startsWith('rtk.cleanup') && scope.paths.length > 0), params: { ...row.params, cleanupRevision: scope.revision }, scope: [...row.scope, ...(scope.paths.length ? scope.paths.map(path => `${row.op.startsWith('rtk.cleanup') ? '数据路径' : row.op === 'rea.clearDownloads' ? '登记下载目录' : '托管版本目录'}：${path}`) : ['未发现待删除的程序目录；将核实并解除相关配置引用。'])] };
  });
}
type Job = { id: string; running: boolean; error?: string; message: string; kind?: string; engine?: string };
export type CleanupProgress = { state: 'running' | 'failed' | 'unknown' | 'verified'; message: string };
export function acceptedCleanupJob(row: CleanupRow, state: CleanupStates[CleanupFamily], requestId: string): string | undefined {
  if (row.family === 'resources') return (state as ResourceState).acceptedJobId;
  if (row.op === 'rea.uninstallSkill' || row.op === 'rea.uninstallMcp') return undefined;
  if (row.family === 'rea') return (state as ReaState).jobs?.find(job => job.kind === row.op.slice(4) && job.engine === row.params.engine)?.id;
  if (row.family === 'modelProxy') return requestId;
  return (state as RtkState | OpenCliState).job?.id;
}
export function cleanupProgress(row: CleanupRow, state: CleanupStates[CleanupFamily], jobId?: string, history?: MaintenanceState): CleanupProgress {
  let removed = false, pending = false, error: string | undefined, job: Job | undefined;
  const synchronous = ['rea.uninstallSkill', 'rea.uninstallMcp'].includes(row.op);
  if (row.family === 'resources') {
    const value = state as ResourceState; job = value.jobs?.find(item => item.id === jobId);
    removed = !value.items.some(item => item.id === row.params.id); pending = value.items.some(item => item.id === row.params.id && item.removalPending);
    error = value.warnings.join(' ');
  } else if (row.family === 'rea') {
    const value = state as ReaState; job = value.jobs?.find(item => item.id === jobId); error = value.error;
    if (row.op === 'rea.clearDownloads') {
      const engine = row.params.engine as 'ghidra' | 'hopper';
      error = value.downloadCleanupErrors?.[engine]; removed = !!value.downloadCleanup?.[engine] && value.downloadCleanup[engine]!.paths.length === 0;
    } else if (row.op === 'rea.engine-uninstall') { const engine = value.engines?.find(item => item.id === row.params.engine); removed = !!engine && !engine.managed && !engine.cleanup?.paths.length && !engine.cleanupUnverified?.length; pending = !!engine?.removalPending; }
    else if (row.op === 'rea.uninstallSkill') { removed = !value.skillInstalled; error ||= value.skillError; }
    else if (row.op === 'rea.uninstallMcp') { removed = !value.mcpInstalled; error ||= value.mcpError; }
    else { removed = !value.version && !value.packageRoot && !value.cleanup?.paths.length; pending = !!value.removalPending; }
  } else if (row.family === 'rtk') {
    const value = state as RtkState; job = value.job?.id === jobId ? value.job : undefined;
    if (row.op === 'rtk.cleanupStats' || row.op === 'rtk.cleanupOriginals') {
      const data = value.dataCleanup?.[row.op === 'rtk.cleanupStats' ? 'stats' : 'originals'];
      error = value.dataCleanupError || value.dataCleanupErrors?.[row.op === 'rtk.cleanupStats' ? 'stats' : 'originals']; removed = !!data && data.count === 0;
    } else { error = value.error; pending = !!value.removalPending; removed = !value.version && !value.executable && !value.cleanupPaths?.length; }
  } else if (row.family === 'opencli') {
    const value = state as OpenCliState; job = value.job?.id === jobId ? value.job : undefined; error = value.error || value.installationError; pending = !!value.removalPending; removed = !value.configured && !value.cleanup?.paths.length;
  } else {
    const value = state as ModelProxyState; error = value.error;
    if (row.op === 'modelProxy.importerUninstall') {
      const task = history?.tasks.find(item => item.id === jobId && item.endpoint === 'backend' && item.resource === 'proxy:xray-knife' && item.action === 'uninstall');
      if (!task || history?.error || ['unknown', 'interrupted'].includes(task.status)) return { state: 'unknown', message: history?.error || '未找到本次导入组件卸载的可靠终态，请核实维护历史。' };
      if (task.status === 'running' || task.status === 'cancelling') return { state: 'running', message: task.message || '正在清理导入组件…' };
      if (task.status !== 'succeeded' || task.error) return { state: 'failed', message: task.error?.message || task.message || '导入组件卸载未成功。' };
      job = { id: task.id, running: false, message: task.message || '' };
      error ||= value.importer?.error; removed = !!value.importer && !value.importer.filesPresent && !value.importer.cleanup?.paths.length; pending = !!value.importer?.removalPending || !!value.importer?.busy;
    } else { error ||= value.cleanupError; job = value.job?.id === jobId ? value.job : undefined; const kernel = row.params.kernel as ProxyKernel; removed = !value.installations[kernel] && !value.cleanup?.[kernel]?.paths.length; pending = !!value.removalPending?.[kernel]; }
  }
  if (job?.running) return { state: 'running', message: job.message };
  if (job?.error || error) return { state: 'failed', message: job?.error || error! };
  if (!synchronous && !job) return { state: 'unknown', message: '未找到此次受理的任务记录，无法确认完成；请核实维护历史。' };
  if (pending || !removed) return { state: 'failed', message: '仍发现程序、配置引用或待清理文件；本项清理尚未完成。' };
  return { state: 'verified', message: '已复读当前状态并核实选定范围；保留项与外部来源仍需分别检查。' };
}
