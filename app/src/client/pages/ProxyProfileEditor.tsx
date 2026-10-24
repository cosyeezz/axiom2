import { useEffect, useRef, useState } from "react";
import { proxySourceLimit, type ModelProxyState, type ProxyKernel, type ProxyNode } from "../../shared/model-proxy.js";
import { Select } from "../Select.js";

export type ProxyDraft = { revision: string; id?: string; name: string; kernel: ProxyKernel; format?: "share" | "native"; node: string; source: string; inspectionId?: string; nodes?: ProxyNode[] };
export function ProxyProfileEditor({ draft, setDraft, state, busy, conflict, inspecting, notice, canCancelInspection, onCancelInspection, onInspect, onSave, onCancel }: {
  draft: ProxyDraft; setDraft: (draft: ProxyDraft) => void; state: ModelProxyState; busy: boolean; conflict: boolean;
  inspecting: boolean; notice?: { text: string; error?: boolean }; canCancelInspection: boolean; onCancelInspection: () => void;
  onInspect: (source: string, kernel: ProxyKernel) => Promise<void>; onSave: () => void; onCancel: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null), generation = useRef(0);
  const [readingQr, setReadingQr] = useState(false), [qrError, setQrError] = useState("");
  const disabled = busy || readingQr, importing = draft.kernel === "mihomo" || draft.format === "share";
  const needsNode = importing && !draft.node.trim() && (draft.kernel === "mihomo" || !!draft.source.trim() || !draft.id);
  const inspectionExpired = importing && draft.kernel === "xray" && !!draft.nodes?.length &&
    (state.inspection?.id !== draft.inspectionId || state.inspection?.kernel !== "xray");
  const needsInspection = importing && draft.kernel === "xray" && !!draft.source.trim() && (!draft.inspectionId || !draft.nodes?.length || inspectionExpired);
  useEffect(() => () => { generation.current++; }, []);
  function changedSource(source: string): ProxyDraft {
    return { ...draft, source, node: source.trim() ? "" : state.profiles.find(profile => profile.id === draft.id)?.node ?? "", nodes: undefined, inspectionId: undefined };
  }
  async function readQr(file: File) {
    if (disabled) return;
    const current = ++generation.current;
    setReadingQr(true); setQrError("");
    try {
      const { decodeProxyQr } = await import("../settings/proxy-qr.js");
      const source = await decodeProxyQr(file);
      if (current !== generation.current) return;
      setDraft(changedSource(source));
      // Reading a QR never fetches a subscription automatically; the user reviews its text first.
    } catch (error) { if (current === generation.current) setQrError((error as Error).message); }
    finally { if (current === generation.current) setReadingQr(false); }
  }
  return <form className="proxy-editor" onSubmit={event => { event.preventDefault(); if (!disabled && !conflict && !needsNode && !needsInspection) onSave(); }}>
    <fieldset className="tools-fields">
      <div className="field"><label htmlFor="proxy-profile-kernel">运行内核</label><Select id="proxy-profile-kernel" label="运行内核" value={draft.kernel} disabled={disabled}
        options={[{ value: "xray", label: "Xray-core" }, { value: "mihomo", label: "mihomo" }]}
        onChange={kernel => { setQrError(""); setDraft({ ...draft, kernel: kernel as ProxyKernel, format: "share", node: "", nodes: undefined, inspectionId: undefined }); }} /></div>
      {draft.kernel === "xray" && <div className="field"><label htmlFor="proxy-profile-format">导入方式</label><Select id="proxy-profile-format" label="导入方式" value={importing ? "share" : "native"} disabled={disabled}
        options={[{ value: "share", label: "分享链接或订阅" }, { value: "native", label: "高级：Xray outbound JSON" }]}
        onChange={format => { setQrError(""); setDraft({ ...draft, format: format as "share" | "native", node: "", nodes: undefined, inspectionId: undefined }); }} /></div>}
      <div className="field"><label htmlFor="proxy-profile-source">{importing ? "分享链接、订阅地址或配置内容" : "原生 outbound JSON"}</label>
        <textarea className="input num" id="proxy-profile-source" disabled={disabled} rows={6} autoComplete="off" spellCheck={false} required={!draft.id || state.profiles.find(profile => profile.id === draft.id)?.kernel !== draft.kernel} maxLength={proxySourceLimit} value={draft.source}
          placeholder={draft.id ? "已保存的内容不回显；留空保留，输入替换" : importing ? `vless://…\n也支持 vmess://、trojan://、ss://、多行分享链接或订阅地址${draft.kernel === "mihomo" ? "、Clash 配置" : ""}` : '{ "protocol": "vless", "settings": { … }, "streamSettings": { … } }'}
          onChange={event => { setQrError(""); setDraft(changedSource(event.target.value)); }}
          onPaste={event => { const file = [...event.clipboardData.files].find(item => item.type.startsWith("image/")); if (importing && file) { event.preventDefault(); void readQr(file); } }} />
        {importing ? <>
          <div className="tools-actions">
            <button className="btn" type="button" disabled={disabled} onClick={() => fileInput.current?.click()}>{readingQr ? "正在读取图片…" : "导入二维码图片"}</button>
            <input ref={fileInput} type="file" disabled={disabled} hidden accept="image/png,image/jpeg,image/webp,image/gif,image/bmp" aria-label="二维码图片" onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void readQr(file); }} />
            <button className="btn btn-primary" type="button" disabled={disabled || !state.managed || !draft.source.trim() || (draft.kernel === "mihomo" && !state.installations.mihomo)} onClick={() => void onInspect(draft.source, draft.kernel)}>{inspecting ? "正在识别…" : "识别节点"}</button>
            {inspecting && <button className="btn" type="button" disabled={!canCancelInspection} onClick={onCancelInspection}>取消识别</button>}
          </div>
          {!state.managed && <p className="field-help">当前平台无法运行节点识别程序。可继续编辑并保存已有线路，或使用高级配置。</p>}
          <div className="tools-feedback" aria-live="polite">{notice && <p className={notice.error ? "tools-error" : "field-help"} role={notice.error ? "alert" : "status"}>{notice.text}</p>}</div>
          <p className="field-help">二维码也可直接粘贴到输入框，图片在浏览器本地解码。点击「识别节点」后读取内容；订阅地址会从其服务器下载。{draft.kernel === "mihomo" ? "支持分享链接、Base64 列表和 Clash 配置。" : "支持分享链接和 Base64 列表，保存后由 Xray-core 运行。首次识别会从官方自动下载导入组件，可取消。"}</p>
          {!state.installations[draft.kernel] && <p className="field-help">{draft.kernel === "mihomo" ? "请先在上方安装 mihomo，再识别节点。" : "启动线路前，请先在上方安装 Xray-core。"}</p>}
          {inspectionExpired && <p className="tools-error" role="alert">识别结果已失效，请重新识别节点。</p>}
          {!inspectionExpired && draft.nodes?.length ? <div className="field"><label htmlFor="proxy-import-node">选择节点</label><Select id="proxy-import-node" label="选择节点" disabled={disabled} value={draft.node}
            options={draft.nodes.map(node => ({ value: node.name, label: `${node.name} · ${node.type}` }))}
            onChange={node => setDraft({ ...draft, node, name: !draft.name || draft.name === draft.node.slice(0, 80) ? node.slice(0, 80) : draft.name })} />
            <p className="field-help">已识别 {draft.nodes.length} 个节点；每条线路选择一个节点。识别成功不代表节点已连通，请核对导入结果。</p></div>
            : !inspectionExpired && draft.node && <p className="field-help">当前节点：{draft.node}</p>}
          {draft.kernel === "mihomo" && <details><summary>手动填写节点名称</summary><div className="field"><label htmlFor="proxy-profile-node">节点名称</label><input className="input" id="proxy-profile-node" disabled={disabled} maxLength={300} value={draft.node} onChange={event => setDraft({ ...draft, node: event.target.value })} /><p className="field-help">需与 mihomo 识别出的名称完全一致；未命名节点显示为「未命名节点」。节点不存在时连接失败。</p></div></details>}
        </> : <p className="field-help">粘贴一个可独立使用的 Xray outbound 对象，需要安装 Xray-core。</p>}
      </div>
      <div className="field"><label htmlFor="proxy-profile-name">线路名称</label><input className="input" id="proxy-profile-name" disabled={disabled} required maxLength={80} value={draft.name} placeholder="识别节点后自动填写，可修改" onChange={event => setDraft({ ...draft, name: event.target.value })} /></div>
      <p className="field-help">配置内容最多 2 MB（UTF-8）。线路凭据保存在本机；编辑保存后需要重新启动线路。</p>
    </fieldset>
    {qrError && <p className="tools-error" role="alert">{qrError}</p>}
    {conflict && <p className="tools-error" role="alert">代理配置已改变，当前输入已保留。请核对线路后重新保存。</p>}
    <div className="configuration-actions"><button className="btn btn-primary" type="submit" disabled={disabled || conflict || needsNode || needsInspection}>保存线路</button>
      {conflict && <button className="btn" type="button" disabled={disabled} onClick={() => setDraft({ ...draft, revision: state.revision })}>保留输入并采用最新版本</button>}
      <button className="btn btn-ghost" type="button" disabled={disabled} onClick={onCancel}>取消编辑</button></div>
  </form>;
}
