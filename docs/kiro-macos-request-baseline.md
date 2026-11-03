# Kiro Mac 请求一致性基线

## 当前范围

用户最新明确：只核对 **请求构造、请求认证、实际发送** 的高度一致性及其执行链路，不复刻 Kiro 的压缩、会话存储、内部调度等机制。

此范围说明取代此前把完整 Mac M3 监督契约当作请求对照前置的安排。原 [Mac 交接规格](kiro-macos-handoff.md) 及[既有证据](evidence/kiro-macos-native-02/)保留为历史和技术参考；其中完整进程树、coalition、launchd、不可逃逸后代的研究不再继续，也不是本轮请求验收项。一般性的隐私、隔离、限时限额和观察保真要求仍然保留。

## 参照端与当前证据

- **最终参照**：Mac 官方 Kiro 实际使用的发送路径和实际发出的请求。Axiom/Pi 用自己的原生实现对齐，不通过 CLI/ACP 桥接代发。
- **已分析的冻结产物**：Kiro CLI 2.35.2，Mac ARM64；其静态地址/代码结论不能直接用于后续版本。**当前安装已绑定为 2.36.0/build20261029.233307**，两公开可执行文件完整 SHA 和 Apple/Team 签名通过；普通权限下 help、一次 list 的 direct-child exit0/双EOF 已实测，见[当前普通入口报告](evidence/kiro-macos-native-02/natural-entry-metadata-03/SUMMARY.md)。这不是实际模型 sender 或原子 loaded-image 证明。
- **已确认的设置**：stored `chat.agentEngine=v3`。不能据此声称本次 session 的实际 sender、API 或实验分支已确定。
- **静态候选**：提取的 public KAS 源包含默认 `GenerateAssistantResponse`（`POST /generateAssistantResponse`）与实验选择的 `create_response`（`POST /v1/responses`）路径，传输候选为 Node HTTP/1.1。它们不是已经观察到的真实请求，不应任选其一改动 Axiom。
- **模型**：精确 `deepseek-3.2`。实时可用性尚未证明；不可用必须报告，不能静默换模。
- **真实采集状态**：官方/Axiom 的目标模型实发对照样本仍为 0。新目录诊断未提交生成 prompt，未观测实际 HTTP/模型请求次数（unknown），不能把命令意图写成实测零网络。目录原文未保存或解析，精确模型可用性仍未知；未因静态候选修改生产 provider。

## 三项对照

| 环节 | 需要核对 | 不需要复刻 |
| --- | --- | --- |
| 请求构造 | 同一受控输入到最终 payload 的字段、类型、嵌套、可选项、序列化、必要的顺序，以及模型和上下文内容 | 压缩算法、会话数据库、内部对象和调度方式 |
| 请求认证 | 实际认证模式、必要的获取及刷新链路、scope、region/profile 选择、认证头注入与使用方式 | 本地凭据存储结构、CLI 内部登录状态机；不复制 CLI 凭据供 Axiom 使用 |
| 实际发送 | URL、method、path、header 和 SDK 自动补项、实际序列化 body、HTTP/流式传输，以及影响请求的重试、取消、代理和连接行为 | 不影响请求的内部功能；不逆向整个操作系统监督体系 |

`system/custom/history/tools/security` 等上下文只作为请求输入及最终 payload 核对，不研究它们如何在本地保存、压缩或编排，也不能通过删减它们制造一致。

Token、请求 ID 等天然动态值不要求字面相同；必须分别记录其差异和应满足的格式、作用域、关联及使用规则，不能用“归一化”掩盖实质差异。观察记录不得持久化原始 token、Authorization secret、Keychain secret 或真实 TLS session keys。

## 执行和证据边界

1. 最小确认实际版本及 sender/API 路径，只追踪与构造、认证、发送直接相关的分支，不再追完整配置优先级或内部会话机制。
2. 在任何真实请求采集前，准备脱敏且限定范围的观察方案，验证其不改变请求 API 的参数、返回、回调及异常行为，明确次数、预算、超时和输出上限。已有 fake-only HTTP fixture 不能通过改标签直接用于真实认证流量。
3. 用相同的受控输入、账号条件、模型和相关配置，分别取得官方与 Axiom 的真实请求证据，再决定是否存在需要修改的差异。
4. 区分静态构造候选、观察点看到的数据、实际出站和服务器接收。HTTP 200、相同回答、mock、TCP 归属或单独 pcap 不是请求一致性的充分证据。

不关闭 SIP、不重签官方目标、不改全局 CA/代理/防火墙，不操作无关进程或服务。停止的 M3 分支不是恢复或执行任何 coalition/service 控制调用的授权。

## 当前交付与下一步

本文件固定请求级验收边界，**不是请求一致性已通过的报告**。后续工作只围绕实际发送路径、认证与 payload/transport 对照推进；完整内部机制研究和相关交付审计停止，原结果保留。
