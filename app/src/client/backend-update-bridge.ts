import { stableVersion, validBackendUpdate, type BackendUpdateAction, type BackendUpdateReply } from "../shared/backend-updates.js";

type Report = (probe: number, result: { data?: BackendUpdateReply; error?: string }) => Promise<unknown>;
/** Fixed, read/check/notice-only relay. It never accepts an install operation. */
export async function relayBackendUpdates(detail: unknown, connected: boolean,
  run: (op: string, params: Record<string, unknown>) => Promise<unknown>, report: Report) {
  if (!detail || typeof detail !== "object") return;
  const value = detail as { probe?: number; action?: BackendUpdateAction; version?: string };
  if (!Number.isSafeInteger(value.probe) || value.probe! < 1 || !["get", "check", "present", "dismiss"].includes(value.action!)) return;
  try {
    if (!connected) throw Error("后台连接尚未确认，请恢复连接后重试。");
    if (["present", "dismiss"].includes(value.action!) && !stableVersion(value.version)) throw Error("版本通知目标无效。");
    const result = await run(`backendUpdates.${value.action}`, value.version ? { version: value.version } : {});
    if (!validBackendUpdate(result)) throw Error("当前后台尚未支持版本通知，请通过服务与更新页面检查。");
    await report(value.probe!, { data: result });
  } catch (error) {
    await report(value.probe!, { error: (error instanceof Error ? error.message : "版本检查失败").slice(0, 500) }).catch(() => {});
  }
}
