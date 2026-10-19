export async function desktopInvoke<T>(command: string, args: object = {}, timeoutMs?: number): Promise<T> {
  const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: object) => Promise<T> } }).__TAURI_INTERNALS__;
  if (!bridge) throw Error("此操作需要 Axiom2 桌面客户端。可在当前步骤复制安装命令或官方下载地址。");
  const action = (args as { action?: string }).action;
  const limit = timeoutMs ?? (command === "axiom_service" && ["start", "stop", "open"].includes(action || "") ? 65_000 : command === "axiom_peers" ? 15_000 : ["axiom_remote", "axiom_local"].includes(command) ? 65_000 : 25_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([Promise.resolve().then(() => bridge.invoke(command, args)), new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Error("客户端响应超时，结果尚未确认。请重新读取状态；安装或启动可能仍在进行。")), limit);
    })]);
  } finally { clearTimeout(timer); }
}
export function stored(key: string, fallback = ""): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
export function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
