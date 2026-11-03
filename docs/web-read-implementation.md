# 原生 web_read 首版

本轮按[联网访问设计](axiom-web-access-design.md)先交付一个工具：**主 Agent 的 `web_read`**。`web_search`、OpenCLI 浏览器复用与人工验证前台化仍属后续工作。本轮没有部署或重启已有后台。

## 使用契约

模型侧说明现仅保留用途、调用方式与选择限制：`Read public HTTP(S) pages for their content. Use urls for a new read, or sourceId and cursor to continue. Browser login and JavaScript are not supported.` `maxChars` 默认值和 `targetRefs` 预留状态放在参数说明中；不预告结果展示，不改变输入结构、返回数据或执行校验。

```json
{"urls":["https://example.com","https://www.typescriptlang.org/docs/"],"maxChars":12000}
```

每次最多 4 个 URL，`maxChars` 是每项返回字符上限，范围 500–20000，默认 12000。返回的 JSON 同时是模型可见内容与工具结构化详情，包含请求/来源标识、状态、读取时间、路由、正文、证据完整性与错误诊断。

```json
{"sourceId":"<返回的来源标识>","cursor":"<返回的游标>","maxChars":12000}
```

续读只使用已存快照，**不重新请求页面**。游标签名绑定快照/偏移，快照归属工作空间及会话；同一会话后续 run 可续读，其他会话不可访问。快照在 30 分钟、容量淘汰或后台重启后失效；失效明确报错，不偷偷重新抓取。TTL 在访问时强制验证，过期对象惰性清理，不承诺空闲时准时物理销毁。

输入必须三选一：`urls`、`sourceId + cursor`、`targetRefs`。`targetRefs` 为后续搜索签发预留，首版没有签发者，全部明确返回 `TARGET_EXPIRED`，不会猜测或重建 URL。

- 每项可成功、空内容、部分证据或失败；批量保留逐项诊断。
- `truncated` 表示本次分页还有后续；`complete:false` 表示存储的提取正文自身已截断，状态为部分证据。
- `sourceId` 是临时证据引用，不是永久归档地址。
- 网页是**不可信来源材料，不是执行指令**；没有额外总结模型。

## 访问与安全边界

- 固定 `public-direct`：不继承模型/环境代理，不使用全局 dispatcher，不失败换路。需要代理的网络会失败，不自动切换通道。
- 仅 HTTP(S) 标准端口，不发送 Cookie、Authorization、Referer，不复用登录资料。
- URL、全部 A/AAAA 地址、每个重定向目标都检查。拒绝私网、链路本地、回环、特殊用途地址与 IPv6 转换/本地 NAT64 前缀；连接 lookup 固定到检查过的地址，保留原始 Host/TLS 主机校验。
- 接受公开 HTML、文本/Markdown 及文本 JSON/XML；不读取 PDF、二进制附件，不执行页面脚本、不加载子资源。
- HTML 使用固定 Defuddle 0.19.6 + linkedom 0.18.14，在可终止 worker 中本地转换 Markdown；`useAsync:false` 禁止远程 extractor enrichment。worker 有内存限制，但**不是 OS 网络沙箱**。
- 已知挑战页、短登录页、JavaScript 提示页分别返回诊断。检测是保守启发式，不保证识别每一种挑战页；没有自动浏览器或账号升级。
- 查询串、凭据、明显敏感或过长路径等不作为可点击引用；正文 URL 也做保守消隐。隐藏后的显示地址**不是等价可访问链接**。这不是通用秘密检测，任意正文/标题不保证无敏感信息，模型提交的原始工具参数也不在本工具输出脱敏保证内。
- 当前不承诺技术页面代码块的逐字保真、表格/数学公式的无损转换或动态内容完整性。

### 资源限额

