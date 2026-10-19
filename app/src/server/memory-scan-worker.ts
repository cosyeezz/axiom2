import { parentPort } from "node:worker_threads";
import { memoryFiles, memoryPath, textFile } from "./memory-files.js";

type Request = { id: number; directory: string };

// 资料目录可能包含大量小文件。复用主线程的同一套边界校验，但把同步
// 遍历、读取和哈希限制在工作线程，避免阻塞 HTTP 和 WebSocket 事件循环。
parentPort?.on("message", (request: Request) => {
  try {
    // Scans are read-only; missing memory is returned as unavailable.
    const files = memoryFiles(request.directory);
    const entry = textFile(memoryPath(request.directory, "MEMORY.md"));
    parentPort?.postMessage({ id: request.id, ok: true, files, entry });
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : "记忆读取失败",
    });
  }
});
