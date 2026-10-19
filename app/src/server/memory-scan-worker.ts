import { parentPort } from "node:worker_threads";
import { isAbsolute } from "node:path";
import { digest, memoryFiles, memoryPath, readMemoryBytes, textFile } from "./memory-files.js";

type ScanRequest = { id: number; kind: "scan"; directory: string };
type VerifyRequest = { id: number; kind: "verify"; dependencies: { key: string; path: string }[] };
type Request = ScanRequest | VerifyRequest;

// 资料目录可能包含大量小文件。复用主线程的同一套边界校验，但把同步
// 遍历、读取和哈希限制在工作线程，避免阻塞 HTTP 和 WebSocket 事件循环。
parentPort?.on("message", (request: Request) => {
  try {
    if (request.kind === "scan") {
      // Scans are read-only; the error code lets the service expose a short
      // missing/read-failed reason without returning the filesystem message.
      const files = memoryFiles(request.directory);
      const entry = textFile(memoryPath(request.directory, "MEMORY.md"));
      parentPort?.postMessage({ id: request.id, ok: true, kind: request.kind, files, entry });
      return;
    }
    // The main thread has already checked source ownership, explicit-link
    // authority and resolved each target to an absolute path. Recheck file
    // identity while deriving its byte revision here, where expensive reads
    // cannot stall the service event loop.
    const revisions = new Map<string, string>();
    const verified = request.dependencies.map(({ key, path }) => {
      if (!key || !isAbsolute(path)) throw Error("依赖核验请求无效");
      let revision = revisions.get(path);
      if (!revision) {
        revision = digest(readMemoryBytes(path));
        revisions.set(path, revision);
      }
      return { key, revision };
    });
    parentPort?.postMessage({ id: request.id, ok: true, kind: request.kind, verified });
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : undefined;
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      kind: request.kind,
      code,
      error: error instanceof Error ? error.message : "记忆读取失败",
    });
  }
});
