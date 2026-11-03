# CLI 原生供应商：抓包与请求对比步骤

整理依据：用户指定的“Kiro请求对齐进度”会话（2026-10-30 起）及下方正式报告。本文是操作方法，不是新一轮抓包、模型调用、安装软件或修改配置的授权；以下命令均为说明，本轮没有执行。端口、模型、CLI 参数是历史案例，执行时需核当前版本与授权。

## 一、历史实际走通的路线

```text
Axiom 正常 UI → worker/SDK/统计包装器 → 原生 sender ─┐
                                                  ├→ 本机 mitmweb:8080 → 供应商
官方 CLI（自己的正常登录，独立发送）─────────────────┘
                                   mitmweb:8081 本地界面
                                            ↓
                              OpenCLI 在页面内存读取 flow
                                            ↓
                            只输出白名单差异表，不导出原始流量
```

这不是 CLI 代发 Axiom 请求，也没有复制 CLI token。mitmweb 负责采集和解密；OpenCLI 负责操作页面、读取和投影。这个案例不依赖 REA 才完成。

关键结果顺序：
1. [Axiom 初次采集](evidence/kiro-macos-native-02/mitm-axiom-chat-01/SUMMARY.md)：主请求和标题请求均收到，证实 HTTPS 解密成功。
2. [官方自动尝试失败](evidence/kiro-macos-native-02/mitm-official-chat-01/SUMMARY.md)：60 秒超时，代理无新增 flow，原因未明，旧 case 没有重试。
3. [用户手动 CLI 成功并配对](evidence/kiro-macos-native-02/mitm-manual-official-chat-01/SUMMARY.md)：发现 Axiom 走旧 GAR/eventstream，官方 DeepSeek V3 走 Responses/SSE。不是只改 UA 就能解决。
4. [live-04 传输验收失败](evidence/kiro-macos-native-02/responses-live-04/REPORT.md)：UA 相同、答案正确，但仍 HTTP/2 和 Fetch 补头。确切原因是 Axiom 的统计包装器注入 Fetch 替换原生 sender，不是 Pi 本体强制。
5. [live-05 限定传输验收通过](evidence/kiro-macos-native-02/responses-live-05/REPORT.md)：正常 SDK 路径上，HTTP/1.1、Connection close、UA、header 名称集合、Content-Length 与终态均符合本次标准。
6. [live-06 工具与新轮验证](evidence/kiro-macos-native-02/responses-live-06/REPORT.md)：同工具轮 continuation 不变，新用户轮更换；call/result 配对、历史保留。没有为每次修改重复跑官方基线。

## 二、可复用操作流程

### 1. 先写比较目标、范围与预算

固定产品/CLI 与内置组件版本、平台、认证模式、精确模型和思考档位，选受控输入及预期 marker。列明本轮比较文本还是工具、是否含下一轮。

- 区分字段协议、HTTP 传输、认证生命周期、直连 TLS，不把四者混成一个“抓包成功”。
- 两端各用自己的正常登录，保留各自 system/history/tools/security。相同用户输入不意味着完整上下文相同；这些差异要记录，不能删除来制造等价。
- 记录现有 provider 代理、进程 CA 配置、默认模型和服务状态，只保存必要安全读回结果。
- 明确提示次数、物理请求及辅助请求预算、超时、停止和恢复责任。每个新 live case exclusive claim，未知 receipt 或超时不自动重发。
- 安装工具、改代理、进程 CA、插桩和模型实发分别确认授权；当前会话旧禁令不会被本方法自动解除。

### 2. 选能回答问题的观察层

| 问题 | 优先方法 | 不能据此证明 |
|---|---|---|
| 我们的构造/解析逻辑是否正确 | 合成夹具、本地 HTTP 测试 | 官方实际发送或服务端接收 |
| 我们的原生 sender 收到什么 | 受限 sender observer，不替换 sender | 更下层补头后的 wire |
| 两端实际 HTTP 头、正文、响应有什么差异 | 已授权的本机 HTTPS MITM，本案例用 mitmweb | 未代理的 TLS 指纹和供应商服务端视图 |
| 已有 HAR/SAZ/flow 如何分析 | 只读复用；必要时 REA capture 分析工具 | 自动重新采集或重放 |
| 连接、DNS、SNI、TLS 协商 | 有界 pcap/tcpdump 与相应解码器 | HTTPS 明文 |
| CLI 不支持代理/局部 CA | 先日志/源码定位；必要时另授权 REA 运行观察 | 不能自动绕过证书固定、关闭校验或注入 |

普通 CONNECT、SOCKS 或 VLESS 转发不等于 HTTPS 解密。先排除“看不到明文”的工具选错，再考虑低层插桩。

### 3. 启动只监听本机的抓包工具

历史实际命令（mitmproxy 12.3.1）：

