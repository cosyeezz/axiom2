import { useEffect, useState } from "react";
import { reaEngineDescriptions, reaEngineLabels, reaEnginePathLabels, reaEngineStatusLabels, type ReaEngineState } from "../../shared/rea-engines.js";
import type { ReaState } from "../../shared/rea.js";

type Action = (op: string, params?: Record<string, unknown>) => Promise<void>;
export function ReaEngines({ state, busy, action }: { state: ReaState; busy: boolean; action: Action }) {
  return <section className="section tools-section rea-engines-section" aria-labelledby="rea-engines-heading">
    <div className="section-heading"><h3 id="rea-engines-heading">分析引擎与配套组件</h3><p>按需安装、用时加载，不做预热。</p></div>
    <p className="field-help">后台系统：{state.engineHost ? `${({ win32: "Windows", darwin: "macOS", linux: "Linux" } as Record<string, string>)[state.engineHost.platform] ?? state.engineHost.platform} / ${state.engineHost.arch}` : "等待读取"}。下载和路径均以运行 Axiom 后台的电脑为准，与当前浏览器或手机系统无关。</p>
    <div className="tools-actions"><button className="btn" disabled={busy} onClick={() => void action("rea.engines-check")}>检测配套组件</button></div>
    <p className="field-help tools-help">只检查文件、Java 模块与工具版本，不打开 GUI 或分析目标。环境通过不代表实际桥接或许可已验证。Windows 原生分析还受 REA 的 x64、本地 NTFS 和原生控制模块限制。</p>
    {state.engines?.map(engine => <Engine key={engine.id} engine={engine} state={state} busy={busy} action={action} />)}
    <p className="field-help tools-help">安装到 Axiom 私有目录，下载校验并检测通过后才切换路径；失败或取消保留原配置。不会修改系统 Java、全局 PATH 或其他 MCP 配置。路径保存后请重新检测；已有会话须重新加载技能与 MCP。清空路径恢复环境变量和常用路径发现，不删除已安装文件。</p>
  </section>;
}
function Engine({ engine, state, busy, action }: { engine: ReaEngineState; state: ReaState; busy: boolean; action: Action }) {
  const saved = engine.configured ? engine.path : "";
  const [draft, setDraft] = useState<{ path: string; revision: string }>();
  const path = draft?.path ?? saved;
  const conflict = !!draft && draft.revision !== state.revision && draft.path !== saved;
  useEffect(() => { if (draft && draft.path === saved) setDraft(undefined); }, [draft, saved]);
  const [confirm, setConfirm] = useState<string>();
  const unsupported = engine.status === "unsupported";
  return <div className="rea-engine">
    <div className="section-heading row-between"><h4>{reaEngineLabels[engine.id]}{engine.version ? ` · ${engine.version}` : ""}</h4><span className="tag">{reaEngineStatusLabels[engine.status]}</span></div>
    <p className="field-help">{reaEngineDescriptions[engine.id]}</p>
    <p className={engine.status === "error" || engine.status === "incompatible" ? "tools-error" : "field-help rea-engine-result"}>{engine.detail}</p>
    {engine.checkedAt && <p className="field-help">检测时间：{new Date(engine.checkedAt).toLocaleString()}</p>}
    <div className="field"><label htmlFor={`rea-path-${engine.id}`}>{reaEnginePathLabels[engine.id]}</label><input className="input" id={`rea-path-${engine.id}`} value={path} placeholder={engine.path || "输入后台电脑上的绝对路径"} disabled={busy || unsupported} onChange={event => setDraft({ path: event.target.value, revision: draft?.revision ?? state.revision })} autoComplete="off" spellCheck={false} /></div>
    {conflict && <div className="tools-conflict"><p>配置已由其他操作更新，当前草稿已保留；请重新载入后编辑。</p><button className="btn" disabled={busy} onClick={() => setDraft(undefined)}>放弃草稿并载入最新路径</button></div>}
    <div className="tools-actions">
      <button className="btn" disabled={busy || unsupported || conflict} onClick={() => void action("rea.engineSave", { engine: engine.id, path, revision: draft?.revision ?? state.revision })}>保存{reaEngineLabels[engine.id]}路径</button>
      {engine.installable && <button className="btn" disabled={busy} onClick={() => setConfirm(state.revision)}>安装{reaEngineLabels[engine.id]}</button>}
    </div>
    {!engine.installable && !unsupported && <p className="field-help tools-help">{engine.id === "hopper" ? "仅接入已有完整安装；Hopper 许可由用户自行管理。" : state.version !== "6.7.0" ? "托管安装兼容策略当前验证于 REA 6.7.0，请先安装推荐版本。" : engine.id === "ghidra" ? "当前平台需接入含对应原生反编译组件的完整 Ghidra；不自动编译。" : "当前后台系统/架构暂无受支持的托管发行包，可配置已有兼容版本。"}</p>}
    {confirm && <div className="tools-conflict" role="group" aria-label={`确认安装${reaEngineLabels[engine.id]}`}>
      <p>将从{engine.id === "java" ? "Eclipse Adoptium" : "官方 GitHub Release"}下载{reaEngineLabels[engine.id]}到后台电脑，可能占用数百 MB。保留上游许可文件，组件使用须遵循各自许可。{["jadx", "ghidra"].includes(engine.id) && "请先配置可用 JDK（推荐 21）；否则验证失败不会切换路径。"}</p>
      <div className="tools-actions"><button className="btn btn-primary" disabled={busy} onClick={() => { const revision = confirm; setConfirm(undefined); void action("rea.engine-install", { engine: engine.id, revision }); }}>确认下载安装</button><button className="btn" onClick={() => setConfirm(undefined)}>暂不安装</button></div>
    </div>}
  </div>;
}
