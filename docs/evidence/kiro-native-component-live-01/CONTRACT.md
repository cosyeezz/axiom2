# Kiro 独立组件真实 Pi 验收 01

用户在离线交付后要求“真实测试”。本 case 验证新构建的独立组件经 Axiom ModelRuntime 注册及 Pi Agent，使用现有 Axiom OAuth 账号，能否完成只读工具闭环和下一轮文本。不是 4317 UI 部署验收，也不是新的 MITM、官方采集或完整 TLS/wire parity。

## 固定范围

- 入口：独立 Node 22 进程 → `app/dist/server/model-runtime.js` → Pi 薄适配 → `app/dist/native-providers/kiro/` → 原生 HTTP；版本/非敏感代码指纹见 baseline。
- 固定 `kiro / deepseek-3.2 / off`，现有合法 Axiom OAuth/account/profile。禁止 CLI/Keychain 凭据复制、CLI/ACP 代发、模型 fallback 或新兼容代理。
- 使用 Pi Agent 自有完整 system/custom/history/tool context；不是复制用户当前会话。唯一工具 `read_component_fixture`，只可读取本目录 `FIXTURE.txt`，路径参数固定 `fixture`，宿主执行一次。
- 第一次 prompt 要求调用工具并原样返回 fixture；第二次不调用工具，依赖历史返回 fixture 加固定后缀。完整成功终态、工具 call/result ID 配对、结果回传、历史保留、同轮 continuation 不变/新轮改变、conversation/root 不变必须全部成立。
- 使用真实 Axiom ModelRuntime 正常账号路由/刷新 owner；不另复制凭据、不另增刷新 owner。允许正常凭据刷新写回原认证存储，调试证据不含凭据。
- 只读预检发现用户默认为其他模型、Kiro 代理为 direct；均保留。不启动/重启/修改 4317 或 4319，不改数据库、models/settings、全局 CA/代理/防火墙。网络配置仅由现有 `configureModelNetwork` 在自有测试子进程应用当前设置。

## 有界预算与门禁

| 项目 | 上限 |
|---|---|
| 真实 semantic prompt | 2，第二轮仅第一轮完全成功后允许 |
| 物理模型请求 | 总计 3；首轮最多2，次轮最多1，发送前强制检查 |
| 自动标题/摘要/缓存预热/宿主重试 | 0；使用无 AgentSession 的 Pi Agent，不安装 Axiom session retry |
| OAuth 刷新 | 最多1次，正常认证客户端；首错停止 |
| profile 准备请求 | 最多1次，原生目标检查；目录网络请求0 |
| 工具执行 | 1；无任意文件读取/写入/命令执行工具 |
| 总执行时间 | 150秒；每模型请求60秒；清理最多10秒 |
| 内存/响应/事件 | Node heap 256MiB；单请求体≤1MiB；每响应≤2MiB；Agent事件≤10000；文本累计≤8192字符 |
| 输出证据 | 白名单谓词、计数、状态、合成marker、非敏感UUID、公开版本、代码SHA；单JSON≤32KiB |
| 隐私/发送重试 | optout=true，原生1max1不变；不实施旧重试设计 |

新 harness 不得 import 时连接/发请求。先通过合成 transport 的完整 Agent 三请求流程、超预算拒绝、错误终态不执行工具、取消与白名单检查。运行时模型/账号元数据预检必须零网络；未通过不创建 live claim。

真实调用前以 `wx` 创建唯一 `live.claim`；claim 在任何失败/超时/收件不明后仍耗尽，不覆盖/删除/自动重放。baseline、preflight/selftest 通过后才能执行 `--live`。失败则取消自有 Agent/请求并等待 settled；禁止后续 prompt、fallback、重采旧 live01～06。修正代码后如需实发，必须另建 case 合同与 claim。

## 观察与保存

发送门禁包装真正 `kiroNativeFetch`，不替换 generic Fetch、目标 URL、认证或请求体；只在 RAM 解析请求生成关系布尔/计数。响应仅在 RAM 流式转交正常 parser；不记录原始头、上下文、响应、未知错误及其 hash。只记录固定本地失败阶段/代码；HTTP 状态和 native protocol 固定码可白名单化。

现有配置只在 RAM 比较前后是否一致，不保存其全文或 hash。静态代码/测试源码指纹不含真实凭据。不得执行旧 HARNESS、复用旧 claim 或改变旧离线 case。

完成后核：3请求/2完整文本终态/1工具、工具结果配对、真实sender身份、continuation/history、无活动响应、Agent settled、dispatcher关闭、进程退出、默认与代理读回未改。清理未证明须明确失败或限制，不以 exit0 代替验收。负例均合成，不增加真实请求。

## 当前门禁状态

合同已冻结为本次准备范围；执行前须另保存 baseline、预检与自测结果。尚未实发。结果见本目录最终 REPORT（完成后创建）。
