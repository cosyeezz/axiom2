import { parentPort } from "node:worker_threads";
import { memoryFiles, memoryPath, textFile } from "./memory-files.js";
// 遍历、读取和哈希留在工作线程；不再核验旧摘要的依赖索引。
parentPort?.on("message", (request) => {
    try {
        if (request.kind !== "scan")
            throw Error("记忆扫描请求无效");
        const files = memoryFiles(request.directory);
        const entry = textFile(memoryPath(request.directory, "MEMORY.md"));
        parentPort?.postMessage({ id: request.id, ok: true, kind: request.kind, files, entry });
    }
    catch (error) {
        const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
        parentPort?.postMessage({ id: request.id, ok: false, kind: request.kind, code, error: error instanceof Error ? error.message : "记忆读取失败" });
    }
});
//# sourceMappingURL=memory-scan-worker.js.map