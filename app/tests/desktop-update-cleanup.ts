import { setTimeout as delay } from "node:timers/promises";

export type UpdateCleanupJob = { token: string; pid: number; phase: string; running: boolean };

// A dead worker with a nonterminal job may have left npm running. Unknown state
// and interrupted jobs are never permission to delete an installation fixture.
export async function waitForUpdateExit({ readJob, isAlive, previousToken, timeoutMs = 900_000, pollMs = 500,
  now = Date.now, sleep = delay }: {
  readJob: () => Promise<unknown>;
  isAlive: (pid: number) => boolean;
  previousToken: string | null;
  timeoutMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<unknown>;
}): Promise<UpdateCleanupJob> {
  const deadline = now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const job = await readJob() as Partial<UpdateCleanupJob> | null;
      if (job && typeof job.token === "string" && /^[a-f0-9]{64}$/.test(job.token) && job.token !== previousToken &&
          Number.isInteger(job.pid) && job.pid! > 0 && job.running === false &&
          ["complete", "error", "ready"].includes(job.phase!) && !isAlive(job.pid!)) return job as UpdateCleanupJob;
    } catch (error) { lastError = error; }
    if (now() >= deadline) throw Error("Cannot confirm a terminal update and exited owner; retain the fixture.", { cause: lastError });
    await sleep(Math.min(pollMs, deadline - now()));
  }
}
