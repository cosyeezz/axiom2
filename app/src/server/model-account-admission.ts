import { resolve } from "node:path";
import { AppError } from "../shared/protocol.js";

// Host-process execution admission only. Account selection and ordinary token
// refresh do NOT revoke executions; destructive credential removal does.
const states = new Map<string, { revision: number; blocked: boolean }>();
const key = (dir: string, provider: string) => `${resolve(dir)}\0${provider}`;
export function accountAdmissionRevision(dir: string, provider: string | undefined) {
  if (!provider) return 0;
  const state = states.get(key(dir, provider));
  if (state?.blocked) throw new AppError("ACCOUNT_REMOVAL_BUSY", "此连接正在删除账号，请稍后重新执行。");
  return state?.revision ?? 0;
}
export function beginAccountRemoval(dir: string, provider: string) {
  accountAdmissionRevision(dir, provider);
  const id = key(dir, provider), previous = states.get(id)?.revision ?? 0;
  const state = { revision: previous, blocked: true };
  states.set(id, state);
  return {
    // A rejected confirmation only releases the temporary admission barrier.
    // Revoke old profiles after the execution preflight/stop has succeeded,
    // before touching credentials, even if deletion then partially fails.
    revoke: () => { state.revision = previous + 1; },
    release: () => { state.blocked = false; },
  };
}
