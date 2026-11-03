# HTTPS 采集与最终请求对照

用于“请求到底发了什么”“CLI 成功而 Provider 失败”“UA 已对但传输仍不同”。先读[验证门禁](verification.md)，本页不授予安装、抓包、CA/代理、插桩或实发权限。**已有样本优先复用；需要现场采集才走下列流程。** MITM 是经授权的 HTTP 明文观察路线，不是默认必装工具，也不证明直连 TLS 一致。

## 1. 定义一个可回答的问题

固定产品/CLI 与内置 runtime 版本、平台、认证模式、精确模型/思考档位、目标入口、受控输入与成功判据。划定本轮是文本、工具往返还是下一用户轮，不同时扩成全目录测试。

写入[实验合同](../templates/CASE-CONTRACT.md)：提示/物理请求/辅助调用预算、deadline、字节上限、claim、失败动作及恢复owner。基线与目标条件不同的地方保留，不删除两端真实 system/history/tools/security 来制造相同。

先记录当前代理、进程 CA、默认模型与服务加载身份的必要安全字段。安装工具、改代理/局部 CA、重启、运行官方 CLI 和模型实发均须已有对应授权，历史授权不转移。

## 2. 选择观察层，避免工具选错

| 需要证明 | 最小方法 | 边界 |
|---|---|---|
| serializer/parser 是否符合 CLI | 同版本源码＋合成夹具 | 不证明实际发送 |
| 原生 sender 收到哪些字段 | 不替换 sender 的受限 observer | 仍可能早于默认补头/重定向 |
| 两端的实际 HTTP 头/正文/响应 | 已有 capture 或已授权本机 HTTPS MITM | 代理改变传输；不是未修改直连 |
| 连接、DNS、SNI、协商 | 有界 pcap/tcpdump＋适配解码器 | 密文不能回答 HTTP 正文 |
| 客户端不支持局部代理/CA | 先查日志/源码，再考虑另授权的运行观察 | 不自动关闭 TLS、绕过 pinning 或注入 |

普通 CONNECT/SOCKS/VLESS 是转发，不是 HTTPS 解密。先确认问题需要哪层证据，不为抓字段一开始搭 Frida/native 注入基础设施。

## 3. 工具和局部信任准备

本机 mitmproxy 路线示例（Kiro 历史验证版本 12.3.1；当前执行前核版本/配置/端口）：

```bash
mitmweb --listen-host 127.0.0.1 --listen-port 8080 \
  --web-host 127.0.0.1 --web-port 8081
```

- 检查进程归属，只监听 loopback，不公开管理端或含访问令牌的 URL。
- 不加 `-w`，核既有配置/插件没有保存原文、HAR/flow、未知日志。没写 `-w` 不自动证明不落盘。
- 信任公开 CA 证书文件，不复制 CA 私钥、不装系统根、不关 TLS 校验。保留他人证书/进程，不“跑完删除全部 CA”。
- Node 的 `NODE_EXTRA_CA_CERTS` 必须在目标进程启动前设置；当前 shell 修改不使已运行后端热生效。worker/launcher/runtime 各自继承和信任需核，Node 支持不证明 Rust 支持。
- 如必须重启，先构建、独立控制器启动、核 HTTP/WS 与实际加载；不依赖当前会话不断线。只改变已授权进程，不改全局代理/防火墙。

### 先无模型验证，再取样

顺序：自有无凭据 HTTPS → 同版本 runtime/网络库 HTTPS → 必要且授权的目录请求 → 模型请求。先证代理可达、局部 CA 生效、能看到解密后的内容，别用模型调用调试抓包工具。curl 成功不能代替 Node/目标 runtime 成功；目录成功也不证推理权限。

## 4. 连接两端的正常入口

宿主通过正常 provider 配置临时选择外部代理，保存后读取实际配置确认，不只看按钮/receipt。若保存超时，先等并读回，不重复点击或直接改配置绕过 reconcile。

**保留 UI→worker→SDK→hooks/observer→原生 sender 的真实路径。** provider-only 成功不能替它验收；统计 observer 只能包装既定 sender，不能注入通用 Fetch 替代它。

官方 CLI 使用自身正常登录。核该版本支持的参数，然后用进程局部环境启动；Kiro 历史有效示例，不是通用 flags/CA 规格：

```bash
env HTTPS_PROXY=http://127.0.0.1:8080 \
  HTTP_PROXY=http://127.0.0.1:8080 \
  NODE_EXTRA_CA_CERTS="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" \
  kiro-cli chat --v3 --model deepseek-3.2
```

代理/CA 变量须实际继承：分别赋值未 export 不保证子进程得到，另开 shell/旧进程也不算。核 NO_PROXY 等是否旁路，不盲目清空全部环境、改变 HOME、强制重登或复制凭据。用户手动发送已取得样本时，代理不再另发一遍。

## 5. 先记录 flow 基线，只看差集

用 mitmweb 本地界面；需要自动化时先加载 OpenCLI 的使用/浏览器技能，按当前真实 schema 操作，不硬套旧命令。历史采用 OpenCLI browser open/eval，在页面同源读取以下 API（12.3.1，当前需核）：

- `GET /flows`：元数据。
- `GET /flows/{id}/request/content.data`：解码请求正文。
- `GET /flows/{id}/response/content.data`：解码响应正文。

浏览器 eval 内存示意（不是可直接给 bash 执行的 JS）：

