# Kiro 连接池保活优化

Kiro 请求使用其执行进程的全局 Undici dispatcher，不是每次请求新建 Agent。此次只调整 Kiro 的池策略，不改变其他供应商的默认值，也不改变模型端点、代理选择、OAuth、请求取消或总超时。

## 策略

实现：[model-proxy-env.ts](../app/src/server/integrations/model-proxy-env.ts)。

| 项目 | Kiro 策略 |
| --- | --- |
| `keepAliveTimeout` | **60,000 ms**，此前继承 Undici 的 4,000 ms 默认值 |
| `keepAliveMaxTimeout` | **120,000 ms**，限制 HTTP/1.1 服务端超时提示所允许的最长空闲窗口 |
| 服务端较短提示 | 仍遵守，保留 Undici 默认 2,000 ms 安全余量 |
| HTTP/2 | 保留自动协商；空闲且无开放流/待发请求时使用 60 秒超时；不额外改 PING 或并发参数 |
| 直连／代理 | 同一策略传给 `Agent` 和 `EnvHttpProxyAgent` 的 HTTPS CONNECT 目标连接池 |
| 其他供应商 | 保持 Undici 原有默认值 |

策略加入 `configured` key：同配置复用既有 dispatcher；同进程试图切换不同网络/池策略会要求重建执行进程，不能静默串用。不添加付费预热请求、保活请求或适配器自动重放，不为每次模型调用新建 Agent。

**60 秒是无有效 HTTP/1.1 服务端提示时的默认值，不是最低存活保证。** 服务端较短提示、主动关闭、代理断开、取消未完成流、进程退役均可能提前关闭连接；HTTP/2 的 GOAWAY 也可能要求新建连接。空闲超时不等于活动流超时，不会把流式生成限制为 60 秒。

聊天执行进程原本支持会话复用，默认进程空闲 TTL 和最大生命周期为 15 分钟；目录／鉴权网络进程空闲 30 秒回收。本次不延长这些进程及凭据的生命周期。目录 `q.*` 和推理 `runtime.*` 是不同 origin，不共用同一 TCP 连接，也不能跨进程共用池。

## 本机验证

[kiro-pooling.test.ts](../app/tests/kiro-pooling.test.ts) 在独立子进程运行[本机 HTTPS/H2/CONNECT fixture](../app/tests/fixtures/kiro-pooling.ts)，使用[公开测试证书说明](../app/tests/fixtures/kiro-pooling.md)。测试 CA 只通过子进程的 `NODE_EXTRA_CA_CERTS` 信任，不关闭 TLS 校验，不改系统或父进程信任，不使用真实账号或接口。

四个场景均已通过：

| 场景 | 连续三次调用及空闲 4.6 秒后的 TLS 连接数 |
| --- | --- |
| Kiro HTTPS HTTP/1.1 直连 | **1** |
| Kiro HTTPS，经本机 CONNECT 代理 | **1**，CONNECT 隧道也只建立一次 |
| Kiro HTTP/2 | **1** |
| 非 Kiro HTTP/1.1（默认值对照） | **2**，保持原有行为 |

另验证 dispatcher 重复配置不重建、不同策略拒绝复用、原生目录读完响应释放连接、较短服务端提示导致重连、Connection close／HTTP/2 GOAWAY 后恢复、NoProxy 绕过代理、代理拒绝连接时请求失败。代理与不同 origin 的测试只覆盖相应 fixture 断言，不把本机结果扩大为完整生产网络隔离证明。

执行目录 `app`：

```powershell
node --import tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/kiro-pooling.test.ts
```

该测试使用真实时间跨越旧 4 秒阈值；不是完整等待 60／120 秒的寿命测量。当前依赖 Undici 8.10.2；真实 Kiro 的 HTTP 协商、代理及上游 idle policy 尚未联调，不能据此承诺线上每轮都免握手或给出延迟改善百分比。

## 最终回归

- Kiro 认证、回调、目录、聊天、runtime、连接池六文件：**46/46 通过，exit 0**。
- 通用 runtime、目录、网络、OAuth、Qoder、CodeBuddy 八文件：**25/25 通过，exit 0**。
- 只读评审无生产代码阻塞；将代理拒绝断言的命名与注释收窄为实际证明范围后，连接池专项再次 **4/4 通过，exit 0**。此后未改生产实现或测试。
- `npm run build`（含 full TypeScript 检查、Vite 构建和 server TypeScript 编译）：**exit 0**。仅有 Vite 大 chunk 警告。

[本轮验证记录及完整日志](evidence/kiro-pooling/README.md)与原生聊天的静态证据、既有验收记录分开保存，不改写其历史结果。

未部署、重启或提交；生效需后续按正常流程加载新构建的执行进程。