```bash
mitmweb --listen-host 127.0.0.1 --listen-port 8080 \
  --web-host 127.0.0.1 --web-port 8081
```

检查监听地址、端口归属和当前工具版本。不绑定公网，不公开管理界面或带访问令牌的 URL；不加保存 flow 的 `-w`，不启用其他流量导出/原文日志。既有工具可能已有保存配置，需检查，不能因命令没写 `-w` 就断言无落盘。

保留代理进程以保留 RAM 样本，读取前不要清空全部 flow；更不能停止他人的抓包。

### 4. 先验证代理和 CA，不先消耗模型请求

历史顺序是：无凭据 HTTPS `example.com` → Axiom 同版本 Node/网络库 HTTPS → 正常模型目录请求，逐层看到成功解密后才发聊天。

- 用生成的公开 CA 证书文件做进程局部信任，不复制 mitm CA 私钥。
- Node 的 `NODE_EXTRA_CA_CERTS` 要在进程启动前设置；给已运行 Axiom 的另一个 shell 设变量不会热生效。
- 必要重启按独立控制器流程先构建，再启动并核 HTTP/WS 与加载产物，不靠当前会话断线后手工续启。
- curl 信任成功不能替代 Node 成功，Node 成功也不证明 Rust launcher 的信任链；分别核验。
- 不改系统钥匙串、全局 CA/代理/防火墙，不设置 insecure 或关闭 TLS 校验。若局部方法不支持就停止说明。

### 5. 把 Axiom 的供应商路径接到代理

通过正常设置页面把**目标 provider**临时切到 external `http://127.0.0.1:8080/`，保存后读取实际配置确认生效，不只看按钮成功。

给真正发送请求的进程配置局部 CA；worker 继承关系也要验证。若保存回执超时，先读回，别连续点击。测试后必须恢复原设置，不绕过界面的 disabled/reconcile 状态。

必须测试正常 UI/worker/SDK/observer 链路。provider-only 测试通过不足以发现统计包装器替换 sender 这类问题。

### 6. 记录 flow 基线，再发送一次 Axiom 样本

用 mitmweb 界面，或 OpenCLI 的 browser open/eval。实际历史页面 API（12.3.1，当前使用前仍需核版本）：

- `GET /flows`：flow 元数据。
- `GET /flows/{id}/request/content.data`：解码后的请求正文。
- `GET /flows/{id}/response/content.data`：解码后的响应正文。

在页面内保存发送前的 flow ID 集合；发送后只处理 ID 差集，不靠“最后一个 flow”或位置索引认主请求。flow ID 是代理内部引用，不是账号凭据。

可复用的浏览器内存示意（通过 browser eval 运行，须先按实际 OpenCLI 版本发现命令/schema）：

```javascript
// 发送前。返回值可输出；不要 return flows 本体。
const flows = await (await fetch('/flows')).json();
window.captureBefore = new Set(flows.map(f => f.id));
return { baselineCount: flows.length };
```

发一次受控输入，等运行终态；随后观察一定窗口内的迟到辅助请求。主推理、refresh、目录、标题、摘要、配置、MCP 请求分别分类。一个 prompt 可能有多个模型请求。

### 7. 获取官方 CLI 的独立样本

先确认 CLI 版本和支持的参数。历史用户最终采用一整行 `env` 的交互启动：

```bash
env HTTPS_PROXY=http://127.0.0.1:8080 \
  HTTP_PROXY=http://127.0.0.1:8080 \
  NODE_EXTRA_CA_CERTS="$HOME/.mitmproxy/mitmproxy-ca-cert.pem" \
  kiro-cli chat --v3 --model deepseek-3.2
```

用户在这个进程里输入同一受控文本。不要只在 shell 分别赋值而不 export，然后另开进程；那样不能保证继承。检查 NO_PROXY 等现有变量是否导致绕过，但不盲目清空整个环境、改变 HOME 或要求重登。

这条命令是 Kiro 历史有效实例，不是所有 Rust/Node CLI 的通用证书方案。自动非交互尝试曾超时且代理零新增；后来手动成功，不足以反推出那次超时的根因。

如果没抓到：分别核进程是否启动、环境继承、代理可达、证书报错、实际是否走旁路。零新增 HTTP flow 只表示该窗口代理没观察到，不能说 CLI 没联网。失败保留未知，改变方案需新授权/claim，不自动发第二次提示。

### 8. 在内存中读取正文，输出白名单差异表

原始 token、Authorization、profile 值、请求/响应和上下文留在 mitm/browser RAM。不要让 OpenCLI eval 返回原始 flow、完整 headers/body，不拍含 secret 的快照，不导出 HAR、flow、未知异常或敏感 hash。

