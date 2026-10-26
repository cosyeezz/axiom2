export type DownloadProgress = { name: string; downloaded: number; total?: number; speed: number; startedAt: number; updatedAt: number; lastByteAt: number };
export function readProgress(value: unknown): DownloadProgress | null {
  const p = value as DownloadProgress | null;
  if (!p || typeof p.name !== "string" || ![p.downloaded, p.speed, p.startedAt, p.updatedAt, p.lastByteAt].every(n => Number.isFinite(n) && n >= 0) || (p.total !== undefined && (!Number.isFinite(p.total) || p.total <= 0 || p.downloaded > p.total))) return null;
  return p;
}
function bytes(value: number) {
  if (value < 1024) return `${Math.floor(value)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`;
  return `${(value / 1024 / 1024).toFixed(1)} MiB`;
}
export default function InstallProgress({ value, running }: { value: unknown; running: boolean }) {
  const p = readProgress(value);
  if (!p) return null;
  const percent = p.total ? Math.min(100, p.downloaded / p.total * 100) : null;
  const waiting = running && Date.now() - p.lastByteAt >= 5000;
  const stale = Date.now() - p.updatedAt >= 5000;
  return <div className="install-download" aria-label="文件下载进度">
    <p>{p.name} · {bytes(p.downloaded)} / {p.total ? bytes(p.total) : "总大小未知"}{percent !== null && ` · ${percent.toFixed(1)}%`}</p>
    <progress aria-label={`${p.name} 下载进度`} max={p.total || 1} value={p.total ? p.downloaded : undefined} />
    <p>{running ? stale ? "正在等待新的下载状态" : `${bytes(waiting ? 0 : p.speed)}/s` : "下载已结束"} · 已用 {Math.max(0, Math.floor((p.updatedAt - p.startedAt) / 1000))} 秒{waiting && ` · 已 ${Math.floor((Date.now() - p.lastByteAt) / 1000)} 秒未收到新数据，正在等待网络`}</p>
    <small>百分比仅表示当前文件下载，不代表整体安装进度。</small>
  </div>;
}
