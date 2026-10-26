import { AppError } from "../../shared/protocol.js";

export interface TaskAdmissionTurn {
  wait(signal: AbortSignal): Promise<void>;
  release(): void;
}

// Preparation may run concurrently. Only the synchronous call that enqueues a
// pool request takes a turn; never hold it while waiting for a lease or a writer.
export class TaskAdmission {
  private tail: Promise<void> = Promise.resolve();

  reserve(): TaskAdmissionTurn {
    const previous = this.tail;
    let release!: () => void;
    const finished = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => finished);
    return {
      release,
      wait(signal) {
        if (signal.aborted) return Promise.reject(new AppError("AGENT_STOPPED", "执行资源等待已取消"));
        return new Promise<void>((resolve, reject) => {
          const abort = () => {
            signal.removeEventListener("abort", abort);
            reject(new AppError("AGENT_STOPPED", "执行资源等待已取消"));
          };
          signal.addEventListener("abort", abort, { once: true });
          void previous.then(() => {
            signal.removeEventListener("abort", abort);
            if (signal.aborted) abort();
            else resolve();
          });
        });
      },
    };
  }
}
