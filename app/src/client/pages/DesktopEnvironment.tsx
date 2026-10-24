import { useRef, useState } from "react";
import { isEnvironmentInventory, type EnvironmentInventory, type EnvironmentLocation } from "../../shared/environment-inventory.js";
import DesktopArchiveCleanup from './DesktopArchiveCleanup.js';
import DesktopServiceRemoval from './DesktopServiceRemoval.js';
import DesktopPiRemoval from './DesktopPiRemoval.js';
import DesktopToolCleanup from './DesktopToolCleanup.js';
import { Icon } from "../Icon.js";
import { desktopInvoke } from "./desktop-bridge.js";
import "../styles/environment-inventory.css";

function size(value: EnvironmentLocation) {
  if (value.state === "missing") return "未发现";
  if (value.state === "unknown") return "未核实";
  if (value.state === "link") return "链接 · 未扫描目标";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value.bytes, unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit++; }
  return `${value.complete ? "" : "已读取 "}${amount.toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]} · ${value.files} 个文件${value.links ? ` · ${value.links} 个链接未展开` : ""}`;
}

export default function DesktopEnvironment() {
  const [inventory, setInventory] = useState<EnvironmentInventory | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scannedAt, setScannedAt] = useState<number>();
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedInventory, setSelectedInventory] = useState<EnvironmentInventory | null>(null);
  const [selectedError, setSelectedError] = useState("");
  const inFlight = useRef<Promise<boolean> | null>(null);
  async function scan(afterCurrent = false, root?: string): Promise<boolean> {
    if (inFlight.current) {
      if (!afterCurrent) return false;
      await inFlight.current;
      return scan(true, root);
    }
    const reportError = root === undefined ? setError : setSelectedError;
    setBusy(true); reportError("");
    const work = (async () => {
      try {
        const result = await desktopInvoke<EnvironmentInventory>("axiom_environment", root === undefined ? undefined : { root }, 12_000);
        if (!isEnvironmentInventory(result)) throw Error("扫描结果不完整，请重新扫描。");
        if (root !== undefined) {
          if (result.scope !== "selected" || result.origin !== "unknown" || result.automaticRemovalAllowed !== false || result.root !== root) throw Error("指定目录扫描范围不一致，请更新客户端后重新扫描。");
          setSelectedInventory(result);
        } else {
          if (result.scope === "selected") throw Error("当前安装扫描返回了其他目录，请重新扫描。");
          setInventory(result); setScannedAt(Date.now());
        }
        return true;
      } catch (cause) { reportError(cause instanceof Error ? cause.message : String(cause)); return false; }
      finally { setBusy(false); }
    })();
    inFlight.current = work;
    try { return await work; } finally { if (inFlight.current === work) inFlight.current = null; }
  }
  const detected = inventory?.items.filter(item => item.state === "detected").length ?? 0;
  const unknown = inventory?.items.filter(item => item.state === "unknown" || item.locations.some(location => !location.complete || location.links > 0)).length ?? 0;
  return <section className="environment-inventory" aria-label="安装环境扫描" aria-busy={busy}>
    <DesktopPiRemoval onRescan={() => scan(true)} />
    <DesktopToolCleanup onRescan={() => scan(true)} />
    <DesktopServiceRemoval onRescan={() => scan(true)} />
    <DesktopArchiveCleanup onRescan={() => scan(true)} />
    <div className="connect-updates-heading"><h2>安装环境扫描</h2><button className="connect-secondary" disabled={busy} onClick={() => void scan()}><Icon name="search" className={busy ? "startup-spin" : undefined} />{busy ? "正在扫描…" : inventory ? "重新扫描" : "扫描安装与残留"}</button></div>
    <p className="connect-update-detail">安装或卸载前，查看这台电脑上的已知安装目录、缓存位置和命令来源。扫描不依赖后台服务，也不会删除文件。</p>
    {error && <p className="connect-error" role="alert">{error}{inventory ? " 下方保留上次结果，不能作为本次检查结论。" : ""}</p>}
    {inventory && <>
      <p className="connect-update-detail" role="status">{scannedAt ? `扫描于 ${new Date(scannedAt).toLocaleTimeString()}；` : ""}发现 {detected} 类文件{unknown ? `，${unknown} 项有未核实内容` : ""}。发现文件不代表存在冲突或可以直接删除。</p>
      <p className="environment-root">数据目录：<code>{inventory.root}</code></p>
      <div className="environment-items">{inventory.items.map(item => <details key={item.id} className="environment-item">
        <summary><span>{item.label}</span><span className="environment-state">{item.state === "detected" ? "发现文件" : item.state === "unknown" ? "待核实" : "已知位置未发现"}</span><Icon name="chevron-down" /></summary>
        <p className="connect-update-detail">{item.note}</p>
        <ul className="environment-locations">{item.locations.map(location => <li key={location.path}>
          <div className="environment-location-title"><span>{location.purpose}</span><span>{size(location)}</span></div>
          <code>{location.path}</code>
          {location.issues.map(issue => <p key={issue} className="environment-issue">{issue}</p>)}
        </li>)}</ul>
      </details>)}</div>
      <details className="environment-item"><summary><span>候选命令来源</span><span className="environment-state">{inventory.commands.length} 个文件</span><Icon name="chevron-down" /></summary>
        <p className="connect-update-detail">按桌面进程 PATH 的顺序列出；同一命令出现多次时，可能存在多份安装。这里只检查文件存在，不执行命令或核实版本。</p>
        {inventory.pathIncomplete && <p className="environment-issue">部分 PATH 位置未能扫描；缺少结果不代表未安装。</p>}
        {inventory.commands.length ? <ul className="environment-locations">{inventory.commands.map(command => <li key={`${command.command}:${command.path}`}><span>{command.command}{command.link ? " · 链接" : ""}</span><code>{command.path}</code></li>)}</ul> : <p className="connect-update-detail">本次扫描未发现候选命令文件。</p>}
      </details>
      {inventory.residuals && <details className="environment-item" aria-label="安装残留逐项清单">
        <summary><span>安装暂存与恢复材料</span><span className="environment-state">{inventory.residuals.items.length} 项 · 保留待核实</span><Icon name="chevron-down" /></summary>
        <p className="connect-update-detail">逐项列出已知安装任务、更新文件及托管目录旁的旧版本材料。这些文件可能仍用于安装或恢复，未取得删除依据。目录与其中的归档可能同时列出，大小不能相加。</p>
        {!inventory.residuals.items.length && <p className="connect-update-detail">本次未列出候选条目；不代表不存在其他安装残留。</p>}
        {!inventory.residuals.complete && <p className="environment-issue">清单未完整核实。</p>}
        {inventory.residuals.issues.map(issue => <p key={issue} className="environment-issue">{issue}</p>)}
        <ul className="environment-locations">{inventory.residuals.items.map(location => <li key={location.path}>
          <div className="environment-location-title"><span>{location.purpose}</span><span>{size(location)}</span></div><code>{location.path}</code>
          <p className="environment-issue">{location.retention}</p>
          {location.issues.map(issue => <p key={issue} className="environment-issue">{issue}</p>)}
        </li>)}</ul>
      </details>}
      <details className="environment-item"><summary><span>扫描范围与限制</span><Icon name="chevron-down" /></summary><ul className="environment-notes">{inventory.notes.map(note => <li key={note}>{note}</li>)}</ul></details>
    </>}
    <section className="environment-selected" aria-label="指定旧目录只读扫描">
      <h2>指定旧目录</h2>
      <p className="connect-update-detail">填写可能留有旧安装的完整路径，检查其中的文件大小。安装来源未核实，禁止自动删除；此处结果不用于上方卸载操作。</p>
      <label htmlFor="environment-selected-path">旧目录完整路径</label>
      <input id="environment-selected-path" value={selectedPath} disabled={busy} maxLength={4096} spellCheck={false} autoComplete="off" onChange={event => { setSelectedPath(event.target.value); setSelectedInventory(null); setSelectedError(""); }} />
      <button className="connect-secondary" disabled={busy || !selectedPath.trim()} onClick={() => void scan(false, selectedPath)}><Icon name="search" />只读扫描指定目录</button>
      {selectedError && <p className="connect-error" role="alert">{selectedError}{selectedInventory ? " 下方保留上次结果，不能作为本次检查结论。" : ""}</p>}
      {selectedInventory && <>
        <p className="environment-root">本次指定路径：<code>{selectedInventory.root}</code></p>
        <p className="connect-update-detail">安装来源未核实 · 禁止自动删除</p>
        <ul className="environment-locations">{selectedInventory.items.flatMap(item => item.locations).map(location => <li key={location.path}>
          <div className="environment-location-title"><span>{location.purpose}</span><span>{size(location)}</span></div><code>{location.path}</code>
          {location.issues.map(issue => <p key={issue} className="environment-issue">{issue}</p>)}
        </li>)}</ul>
        <ul className="environment-notes">{selectedInventory.notes.map(note => <li key={note}>{note}</li>)}</ul>
      </>}
    </section>
  </section>;
}