对新增 flow 先用 host/path、实际 body 中的模型、受控输入存在性、时间窗和运行 ID 关联主请求；不要仅按 UA 或列表下标识别。

比较项分组：

| 层 | 比较字段 | 输出形式 |
|---|---|---|
| 路由 | method、受控 host/path、模型字段、content-type、目标操作 | 已白名单的公开值及匹配结论 |
| 请求头 | 名称集合/缺少/额外；UA、origin、attempt、隐私选项；Connection | 公开协议值，保留重复头数量；不是所有值都可输出 |
| 正文 | root keys、类型、缺省/null、消息角色、工具 schema、stream、metadata | 结构、计数、谓词；必要时 RAM 字节/顺序比较 |
| 凭据/profile | Bearer 非空格式、profile header/body 关系、正常账号路由 | 存在/相等/格式布尔；不要求独立 token 逐字相同 |
| 大小 | 实际编码后的请求 bytes 与 Content-Length | 字节计数及相等谓词，不能用 JS 字符数代替 |
| ID | conversation/root/continuation/call/response/attempt | 格式和生命周期关系，不归一化成“相同” |
| 响应 | status、SSE/eventstream、事件类型/计数、工具参数、终态和最终标记 | 白名单类型、固定原因码、结构计数、精确匹配布尔 |
| 请求数量 | 主/工具后续/下一轮/refresh/目录/辅助/实际 retry | 分组计数和归因强度；未知用途保留未知 |

集合比较可小写化 header 名称做语义比较，但需保留重复项；这不能证明原始大小写、顺序或整包字节相同。`request.http_version` 只描述代理观测这一段，不代表 proxy→upstream 或未代理直连。

不能为了“不暴露宿主标识”删除用户明确提供的 system/history/tools、路径或安全约束；要排查的是额外宿主元数据和框架自动注入。内容里用户本来就提供了 Axiom 字样，需如实区分，不保证全文不含该词。

### 9. 按差异修复，离线验证后再取新样本

顺序是协议路由/schema → 原生 sender 与 SDK 包装链 → 流解析和终态 → 工具/历史/续接。每处差异回查绑定版本的 CLI 源码；无证据部分标为推测。

- 先用本地 HTTP 和真实 SDK 注册/observer 夹具验证。运行测试时不改被测源码。
- 不只检查 UA：live-04 就是 UA 对、答案对、传输错。后来确证是 Axiom observer 注入 Fetch；只改核心 sender 不够。
- 构建部署后确认 PID、启动时间和产物含改动，再用新 case/marker 验证，不覆盖旧失败记录。
- 官方基线仍在 RAM 且版本/条件没变就复用，不为了对比每次重跑官方。
- 文本通过只覆盖文本；工具另测 call → result 回传 → 最终回复，再测下一用户轮 ID 与历史。截断、取消、思考、图片、重试与认证要按范围各自验证。
- opt-out 等隐私差异不能为对齐自动降低保护；attempt 头要和真实重试行为一致，不靠改数字伪造实现。

### 10. 恢复读回，给限定结论

无论成功失败，都通过正常入口恢复 provider 代理并读回。需要移除临时进程 CA 时按授权重启读回，不能把“代理恢复”说成“CA也已移除”。示例历史中代理已恢复，但局部 CA 曾仍留在进程，这是两回事。

如果模型选择接口会改全局偏好，通过单独空会话恢复默认；测试会话保留测试 provider，数据库/界面读回。清理只控制自有资源，何时关闭仍保有 RAM 样本的 mitmweb 要有明确决定。

交付分列：功能结果、HTTP 字段对比、工具/新轮结果、已知差异、未覆盖范围、恢复读回。历史 live-05 的结论是“限定推理 HTTP 边界通过”，不是完整 OAuth/refresh、自适应重试或直连 TLS 一致，更不是服务端不可区分。

## 三、REA 如何接入本流程

需要时加载当前安装的 `reverse-engineer-anything` 并发现真实工具 schema；不为抓本机 HTTP 强行引入 REA。

- 已有 HAR/SAZ/mitmproxy capture：`inspect_web_network_capture`，先 summary，再按需分页。先核数据可处理/保留范围，不能为喂工具另把本来只准 RAM 的抓包导出。
- pcap：按平台、tshark 依赖和当前能力选相应 capture 分析器。读取已有 pcap 不等开始现场采集。
- 浏览器/Electron 场景、Frida/LLDB/process capture：REA 有各自运行观察和采集能力，按其 `runtime-observation.md` 与当前 schema；不是通用 HTTPS 明文抓包器，也不自动提供 TLS hook 脚本。

更正早先过度概括：“REA 只分析不采集”不准确；应说部分网络工具只读已有记录，而另有浏览器与运行场景采集工具。这个 Kiro 成功案例实际用的是 mitmweb + OpenCLI，不是 REA。
