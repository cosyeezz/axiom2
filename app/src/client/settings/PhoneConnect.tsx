import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../Icon.js";
import { ConnectionAddressSelect } from "./ConnectionAddressSelect.js";
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
export function PhoneConnect() {
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
  return <section className="overview-section phone-connect-section" aria-labelledby="phone-connect-heading">
    <h2 id="phone-connect-heading">手机连接</h2>
    <div className="phone-connect-content phone-connect-code">
      <div className="phone-connect-visual">
        {qr ? <svg role="img" aria-label="连接二维码" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff" /><path d={qr.path} fill="#000" /></svg>
          : <span className="phone-connect-placeholder">{failure || status ? "暂无二维码" : "正在生成…"}</span>}
      </div>
      <div className="phone-connect-details">
        <h3>扫码连接这台电脑</h3>
        <p>打开安卓 Axiom，点击「扫码连接」。成功后自动记住，下次直接连接。</p>
        <p className="phone-connect-note">手机与电脑需通过 Tailscale 互通。</p>
        {failure && <p role="alert" className="phone-connect-error">{failure}</p>}
        {!failure && !status && <p role="status">正在读取电脑连接地址…</p>}
        {status && !status.urls.length && <p role="status">{status.error || status.message || "等待 Tailscale 网络，请在电脑上打开并连接 Tailscale。"}</p>}
        {qr && <div className="phone-connect-address">
          <div className="phone-connect-address-heading"><span>本机连接地址</span>
            {status && status.urls.length > 1 && <ConnectionAddressSelect value={address} options={status.urls} onChange={setSelected} />}
          </div>
          <div className="phone-connect-address-row"><code>{address}</code><button className="icon-btn" aria-label="复制地址" title="复制地址" onClick={() => void copy()}><Icon name="copy" /></button></div>
        </div>}
        <div className="phone-connect-actions">
          <button className="btn btn-ghost" onClick={() => setRevision(value => value + 1)}><Icon name="refresh-cw" />刷新地址</button>
          <span role="status">{copied}</span>
        </div>
        {!!status?.urls.length && status.error && <p className="phone-connect-error" role="status">部分地址暂不可用：{status.error}</p>}
      </div>
    </div>
  </section>;
}
