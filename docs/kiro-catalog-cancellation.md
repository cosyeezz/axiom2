# Kiro 目录请求：等待期限与迟到响应

## 修复范围

[kiro-catalog.ts](../app/src/server/providers/kiro-catalog.ts) 原本创建了 15 秒总期限并向 fetch 传递 signal，但直接等待 fetch、reader.read 和 body.cancel。忽略 signal 的注入 transport，或永久不结束的 cancel，仍可能使目录任务一直等下去。

现在目录 fetch 和逐段读取均有独立的 abort-aware 等待；用户取消与现有 15 秒总期限共享这一边界，并保留原 signal.reason。迟到响应、HTTP 错误与超大响应的 body 会尝试取消，但不会因等待其清理而拖住任务。迟到的 fetch rejection 也被接收，不成为未处理 rejection。

这是 **Axiom 原生目录生命周期的可靠性修复**，不是 Kiro CLI 线上协议等效证明。这项等待修复本身没有改变认证方式、区域选择、URL、Bearer、query/body 双写、分页/大小限额、重试次数、目录缓存范围或原子发布规则。后续另有显式Axiom User-Agent去除，见[当前提交与Mac路线](kiro-macos-handoff.md)；不能把该阶段的“未改UA”描述当当前源码仍发旧UA。独立 ExternalIdP、GetProfile 和未知 API key 用途仍未因此获得支持。

清理属于 best effort：这能停止 Axiom 对不合作异步操作的等待，不能强制停止任意注入代码，也不能保证拒绝取消的底层资源已释放。正常网络仍收到原 abort signal；没有放弃 TLS 校验。

## 离线验证

新增 [kiro-catalog-bounds.test.ts](../app/tests/kiro-catalog-bounds.test.ts)，仅用注入 transport 和合成 Response：

1. fetch 忽略 signal：取消仍及时返回，迟到 body 尝试取消且不等待卡住的清理。
2. 已取消后的迟到 transport rejection 不泄漏为未处理 rejection。
3. reader.read 与 cancel 都不结束时仍保留 TimeoutError/AbortError。
4. HTTP 错误与声明超大响应不会被 cancel 卡住。
5. 流式超过 2 MiB 后不会被 reader.cancel 卡住。
6. 后续分页超时不发布部分模型、不持久化缓存，目录状态标为失败。
7. 预先取消时零物理 fetch。

显式离线回归：catalog-bounds、catalog、auth、auth-bounds、profile、chat、runtime 共 **64/64** 通过（退出码 0）。server 类型检查退出码 0。首次 app 类型检查发现新测试对可选 refreshModels 的类型未收窄，修正后仅重跑受影响的 bounds 文件，**7/7** 通过，完整 app 类型检查退出码 0；生产代码在两次测试间未变。

执行目录 `app`，命令：

```powershell
.\node_modules\.bin\tsx.cmd --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-catalog-bounds.test.ts tests/kiro-catalog.test.ts tests/kiro-auth.test.ts tests/kiro-auth-bounds.test.ts tests/kiro-profile.test.ts tests/kiro-chat.test.ts tests/kiro-runtime.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.server.json
.\node_modules\.bin\tsx.cmd --import ./tests/vite-assets.mjs --test tests/kiro-catalog-bounds.test.ts
.\node_modules\.bin\tsc.cmd --noEmit -p tsconfig.json
```

历史本机日志未纳入版本管理：`app/test-results/kiro-catalog-bounds-971742f3.log`、`kiro-catalog-bounds-final-971742f3.log`、`kiro-catalog-server-types-971742f3.log`、`kiro-catalog-types-final-971742f3.log`。类型检查成功日志为空；当时命令退出码由检查任务核验。以上是历史范围，不是本次新执行；迁移提交的新验证独立见[验证记录](evidence/kiro-macos-transition/README.md)。

没有运行 live 通配测试、真实登录、模型探针或部署/重启。测试证明源码路径的隔离行为，不代表当前运行服务已加载本改动，也不是线上权限或双端网络指纹验收。
