# 原生 Kiro 最终验证

工作目录 `F:/Axiom/axiom2/app`，Node 测试与本地/mock fixture；源码冻结后运行，不修改真实账号配置。此处日志属于本轮新增聊天实现，而非旧目录基线。

## 命令与结果

```powershell
# 42/42，exit 0，约 17.2 秒
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-auth.test.ts tests/kiro-callback.test.ts tests/kiro-catalog.test.ts tests/kiro-chat.test.ts tests/kiro-runtime.test.ts

# 25/25，exit 0，约 95.8 秒
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/model-runtime.test.ts tests/model-catalog.test.ts tests/model-network.test.ts tests/model-oauth-config.test.ts tests/model-oauth.test.ts tests/model-auth-preparation.test.ts tests/qoder-runtime.test.ts tests/codebuddy-runtime.test.ts

# exit 0，无输出
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.server.json

# exit 0；含全量 tsc --noEmit、Vite build、server tsc emit
npm run build
```

- [Kiro 五文件日志](kiro-tests.log)
- [兼容八文件日志](compatibility-tests.log)
- [server 类型检查空输出记录](server-tsc.log)
- [生产构建日志](build.log)：有大于 500 kB 的 chunk 警告，不是失败。
- [复核脚本](final-check.cjs) / [复核结果](final-check.json)：在仓库根运行 `node docs/evidence/kiro-inference/validation/final-check.cjs`。

类型检查没有输出时 PowerShell 的 `Tee-Object` 没有创建文件，因此这里单独保留零字节记录；退出码 0 来自主执行进程，不把空文件单独当成功依据。日志原文仅做 UTF-16LE/BOM 到 UTF-8 的编码转换（如适用），不改写测试内容。

复核包括原始研究文件清单的字节数及 SHA-256、静态 dumpbin 的退出记录、相关文档本地链接、本任务 authored 文件空白、scoped `git diff --check` 和三份聊天生产模块。`manifest.json` 只列 79 份原始静态研究文件，不包含本验证目录。

**边界**：mock 包含保存/重开/快照模型调用以及实际 Pi Agent 工具执行循环；不是线上账号或服务验收。未验证真实账号权限、企业 profile、计费、服务端协议接受性或 UI 端到端；没有部署、重启、提交，也没有执行全仓所有测试。最终复核只覆盖本任务范围，不清理、覆盖或认领并行 desktop/maintenance/model-proxy 改动。
