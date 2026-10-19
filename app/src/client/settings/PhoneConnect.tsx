import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, Icon } from "../components.js";
import { connectionAddress, connectionQr } from "./connection-qr.js";
import "../styles/phone-connect.css";

type Status = { urls: string[]; error: string; message: string };
async function boundedJson(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("连接地址响应无效，请刷新重试。");
  const decoder = new TextDecoder(); let bytes = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16384) { await reader.cancel(); throw new Error("连接地址响应过大，请刷新重试。"); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
function ConnectionDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<Status | null>(null), [failure, setFailure] = useState("");
  const [selected, setSelected] = useState(""), [revision, setRevision] = useState(0);
  const [copied, setCopied] = useState("");
  const copyGeneration = useRef(0), currentAddress = useRef("");
  useEffect(() => {
    let alive = true, timer: ReturnType<typeof setTimeout>, controller: AbortController | undefined;
    setStatus(null); setFailure("");
    async function refresh() {
      const request = new AbortController(); controller = request;
      let timedOut = false, forbidden = false;
      const timeout = setTimeout(() => { timedOut = true; request.abort(); }, 8000);
      try {
        const response = await fetch("/api/remote", { cache: "no-store", signal: request.signal });
        if (response.status === 403) { forbidden = true; throw new Error("请在电脑本机的 Axiom 工作台查看连接二维码。"); }
        if (!response.ok) throw new Error("连接地址暂不可用，请稍后刷新。");
        const value = await boundedJson(response);
        if (!value || !Array.isArray(value.urls) || value.urls.length > 32 || value.urls.some((url: unknown) => !connectionAddress(url))) throw new Error("连接地址响应无效，请刷新重试。");
        const urls = [...new Set<string>(value.urls.map(connectionAddress))].sort((a, b) => Number(a.includes("[")) - Number(b.includes("[")));
        if (alive) { setStatus({ urls, error: typeof value.error === "string" ? value.error.slice(0, 500) : "", message: typeof value.message === "string" ? value.message.slice(0, 500) : "" }); setFailure(""); }
      } catch (error) {
        if (alive) {
          const known = error instanceof Error && /^(连接地址|请在电脑)/.test(error.message);
          setStatus(null); setFailure(timedOut ? "读取连接地址超时，将自动重试，也可手动刷新。" : known ? error.message : "无法读取连接地址，请检查电脑后台后刷新。");
        }
      } finally {
        clearTimeout(timeout);
        if (alive && !forbidden) timer = setTimeout(refresh, 5000);
      }
    }
    void refresh();
    return () => { alive = false; controller?.abort(); clearTimeout(timer); };
  }, [revision]);
  const address = status?.urls.includes(selected) ? selected : status?.urls[0] ?? "";
  const qr = useMemo(() => address ? connectionQr(address) : null, [address]);
  currentAddress.current = address;
  useEffect(() => { setCopied(""); copyGeneration.current++; return () => { copyGeneration.current++; }; }, [address]);
  async function copy() {
    const owned = ++copyGeneration.current;
    let message = "地址已复制";
    try { await navigator.clipboard.writeText(address); } catch { message = "复制失败，请选择上方地址手动复制"; }
    if (owned === copyGeneration.current && currentAddress.current === address) setCopied(message);
  }
  return <Dialog title="手机连接" onClose={onClose} className="phone-connect-dialog" describedBy="phone-connect-instructions">
    <p id="phone-connect-instructions">在安卓 Axiom 连接页点击「扫码连接」，扫描下方二维码。</p>
    <p className="phone-connect-note">手机与电脑都需连接 Tailscale，并允许相互访问。连接成功后，手机会记住这台电脑。</p>
    {failure && <p role="alert" className="phone-connect-error">{failure}</p>}
    {!failure && !status && <p role="status">正在读取电脑连接地址…</p>}
    {status && !status.urls.length && <p role="status">{status.error || status.message || "等待 Tailscale 网络，请在电脑上打开并连接 Tailscale。"}</p>}
    {status && status.urls.length > 1 && <label className="phone-connect-select">连接地址<select aria-label="选择连接地址" value={address} onChange={event => setSelected(event.target.value)}>{status.urls.map(url => <option key={url} value={url}>{url}</option>)}</select></label>}
    {qr && <div className="phone-connect-code">
      <svg role="img" aria-label="连接二维码" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.path} fill="#000" /></svg>
      <code>{address}</code>
      <button className="btn btn-ghost" onClick={() => void copy()}>复制地址</button>
      <span role="status">{copied}</span>
      <p className="phone-connect-note">二维码只包含连接地址，不包含账户或密钥。</p>
    </div>}
    {!!status?.urls.length && status.error && <p className="phone-connect-error" role="status">部分地址暂不可用：{status.error}</p>}
    <div className="phone-connect-actions"><button className="btn btn-ghost" onClick={() => setRevision(value => value + 1)}>刷新地址</button><button className="btn btn-primary" onClick={onClose}>关闭</button></div>
  </Dialog>;
}

export function PhoneConnect() {
  const [open, setOpen] = useState(false);
  return <><button className="log-row module-row phone-connect-entry" onClick={() => setOpen(true)}><div><h3>手机连接</h3><p>显示二维码，在安卓 Axiom 扫码连接这台电脑</p></div><span className="meta">扫码一次，记住电脑</span><Icon name="chevron-right" /></button>{open && <ConnectionDialog onClose={() => setOpen(false)} />}</>;
}
