// Same-directory atomic visibility, not power-loss durability. Never delete the destination.
import * as defaultFs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
const backoffMs = [25, 50, 100, 200, 200, 200];
export function createAtomicJsonWriter({ fs = defaultFs, platform = process.platform, sleep = (ms, signal) => delay(ms, undefined, { signal }) } = {}) {
  return async function atomicJson(path, value, { signal } = {}) {
    signal?.throwIfAborted();
    const body = JSON.stringify(value);
    if (typeof body !== 'string') throw TypeError('Atomic JSON requires a serializable value.');
    const temporary = `${path}.${randomBytes(8).toString('hex')}.tmp`;
    let handle, created = false, failed = false;
    try {
      signal?.throwIfAborted();
      handle = await fs.open(temporary, 'wx', 0o600); created = true;
      await handle.writeFile(body);
      await handle.close(); handle = undefined;
      // Windows sharing conflicts can report either EBUSY or EPERM. The latter
      // also covers permanent permissions, so retry is bounded, not a claim
      // that every EPERM is transient. Only rename is retried, using one tmp.
      for (let attempt = 0; ; attempt++) {
        signal?.throwIfAborted();
        try { await fs.rename(temporary, path); break; }
        catch (error) {
          if (error?.code === 'stop-unconfirmed') throw error;
          signal?.throwIfAborted();
          if (platform !== 'win32' || !['EBUSY', 'EPERM'].includes(error?.code) || attempt >= backoffMs.length) throw error;
          await sleep(backoffMs[attempt], signal);
          signal?.throwIfAborted();
        }
      }
      // A successful rename has committed. A later cancellation cannot undo it.
    } catch (error) {
      failed = true;
      throw error?.code === 'stop-unconfirmed' ? error : signal?.aborted ? signal.reason : error;
    } finally {
      let cleanupError;
      if (handle) { try { await handle.close(); } catch (error) { cleanupError = error; } }
      // An exclusive-open collision is somebody else's file, never ours to rm.
      if (created) { try { await fs.rm(temporary, { force: true }); } catch (error) { cleanupError ??= error; } }
      // Preserve the primary failure/cancellation if a scanner also holds tmp.
      if (!failed && cleanupError) throw cleanupError;
    }
  };
}
export const atomicJson = createAtomicJsonWriter();
