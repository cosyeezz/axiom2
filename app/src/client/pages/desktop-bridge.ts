export const DESKTOP_RESPONSE_TIMEOUT_MESSAGE = "客户端响应超时，结果尚未确认。请重新读取状态；安装或启动可能仍在进行。";

// A response deadline ends only the UI wait, never the native operation.
export class DesktopResponsePendingError extends Error {
  readonly code = "response-unconfirmed";
  constructor(message: string, readonly response?: Promise<unknown>) { super(message); this.name = "DesktopResponsePendingError"; }
}
export function isDesktopResponsePending(cause: unknown): boolean {
  return cause instanceof DesktopResponsePendingError || cause instanceof Error && /结果尚未确认|结果未确认|更新任务会继续运行|服务操作超时|清理响应无效|清理响应读取失败|清理响应超过读取上限|无法读取清理响应/.test(cause.message);
}
export async function desktopInvoke<T>(command: string, args: object = {}, timeoutMs?: number): Promise<T> {
  const bridge = (window as unknown as { __TAURI_INTERNALS__?: { invoke: (command: string, args: object) => Promise<T> } }).__TAURI_INTERNALS__;
  if (!bridge) throw Error("此操作需要 Axiom2 桌面客户端。可在当前步骤复制安装命令或官方下载地址。");
  const action = (args as { action?: string }).action;
  const limit = timeoutMs ?? (command === "axiom_service" && ["start", "stop", "open"].includes(action || "") ? 65_000 : command === "axiom_peers" ? 15_000 : ["axiom_remote", "axiom_local"].includes(command) ? 65_000 : 25_000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const response = Promise.resolve().then(() => bridge.invoke(command, args));
  try {
    return await Promise.race([response, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DesktopResponsePendingError(DESKTOP_RESPONSE_TIMEOUT_MESSAGE, response)), limit);
    })]);
  } catch (cause) {
    // Tauri rejects Rust Result::Err(String) as a string. Consumers such as
    // task controls require Error.message to show the actual refusal.
    throw typeof cause === "string" ? Error(cause) : cause;
  } finally { clearTimeout(timer); }
}
export function stored(key: string, fallback = ""): string {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
export function remember(key: string, value: string) { try { localStorage.setItem(key, value); } catch {} }
