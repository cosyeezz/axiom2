# Kiro 企业登录请求失败：profile 修复与真实能力验收

## 结论

**本机不是“企业登录天然不能用”，而是企业账号缺少推理所需的 profile 解析。** 补上正式 `ListAvailableProfiles` 查询后，保留原账号、模型和既有推理实现，原先 HTTP400 的诊断请求成功；长会话、真实工具闭环、图片与取消恢复也已通过 Axiom 正式链路验证。

用户补充的 Windows 成功账号是 Google 社交登录，而本机实际为 `identity-center` 企业登录，且凭据没有 `profileArn`。两种登录路径不同，不能仅由 Windows 成功推断本机协议、账号授权或企业支持情况。

## 依据与因果边界

参考仓库：[`ZyphrZero/kiro.rs`](https://github.com/ZyphrZero/kiro.rs)，tag `v0.9.2`，commit `407707940242`：

- `src/kiro/model/credentials.rs:988` 附近明确说明：流式请求缺少 `profileArn` 会得到 HTTP400，示例消息为 `profileArn is required for this request.`。
- `src/kiro/token_manager.rs` 的 `list_available_profiles` 使用 AWS JSON 操作 `AmazonCodeWhispererService.ListAvailableProfiles` 发现真实账号 profile。
- 本机认证元数据：`oauth / identity-center / us-east-1`，access 当时有效，`profileArn` 缺失；未输出或保存 token、真实 ARN、认证响应正文。

本轮最小变量对照（同一隔离会话、同一 `claude-sonnet-5.5 / off`、同一诊断 prompt）：

| 阶段 | Run | 结果 |
|---|---|---|
| 修复前 | `cc5b4965-5cfc-4706-9392-714ccd7e5621` | HTTP400，ValidationException，未产生部分响应 |
| profile 修复后 | `da8ee126-8f45-442f-a5d2-83d680977af1` | completed，正确返回 `KIRO_OK=703`，无工具 |

没有重新登录、切换 Google 账号、伪造官方身份或更换模型；没有修改推理 endpoint、target、origin 或 UUID 的实现；ARN及对应区域由发现结果按既有路由逻辑决定，不声称抓包证明实际区域前后相同。**原400的具体响应正文没有被本轮安全投影捕获**，不能把参考项目中的示例消息冒充本次抓包原文。成功对照足以支持 profile 缺失是本次失败的关键因素，不宣称修复所有账号和所有400。

此前 UUIDv5 或桌面 target 候选不是本次修复依据；本轮没有恢复当前官方 CLI 的完整 caller→wire，也不把桌面静态差异当作已证根因。旧调查文档保留为历史，当前结果以本报告和新证据目录为准。

## 实现

- 新增 [`kiro-profile.ts`](../app/src/server/providers/kiro-profile.ts)：仅企业 `identity-center` 且缺少 ARN 时执行发现；已提供 ARN、social、BuilderID 不查询。
- 修改 [`kiro-chat.ts`](../app/src/server/providers/kiro-chat.ts)：消费一次性认证 ticket 后、构造推理请求前解析真实 profile。由该 ARN 决定原有服务区域路由。
- 固定 HTTPS AWS JSON endpoint，禁止重定向，不使用共享个人 ARN、BuilderID 占位 ARN、官方 UA 或机器指纹。
- authRegion 决定美/欧优先；只有显式空成功才尝试另一区域。最多20页，检测循环；严格验证 ARN；多个 profile 明确要求选择，不擅取第一项。
- 发现独立15秒 deadline、读取16KiB/1秒本地上限；失败不发送推理请求。外层等待可取消，即使注入 transport 不合作也不会无限阻塞请求。
- 内存缓存按 access 哈希、认证方式和区域隔离，最多128项，TTL不超过15分钟或 access 到期。不新增 token/profile 落盘。
- 新增 [`kiro-profile.test.ts`](../app/tests/kiro-profile.test.ts) 八项测试，涵盖操作契约、非企业跳过、区域回退、分页、多 profile 拒绝、无效响应、取消、凭据缓存隔离及失败关闭。
- 扩展 [`kiro-acceptance.mjs`](../app/scripts/kiro-acceptance.mjs)：本会话模型/思考切换、图片、inline附件、runId作用域取消、证据补采；截断字段使用 `message.part` 并检查长度、前缀和SHA。仅使用 receipt/run/input 归属，不把“最新完成的run”当作本次请求。

## 真实能力验收

全部请求通过 Axiom `/ws → prompt → agent worker → native kiro-chat`。普通隔离会话，不修改主会话或全局默认模型；写入仅限合成 fixture 目录。

| 能力 | 真实证据与结果 |
|---|---|
| 多轮与长期记忆 | 初始标记 `MATRIX-K3`、校验词“白鹭”、乘积703；跨工具、附件、图片、模型切换后均正确召回 |
| 长文本 | 两份合成 inline 附件各85,807 bytes，合计171,614 bytes；提取318/427、延迟召回与合计745正确 |
| 读取与工具失败恢复 | 实际read计算库存51；先ENOENT，再read账本成功，按消息顺序确认错误后继续 |
| 多工具与状态修改 | 两次read核对；write→edit→read；本地文件确认为marker/校验词/total56/verified=true |
| Bash | 实际bash只读计算 `17*23+6`，工具结果397，与最终答案相符 |
| 直接图片 | 图A识别 `N4P8`、红7蓝4绿9、总数20；prompt没有携带答案 |
| 工具返回图片 | 实际read图B，有工具图片元数据；识别 `R6W2`、红3蓝8绿5、总数16 |
| 无新图历史 | 回忆两图代码，A减B的总数差4、红色差4正确 |
| 思考等级 | Sonnet的off/low/medium/high/xhigh/max均有真实成功请求；high/max观察到思考文本长度元数据 |
| Unicode与JSON | 中文、引号、反斜杠路径、emoji的JSON解析正确 |
| 取消与恢复 | 观测到149个输出字符后带runId停止，`cancelled / USER_STOPPED`；下一轮完整召回长期标记、附件与两图信息 |
| Opus冒烟 | 同一长会话切换 `claude-opus-5.5`，历史、真实read、直接图片三项通过，最后切回Sonnet/off |

共 **33 个run：29 completed、2 cancelled、2 failed**。失败包含修复前HTTP400基线和不支持的minimal等级负例。共有 **11 个真实工具调用**，调用ID唯一且均匹配结果；不能以助手声称“已操作”代替工具和磁盘证据。

自动断言 **29条，27通过、2条严格断言未通过**，不能概括为全部严格断言通过：

1. `c20-checksum` 正确算出 `703+51+56+745=1555`，但在最终一行前多输出计算式；**语义通过、严格一行格式失败**。
2. `c21-cancel-scoped` 确实取消，但发生于输出前，不满足partial-stream断言；随后 `c24-cancel-after-output` 和 `c25-after-partial-cancel` 补测通过。

第一次取消驱动漏传runId，Axiom安全返回 `RUN_MISMATCH`，原run最终completed；此为验收驱动错误，已修正并在 [driver-notes.json](evidence/kiro-profile-fix-20261028/driver-notes.json) 保留脱敏错误对象，不归因于Kiro。最终取消证据保存了停止前文本前缀，**取消后消息投影未保留该部分助手正文**，因此不宣称部分正文持久化也已验收。

## 离线、构建与部署

- 六个相关测试文件共 **57/57，exit0**：profile、chat、native-compat、runtime、interrupted-history、images。
- `npx --no-install tsc -p tsconfig.server.json --noEmit`：exit0。
- 根目录 `npm run build`：exit0，仅Vite chunk-size提示。
- 按后台重启技能完整构建、预检，由独立控制器替换后台；状态verified，HTTP200、WS connected，并通过正式请求验证已生效。
- 验收驱动最终 `node --check`：exit0。补采两份大型附件的历史用户消息，`message.part` 长度/前缀/SHA检查成功，分别86,791与86,828个UTF-16代码单元；验证元数据见 [driver-notes.json](evidence/kiro-profile-fix-20261028/driver-notes.json)。
- 独立只读review另跑profile测试 **8/8，exit0**，未发现阻断本次验收的问题；不是全仓全平台测试结论。

## 已知边界

- Sonnet5.5的 `minimal` 在当前显式adaptive兼容配置中不支持，会本地拒绝；未静默降级，也不是本次上游400复发。
- 思考等级请求成功不等同证明供应商精确执行预算。off的一次工具轮仍观察到思考长度元数据，不能保证“off即服务完全无思考”。
- 多profile账号仍需明确选择，未实现选择UI，当前拒绝自动推理。空结果/权限不足账号不保证能用。
- 发现阶段15秒超时与HTTP401/429/5xx当前仍归通用本地/传输错误；细分诊断、并发发现合并、profile失效后的缓存清除是非阻断改进项。
- 本轮验证的是累计长会话与真实能力，不是最大1M窗口、自动压缩、超大图片、并发压力、所有目录模型、Google/BuilderID跨账号回归或计费验收。约52K token仅为Axiom上下文估算，非供应商账单。

完整脱敏证据、所有失败及复现方式见 [`docs/evidence/kiro-profile-fix-20261028/`](evidence/kiro-profile-fix-20261028/README.md)。