| 项目 | 首版上限 |
|---|---:|
| 每次读取总期限 | 30 秒（包括正文与解析） |
| HTTP 响应头 / 正文空闲 | 10 秒 / 5 秒 |
| 单次 HTML 解析 | 8 秒 |
| 重定向 | 4 跳 |
| 每页下载 / 解压后 | 2 MB / 4 MB |
| 每份提取快照 | 300000 个 UTF-16 字符 |
| 快照数量 / 总正文 | 32 份 / 200 万字符 |
| 宿主同时读取 | 4 个请求，每批内部顺序读取 |
| 每个 run 调用 | 20 次，失败与续读亦计数 |

忙碌/预算超限明确返回，不形成无限等待队列。URL 最长 4096 字符，响应头另限 32 KiB。

## 接线

- [契约](../app/src/shared/web-read.ts)、[安全 HTTP](../app/src/server/web-access/safe-http.ts)、[提取 worker](../app/src/server/web-access/extract-worker.ts)、[服务与快照](../app/src/server/web-access/service.ts)、[原生工具](../app/src/server/web-read-tool.ts)。
- 独立 [web RPC](../app/src/server/web-access/rpc.ts)：`web-call` / `web-cancel` / `web-reply`，不增加 `TaskTool` 分支。宿主提供可信 scope/run/lease，参数不能覆盖。
- [AgentRuns](../app/src/server/agents/runs.ts) 在准入时核查主 Agent、会话存在、活动租约、未停止/结束及连接状态；结束钩子先撤销工具所有者，再归还执行池。
- [agent-worker](../app/src/server/agent-worker.ts) 只为主 Agent 注册，首次启动/重载均激活；断线、关闭、run finally 清理待处理调用；复用要求没有待处理 web 调用。普通子代理与后台模型任务不自动得到工具。
- [环境预览](../app/src/server/session-environment.ts) 与 SDK 实际工具定义同源。

## 验证记录

2026-10-31，当前安装 Pi 1.4.0：

- 新工具/HTTP/所有权测试 22 项及环境预览、执行协议、worker pool、记忆工具、工具摘要回归合计 **95 项通过**：首次组合运行 94/94；随后新增原生工具→RPC→宿主→快照成功往返测试，受影响服务测试重跑 12/12，其余文件未变。
- 覆盖私网/特殊 IP、混合 DNS、socket lookup 固定、重定向、gzip/Brotli 双限额、收到响应头后的取消/期限、parser 线程取消、快照隔离/游标/到期/淘汰、迟到提交、租约撤销、主工具准入和预览 parity。网络安全测试使用离线 mock，不宣称实际部署 NAT64/恶意 DNS 实网穿透测试。
- 真实公共 HTTP smoke：`https://example.com/` 返回 156 字符、完整；`https://www.typescriptlang.org/docs/` 提取 9389 字符，首段 500 字符并返回续读游标。均为 `http-local / public-direct`，未使用浏览器。
- `npm --prefix app run build`、`node scripts/check-package.mjs` 均 exit 0。发布包 1071 文件检查、隔离安装/临时服务生命周期/更新检查通过；包含编译后的提取 worker，三个新依赖在根/app 清单和锁文件一致。普通 Node、无 TS loader 的生产 JS worker 正文/链接提取及挑战/登录/JS shell 诊断通过。最后新增测试后再次全量 TypeScript 检查通过，业务源码未再变更。
- 额外真实 worker/子代理回归 **30 通过、1 失败**。失败为已有 [agent.test.ts](../app/tests/agent.test.ts) 的连接删除断言：期待 `ACTIVE_RUNS_CONFIRMATION_REQUIRED`，但其他工作区改动在 [model-service.ts](../app/src/server/model-service.ts) 新增了更早的 `ACCOUNT_CONNECTION_IN_USE` 保护。本轮未改该逻辑或掩盖断言；该综合用例后续的删除模型/崩溃恢复段未执行，不能声称完整集成套件全绿。
- 没有重启现有运行后台，也未用实际模型完成生产工具调用；macOS 以外平台未实机验证。

相关测试：[服务与 RPC](../app/tests/web-read.test.ts)、[HTTP](../app/tests/web-read-http.test.ts)、[所有权](../app/tests/web-read-ownership.test.ts)、[环境 parity](../app/tests/session-environment.test.ts)。
