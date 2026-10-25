# Kiro 保活优化验证记录

本目录仅记录 Kiro 专用连接池优化的本机 mock 回归和构建，不替代 [原生聊天验收](../kiro-inference/validation/README.md)，不进入其 79 份原始静态文件 manifest。

执行目录：仓库 `app`；Node v24.19.0，项目 Undici 8.10.2。全部使用本机 mock/fixture，不读取真实账号、不验证真实 Kiro/代理表现，不关闭 TLS 校验。详情与限制见[连接池说明](../../kiro-connection-pooling.md)。

| 检查 | 实际结果 | 完整日志 |
| --- | --- | --- |
| Kiro 六文件 | 46/46，exit 0，报告耗时 50.042 秒 | [kiro-tests.log](kiro-tests.log) |
| 通用八文件 | 25/25，exit 0，报告耗时 96.131 秒 | [compatibility-tests.log](compatibility-tests.log) |
| 代理断言命名/注释修订后专项复跑 | 4/4，exit 0，报告耗时 33.244 秒 | [pooling-tests.log](pooling-tests.log) |
| `npm run build` | exit 0，含 `tsc --noEmit`、Vite、server 编译 | [build.log](build.log) |

最后两测试文件的修订仅把 `proxyFailureClosed` 更名为 `proxyRejectionFailed`，并说明“拒绝后未到达目标 TLS”不是对所有 DNS/直连回退路径的独立监测；断言和生产实现不变。46项套件发生在该措辞修订前，修订后受影响的4项已复跑；其余不变测试未重复运行。

构建只有 Vite 大 chunk 提示，PowerShell 将该 stderr 提示格式化为 `NativeCommandError`，不表示构建失败；实际进程退出码为0。除必要的 UTF-16LE → UTF-8 解码外，日志内容不作修饰。[进程结果与命令](results.json)保留实际 exit 与执行范围；不凭无输出日志推定成功。

```powershell
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-auth.test.ts tests/kiro-callback.test.ts tests/kiro-catalog.test.ts tests/kiro-chat.test.ts tests/kiro-runtime.test.ts tests/kiro-pooling.test.ts
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/model-runtime.test.ts tests/model-catalog.test.ts tests/model-network.test.ts tests/model-oauth-config.test.ts tests/model-oauth.test.ts tests/model-auth-preparation.test.ts tests/qoder-runtime.test.ts tests/codebuddy-runtime.test.ts
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-pooling.test.ts
npm run build
```

60秒 fallback、120秒 H1 提示 cap 有源码/选项证据；4.6秒本机 TLS 计数不等于测量精确的60/120秒寿命、H2经CONNECT或真实线上延迟改善。无预热流量、自动重放；未部署、重启、提交。
