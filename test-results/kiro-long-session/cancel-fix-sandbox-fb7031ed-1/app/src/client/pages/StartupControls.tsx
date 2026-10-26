import { useState, type ButtonHTMLAttributes } from "react";
import { Icon } from "../Icon.js";

export function IconButton({ label, icon, spinning = false, className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; icon: string; spinning?: boolean }) {
  return <button type="button" {...props} className={`startup-icon-button ${className}`} aria-label={label} data-tooltip={label}><Icon name={icon} className={spinning ? "startup-spin" : ""} /></button>;
}
export function CommandLine({ label, command }: { label: string; command: string }) {
  const [feedback, setFeedback] = useState("");
  return <div className="startup-command-block"><span>{label}</span><div className="startup-command"><code>{command}</code><IconButton label={`复制${label}`} icon={feedback === "已复制" ? "check" : "copy"} onClick={() => void navigator.clipboard.writeText(command).then(() => setFeedback("已复制"), () => setFeedback("复制失败，请选择命令手动复制。"))} /></div>{feedback && <small role="status">{feedback}</small>}</div>;
}
export function ResourceLink({ url, label, onOpen }: { url: string; label: string; onOpen?: () => void }) {
  const [feedback, setFeedback] = useState("");
  async function copy() {
    try { await navigator.clipboard.writeText(url); setFeedback("已复制"); }
    catch { setFeedback("复制失败，可选择地址手动复制"); }
  }
  return <div className="startup-resource"><div><span>{label}</span><code>{url}</code></div><div className="startup-resource-actions"><IconButton label={`复制${label}`} icon={feedback === "已复制" ? "check" : "copy"} onClick={() => void copy()} />{onOpen ? <IconButton label={`打开${label}`} icon="external-link" onClick={onOpen} /> : <a className="startup-icon-button" aria-label={`打开${label}`} data-tooltip={`打开${label}`} href={url} target="_blank" rel="noreferrer"><Icon name="external-link" /></a>}</div>{feedback && <small role="status">{feedback}</small>}</div>;
}