```javascript
// 发送前：只返回 count。不要 return flows 本体。
const flows = await (await fetch('/flows')).json();
window.captureBefore = new Set(flows.map(f => f.id));
return { baselineCount: flows.length };
```

之后分别从正常入口取受控样本，每次受预算/claim 限定；终态后留有界窗口查迟到请求。只处理新 ID，不能用“最后一条”或位置下标归因。按 host/path、body 中实际模型、受控输入存在性、运行关联和时间窗识别主请求。

主推理、工具后续、下一轮、OAuth refresh、目录、标题/摘要、配置、MCP 分组计数。tools=0/包含 title 字样只支持候选，不等源码绑定；配置 403 不等主推理 403；辅助 simple-task 不等偷偷切主模型或重试。

页面 globals 丢失但代理 RAM 仍在时，重开原界面、按安全基线 ID 找回已有样本，不重发用户提示。代理也丢失则记录证据缺口，不假装能恢复。

## 6. RAM 中比较，只返回白名单投影

不要让 eval/snapshot/stdout 返回原始 flow、完整 headers/body、token/profile 值、未知错误。原文仅代理/浏览器 RAM；不导出 HAR/flow，不保存敏感 hash，不为交给 REA 另落原文。正常认证/会话存储与额外调试证据分开说明。

| 组 | 核对内容 | 持久化结果 |
|---|---|---|
| 路由 | method、受控 host/path、实际模型字段、操作名、content-type | 已白名单公开值、匹配谓词 |
| headers | 名称集合及重复项、UA/origin、隐私/attempt、Connection、缺少与额外 | 公开值/数量；Authorization 仅格式/存在 |
| body | root keys、字段类型/缺省/null、消息角色、工具 schema、metadata | 结构、计数、相等谓词 |
| 字节 | 实际编码 bytes 与 Content-Length | 长度与匹配；不是 JS 字符数 |
| 认证/profile | 独立认证方式、正常路由、header/body 关系 | 存在/格式/相等谓词；不要求 token 字节相同 |
| 动态身份 | conversation/root/continuation/call/response/attempt | 格式、同轮/跨轮关系；不归一化后称一致 |
| 响应 | status、SSE/eventstream、事件序列/终态、call 参数与 marker | 安全类型、固定分类、计数、匹配谓词 |
| 数量/时序 | 每类物理请求、实际 retry/等待、迟到辅助 | 计数、观测窗口、归因强度 |

小写化 header 名称可作语义集合比较，但保留重复项；不能证明原始大小写/顺序/wire 字节相同。代理的 `request.http_version` 不证明 upstream 或直连版本/TLS。字段名称本身也须校验，未知事件名用安全字符集过滤，不原样输出疑似上下文。

宿主“无额外标识”指禁额外元数据/框架注入；caller 真实 system/history/tools 中的名称、路径、安全要求不能删。报告区分注入与用户内容，不能声称整个 body 不含任何本地信息。

## 7. 差异驱动修复与复验

1. 先看 endpoint/schema/流格式，再看 sender/补头，再看事件/工具/续接；别只改 UA。
2. 每处回查绑定版本 CLI，合成复现并跑本地 HTTP＋实际 SDK observer 路径，禁止通用 Fetch 偷换 sender。文本成功但传输错仍是该合同失败。
3. 修改冻结后验受影响层；部署核新产物与实际加载，再用新 case/marker，不回写旧失败。
4. 官方基线版本/条件有效且样本仍可读就复用，不每次重跑官方。
5. 工具另证 call→宿主执行→result 回传→最终终态；下一用户轮再证历史和身份。隐私不能自动降低，attempt 要反映真实策略，未知重试不实现猜测循环。

若代理零新增，依次检查进程启动、环境继承、代理可达、目标 runtime CA、旁路、观察窗口。**不能推出 CLI 没联网，也不能直接判登录/证书问题。** Kiro 自动尝试曾超时、后来用户交互成功，但前者根因仍未知。缺新依据不重复发送。

## 8. 恢复和交付

成功/失败都恢复 provider 原代理并读回；局部 CA 是否移除另记，需要重启才消除时不能用“代理已恢复”冒充“CA已移除”。模型选择若改全局默认，先等目标run/Agent settled，再用单独空会话恢复并核测试会话仍保留测试选择。只清理自有资源；仍有唯一 RAM 证据的代理何时关闭须明确决定。

交付分列功能、HTTP 差异、工具/下一轮、已知差异、未覆盖认证/refresh/辅助/直连 TLS、恢复读回。header 名称集合相同不等值全同，更不等服务端不可区分。

## 9. REA 的位置

加载当前可用 `reverse-engineer-anything`，先发现工具真实 schema；不强行引入，也不自行启用集成。

- `inspect_web_network_capture` 等用于已有 capture 分析，summary→必要分页；先核数据保留/处理授权，不重放 URL。
- pcap 解码按宿主/tshark 依赖选工具；读取已有 pcap 不等现场采集，pcap 不等 HTTPS 明文。
- REA 另有浏览器场景、Frida/LLDB/process capture 等运行观察/采集，按其 `references/runtime-observation.md`；不等通用 MITM，也不自动提供现成 TLS hook。

Kiro 此路线实际用 mitmweb＋OpenCLI；[历史完整流程和六份报告](../../../../docs/cli-native-capture-comparison.md)仅供案例追溯，端点/版本/授权不能直接照搬。
