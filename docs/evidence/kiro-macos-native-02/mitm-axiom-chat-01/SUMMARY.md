# Axiom 正常会话首次 HTTPS 明文采集

## 结果

正常 Axiom 新建独立会话，明确确认 `kiro / deepseek-3.2 · off` 后，仅点击发送一次：

> 请只回复 AXIOM_KIRO_CAPTURE_OK，不要调用工具。

助手最终正文精确为 `AXIOM_KIRO_CAPTURE_OK`，UI 无 execution-alert，已不在运行。

本次代理观察窗口新增 **2 条请求**，均 `POST https://runtime.us-east-1.kiro.dev/`、HTTP 200：

| 请求 | 正文核验 | 工具定义 | 分类依据 |
| --- | --- | --- | --- |
| 主请求 | `modelId === deepseek-3.2`；受控输入为 content 后缀；有 system_prompt 包装；history 0 | 9 | 第一个新增 runtime POST，正文含精确测试输入 |
| 会话标题 | `modelId === deepseek-3.2` | 0 | system 精确匹配 session-titles.ts 的 conversationPrompt；JSON 材料的 firstUser 与受控输入相同，assistantBodies 含精确助手回复 |

第一次读取时仅主请求出现；后续读回出现标题请求，故最终计数修正为 2。不能据此宣称整应用只发一次请求。

## 主请求的白名单投影

- method/path：POST `/`；proxy 解析的 request.http_version 为 `HTTP/2.0`。
- x-amz-target 精确匹配 `AmazonCodeWhispererStreamingService.GenerateAssistantResponse`。
- amz-sdk-request 精确匹配 `attempt=1; max=1`；optout 为 `true`。
- Authorization 仅核对非空 `Bearer <non-whitespace>` 格式，不输出值；scope **unknown**。
- profileArn 非空，仅记录存在性，不输出值。
- 顶层键为 conversationState、profileArn；实际请求正文可读取并解析为 JSON；请求、响应均有非空内容。
- header names：authorization、content-type、accept、x-amz-target、x-amzn-codewhisperer-optout、amz-sdk-invocation-id、amz-sdk-request、accept-language、sec-fetch-mode、user-agent、accept-encoding、content-length。

## 条件与证据边界

- 使用开发版 Axiom 正常网页与完整 worker 输入链路，不使用 provider-only/user-only 手工调用。没有删除 system/history/tools/security 或改写请求 API。
- 用户授权的本机 mitmproxy 12.3.1，127.0.0.1:8080/8081。Kiro provider 正常 UI 配置为 external http://127.0.0.1:8080/。
- Axiom 构建成功后按独立控制器重启，4317 新 PID38133；HTTP200、WS connected；进程限定 NODE_EXTRA_CA_CERTS 使用公开 mitm CA。未改系统信任、全局代理或关闭 TLS 校验。
- 原内置代理线路已保留在本会话记忆，便于恢复。mitm 此次直接出站，没有串联 VLESS。
- 抓包初始 5 个已有 flows 仅在 browser RAM 保存 ID 集合；本次只查看差集。原始 headers/body/token/响应及完整上下文仅本机 mitm/browser RAM，**不导出、不持久化原始流量，不对其做 hash**。本文件仅保存固定公开字段、计数与布尔判定。
- UI 正常程序自身仍有正常会话存储；这里“不持久化”指观察器不额外保存原始抓包。
- HTTP 版本是代理 flow 中 client→proxy 的解析字段，不代表原生直连或 proxy→upstream 的版本、TLS 指纹。200 及相同答案不证明请求一致、认证 scope 一致或服务器不可区分。
- 本 case 只有 Axiom 样本；官方 CLI 尚未配对，正式官方/Axiom实发配对仍为 0。下步核定官方正常 CLI 的局部代理/CA入口，再取得同一受控用户输入样本；保留两端真实上下文差异，不删减取等。
