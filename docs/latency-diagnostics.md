# 流输出延迟诊断

Axiom 在内存中记录模型请求、服务端转发和浏览器 React 提交的分段时间，用于区分供应商等待、重试、应用排队和页面提交延迟。服务端和每个浏览器各保留最近 2,000 条记录；重启服务或刷新页面后，相应记录会清空。记录不写入会话历史或数据库。

## 读取记录

运行包含此实现的后端和前端后，打开目标会话，让页面订阅其消息，再执行一次请求。在页面开发者工具 Console 中运行：

```js
const trace = await window.axiomLatency();
console.table(trace.server.records);
console.table(trace.browser);
```

已知运行 ID 时可过滤：

```js
const trace = await window.axiomLatency("运行 ID");
```

返回结构为 `{ server: { records, capacity }, browser }`。也可通过已有 WebSocket 命令通道发送 `diagnostics.latency`，可选参数为 `{ runId }`；它只返回服务端记录。诊断查询不发起模型请求。

浏览器没有订阅的会话仍可记录模型阶段，但没有对应的实时页面交付记录。记录被环形缓冲区覆盖后无法补回，应在异常发生后及时读取。

## 阶段与含义

| stage | 时间点 | durationMs 含义 |
| --- | --- | --- |
| `model.request` | SDK 流函数被调用 | 无 |
| `model.payload` | 请求 payload 钩子被调用 | 无 |
| `http.start` | 一次 fetch 尝试开始 | 无 |
| `http.headers` | fetch 返回 Response | 本次尝试等待响应头的时间 |
| `http.error` | fetch 抛错 | 本次尝试至报错的时间 |
| `model.response` | SDK 响应钩子被调用 | 本次模型请求起的累计时间，可能包含 SDK 内部重试 |
| `model.first_event` | 首个已解析供应商流事件 | 本次模型请求起的累计时间 |
| `model.first_text/thinking/toolcall` | agent 首次产出对应非空增量 | 本次模型请求起的累计时间 |
| `model.end` | 该流的原生结果 Promise 就绪 | 本次模型请求总耗时；错误/取消看 `code` |
| `retry.start/end` | 会话层重试通知 | start 的值是计划等待时间，并非实测等待 |
| `ipc.receive` | 主服务收到对应 worker 消息 | worker 发出至收到的时间 |
| `view.publish` | 消息批处理后发布 | 从 IPC 收到到发布的时间 |
| `ws.enqueue` | 准备向一个连接发送快照 | 无；位于序列化之前 |
| `ws.start` | 已序列化帧开始写入 WebSocket | 帧进入发送队列后的等待时间 |
| `ws.sent` | WebSocket 写回调成功 | 本次写入耗时；不代表远端确认收到 |
| `browser.receive` | 浏览器接受该快照 | JSON 解析耗时 |
| `browser.commit` | 对应消息对象经过 React layout effect | 浏览器收到至 React 提交的耗时 |

`model.end` 表示模型结果已就绪，可能早于 worker 消费完缓冲事件、IPC 发布或页面更新。`browser.commit` 表示 DOM 提交，不能当作物理屏幕完成绘制或用户看见内容的时间。折叠活动组中的消息要等展开后才记提交；同一对象只记一次。

`purpose` 按 SDK 路由 session ID 区分 `session` 与 `auxiliary`。当前主会话请求属于前者，压缩/分支摘要通常属于后者；它不是所有扩展场景下的业务用途分类。辅助请求独立闭合计时，不替换当前会话消息的关联请求。

## 关联和判读

每次模型调用有独立 `requestId`，同一运行的多次调用共享 `runId`。SDK 内部 HTTP 重试用同一请求的 `attempt` 区分；会话重试会产生新的模型请求。

从 IPC 到页面，使用 `requestId + updateId + streamId + seq` 关联同一批消息更新。WebSocket 和浏览器记录另带 `connectionId`：每个连接独立生成随机 ID，重连后改变，不包含设备地址或身份。先用浏览器记录中的 connection ID 选出该窗口对应的服务端 WS 记录，避免把快、慢窗口混在一起。

时长使用所属进程的单调时钟；IPC 同机阶段使用壁钟差值。`at` 为 Unix 毫秒时间。服务器与远程手机/电脑可能存在时钟偏差，不能直接用 `browser.receive.at - ws.sent.at` 断言网络耗时。

常见线索：

- HTTP 响应头等待长、503 或 `overloaded`：重点查看供应商响应及重试；本地队列修复不能消除上游过载。
- 响应头已到，但首事件/首文本迟到：等待发生在流开始或模型产出阶段。
- `view.publish` 耗时高：关注主服务的处理、消息批处理或调度延迟。
- `ws.start` 排队耗时高，或 `ws.sent` 写入时间高：关注对应连接的发送排队及背压。
- 服务端阶段正常，而 `browser.commit` 耗时高：关注浏览器调度、组件提交或折叠内容等待展开。

流式交付记录按每请求首次、约每秒和终态采样，并非逐 token 日志。中间增量可在发送队列中合并，因此单条 `ws.enqueue` 没有后继 `ws.start/sent` 也可能代表已被更新替代或连接关闭，不能单凭缺失判定卡死。历史集合快照没有逐消息时序信封。

## 传输兼容性与隐私

HTTP 尝试观测覆盖支持注入 fetch 的 `openai-responses`、`openai-completions`、`azure-openai-responses`、`anthropic-messages`。已有显式 fetch 会被透传包装，Response 原样返回，不读取、克隆或缓冲响应体。

只有原 SDK 流、没有 runtime/native 提供商流覆盖、且 compat 标准 API 实现身份未变时，才允许补入观测用默认 fetch。自定义流或传输保持自己的默认选择，可能没有 `http.*` 记录。供应商若忽略传入钩子，相应阶段也可能缺失；WebSocket 模型传输不经过 fetch。观测只旁路等待原生流 `result()`，不消费迭代器；自定义 result 方法不额外调用，会记 `model.unobserved_end` / `custom_result`。

记录只包含时间、随机/运行关联 ID、状态码、字节数和固定错误分类，不含提示词、回复正文、请求 URL、headers、密钥或原始错误文本。服务端采样状态最多保留 256 个请求，诊断缓冲区字段使用白名单。

## 发送队列修复契约

已物化的帧保持 FIFO。懒快照是发送时重新读取的当前状态，若被正在进行的历史读取或已有大帧阻塞，后继已物化帧仍可发送。可靠终态和读取响应之间保持入队顺序，懒快照仍阻断跨屏障的增量合并。

历史读取在写入间隙获得准入机会，避免连续小帧饿死读取；读取与懒快照同时等待时轮流获得物化机会，避免反向饥饿。预算仍为普通帧总额加一个合法大帧。直接发送的额外大帧仍可能触发预算保护并要求重连，不保证任意负载下永不关闭连接。

## 验证方式

在 `app` 目录运行：

```sh
TMPDIR=/private/tmp node --import tsx --test --test-concurrency=1 tests/outgoing.test.ts tests/latency.test.ts tests/latency.integration.test.ts
TMPDIR=/private/tmp AXIOM_TEST_BROWSER='/path/to/chrome' node --import tsx tests/latency.check.ts
```

集成测试使用临时 root、动态端口和本地模拟供应商，覆盖两次 503 后成功、SDK/会话两层重试、worker 复用与双连接关联；浏览器测试验证真实 Message 组件的 DOM 提交、折叠展开及旧快照拒绝。它们不请求真实供应商，不代表已完成真实慢客户端的长期负载压测。
