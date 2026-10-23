import { useEffect, useState } from "react";
import type { ArchiveEntry } from "../../shared/file-preview.js";

export function MediaFile({ url, kind, name }: { url: string; kind: "audio" | "video"; name: string }) {
  const [error, setError] = useState(false);
  useEffect(() => setError(false), [url]);
  return <div className="file-media"><p className="file-format-notice">本地播放，不自动播放。编码支持取决于浏览器；当前直接读取上限16 MiB。</p>{error ? <p role="alert">浏览器无法解码此音视频，请使用本地播放器查看原文件。</p> : url && (kind === "video" ? <video src={url} controls preload="metadata" playsInline aria-label={`视频：${name}`} onError={() => setError(true)} /> : <audio src={url} controls preload="metadata" aria-label={`音频：${name}`} onError={() => setError(true)} />)}</div>;
}
export function ArchiveFile({ entries, onOpen }: { entries: ArchiveEntry[]; onOpen: (entry: string) => void }) {
  const [query, setQuery] = useState(""), [limit, setLimit] = useState(200);
  const filtered = entries.filter(entry => entry.name.toLowerCase().includes(query.toLowerCase()));
  return <div className="file-archive"><p className="file-format-notice">{entries.length} 项；只读按需展开，不写入磁盘、不执行成员。单成员最多8 MiB，不递归展开嵌套包。</p>
    <input type="search" aria-label="搜索压缩包成员" placeholder="搜索文件名或目录" value={query} onChange={e => { setQuery(e.target.value); setLimit(200); }} />
    <ul>{filtered.slice(0, limit).map(entry => <li key={entry.name}>{entry.directory ? <span>{entry.name}/</span> : <button type="button" onClick={() => onOpen(entry.name)}>{entry.name}</button>}<small>{entry.directory ? "目录" : `${(entry.size / 1024).toFixed(1)} KB`}</small></li>)}</ul>
    {filtered.length > limit && <button className="btn" onClick={() => setLimit(n => n + 200)}>显示更多（剩余 {filtered.length - limit}）</button>}
    {!filtered.length && <p>没有匹配的成员</p>}
  </div>;
}
