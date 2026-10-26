// packages/agent-cli/bin/preload-lazy-chunks.cjs
// 把 bin/codebuddy 里的 preload 逻辑抽成独立模块，便于集成测试直接调用，也让
// bin/codebuddy 保持只做入口分派。
//
// issue #11961 相关的完整语义见 bin/codebuddy 里挂 `__CODEBUDDY_PRELOAD_LAZY_CHUNKS__`
// 的注释。此模块只是那段函数体的搬家。
//
// 契约：
//   - chunkDir 是一个具体 variant 的 lazy 目录（例如 dist/lazy、dist/lazy-headless）
//   - 优先读 `<chunkDir>/manifest.json` 的 `lazy_files` 数组，只加载列表内的文件
//   - manifest 缺失 / JSON 破损 / IO 异常 → fallback 到 readdir 全加载（仅 .js/.cjs/.mjs）
//   - 目录整体不存在 → 返回 `{ source: 'missing', loaded: 0, failed: 0 }`，不抛
//   - 单个 chunk 加载失败静默计入 failed，不阻塞其它
//   - 返回值：`{ loaded, failed, source }`；source ∈ 'manifest' | 'readdir' | 'missing'
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const url = require('url');

async function preloadLazyChunks(chunkDir) {
    let files;
    let source = 'manifest';

    // 优先读 manifest —— 只加载"本 bundle 版本"的 chunks，避免并发升级场景下
    // 把外来版本的 chunks 加进本进程 require.cache 造成模块图污染。
    try {
        const raw = await fsp.readFile(path.join(chunkDir, 'manifest.json'), 'utf8');
        const manifest = JSON.parse(raw);
        if (manifest && Array.isArray(manifest.lazy_files)) {
            files = manifest.lazy_files.filter(
                f => typeof f === 'string' && /\.(m?js|cjs)$/.test(f),
            );
        }
    } catch (_e) {
        // manifest 缺失 / 解析失败 / IO 异常 → 走 readdir 兜底。
    }

    if (!files) {
        source = 'readdir';
        try {
            const entries = await fsp.readdir(chunkDir);
            files = entries.filter(entry => /\.(m?js|cjs)$/.test(entry));
        } catch (_e) {
            // 变体目录不存在（dev 未构建 / 该变体本次未产出），静默 no-op。
            return { loaded: 0, failed: 0, source: 'missing' };
        }
    }

    const chunkPaths = files.map(entry => path.join(chunkDir, entry));

    // Step 1: 并发异步预读到 OS page cache（不阻塞主线程），失败静默——
    // 后续加载时 Node 会再自己读一次，缺失就走 fallback 报错路径。
    await Promise.all(chunkPaths.map(p => fsp.readFile(p).catch(() => undefined)));

    // Step 2: 按扩展名走对应的 loader 让 Node cache 命中路径。
    let loaded = 0;
    let failed = 0;
    for (const chunkPath of chunkPaths) {
        try {
            if (chunkPath.endsWith('.mjs')) {
                // ESM 走 dynamic import(URL) —— 命中 ModuleMap 后与 require.cache 同源免疫。
                await import(url.pathToFileURL(chunkPath).href);
            } else {
                // .cjs / .js 都按 CJS 加载（Node 默认；即便主 bundle 是 mjs，chunk 结构仍是 CJS）。
                require(chunkPath);
            }
            loaded++;
        } catch (_e) {
            failed++;
            // 单个 chunk 失败不阻塞升级；让 rspack 后续 import 触发实际错误更好定位。
        }
    }
    return { loaded, failed, source };
}

module.exports = { preloadLazyChunks };
