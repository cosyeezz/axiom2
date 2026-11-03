# 供应商请求统计（只观察，不限流）

“模型用量与统计”页中的独立「请求监控」标签，显示当前 Axiom 后台的供应商连接级并发、启动以来峰值并发，以及最近滚动 60 秒的 RPM。

## 范围与生命周期

- 按连接的 provider ID 聚合，不按名称、URL 或模型合并；同名连接仍各自统计。
- 覆盖通过 Axiom `createModelRuntime()` 发出的主/子代理、后台及原生压缩、记忆查询/整理、标题生成请求，以及运行时的缓存预热。
- 与账务快照、工作空间、日期和会话过滤独立；选择供应商只筛选显示。
- 不统计认证刷新、目录、官方额度查询，也不统计其他应用使用同一账号产生的请求。
- 仅内存保存；后台重启后清零。无数据库写入、限流、排队、调度或重试策略更改。
- 每个请求拥有随机 ID，IPC 只含开始/结束、供应商 ID、观测精度，以及工作进程实例身份，不含内容、凭据、URL。
- 主进程校验实例 ID、generation、profile；工作进程退出时释放其未结束请求，保留已有峰值和 RPM。执行租约、Agent 活跃状态不能代替请求生命周期。

## 精度边界

### HTTP 逐次观测

仅向已知支持 `fetch` 注入的原始适配器提供透明包装；保留调用者原 fetch、Response、正文和流。包括标准 OpenAI completions/responses、Azure、Anthropic、Codex 的 SSE 路径、Mistral conversations、Pi messages，以及已知原生 Kiro/CodeBuddy 路径。扩展替换标准 API 或原生适配器时不盲目注入。

在原 payload 钩子成功完成后，每次 fetch 调用开始计入并发和 RPM；在此之前的准备查询（包括 Kiro 企业 profile discovery）原样透传但不计数。连接异常或非成功 HTTP 响应到达后释放，避免 SDK 退避期间占并发；成功流式响应保持计数到模型流完成。观察独立 `result()` promise，不读取或重放流事件、不替换响应正文、不关闭重试、不强制 SSE。计数起点是适配器提交 transport，而非已确认上游开始推理；本地连接建立等待也可能在内。

### 调用级降级

Codex WebSocket、Google/Vertex、Bedrock、Qoder 及不能安全注入 fetch 的自定义适配器，使用模型 payload 钩子开始、模型流完成结束，显示“含调用级统计”。

此口径包含 Axiom 重新发起的调用/重试，但一个调用内部的 SDK 重试、WebSocket 重连和 fallback 不一定有公开事件，因此不能宣称完整的网络请求 RPM，且内部等待可能占并发。标记在该后台生命周期内保留，避免同一连接曾使用过降级路径却显示为全精确。绕过 Axiom 模型运行时或不调用 payload 钩子的自定义扩展不在采集范围内。完成观察仅支持 Pi 原生事件流的独立 result promise，不主动调用自定义 result 方法。取消完成后才恢复的钩子不再登记请求，但仍执行原钩子和 transport，不让观察逻辑阻止实际调用。未来如需全量物理统计，应要求 SDK 提供统一 attempt-start/end，而不是 monkey-patch WebSocket 或改变传输方式。

## 查询与界面

`usage.requests` 是应用级只读命令，返回 `startedAt`、`updatedAt`、`providers[{providerId,current,peak,rpm,callLevel}]`。读取只处理内存时间桶，不扫描账务、不访问上游。

首屏就绪后延后200ms可预读一次本机内存统计，不访问上游。持续轮询仅在「请求监控」标签激活、页面可见且连接正常时运行，每次读取完成后等待1秒，避免请求重叠。切走标签卸载组件、停止轮询，但父页面保留上次展示；1秒内同连接代次的预读可直接显示并接续剩余间隔，否则显示旧结果同时立即重读。页面隐藏或断连同样暂停，恢复后立即重新验证。供应商选择独立保留，不应用历史日期/空间/会话/类型条件，也不触发历史账务或官方额度查询。错误和断连保留旧数据并标记陈旧，不将未知值显示成零。仅额度查询的独立 Codex 账号不自动作为推理连接展示。

界面仅展示指标、单位、当前后台范围、更新时间/错误状态及必要的「含调用级统计」精度标记。不再显示「请求统计口径」折叠块或采集机制长文；详细边界保留在本文。

## 验证入口

工作目录 `app`：

- `npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/provider-requests.test.ts tests/worker-pool.test.ts tests/memory-runner.test.ts tests/compression-child.test.ts tests/kiro-compression-worker.test.ts tests/title-generation.test.ts`
- `npx tsx tests/provider-requests.check.ts`（本机未安装 Playwright 浏览器时，可设置 `AXIOM_TEST_BROWSER='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`）
- `npx tsc --noEmit`

测试不使用真实供应商认证或付费模型请求；真实工作进程通过本地 HTTP 夹具验证父子代理、压缩、记忆、独立标题的请求计数、重试、取消和退出清理。浏览器检查包括四标签入口、轮询与账务/官方查询隔离、切走标签及隐藏/断连暂停、恢复前的陈旧状态、供应商选择保留、无统计口径块和窄屏长名称布局。
