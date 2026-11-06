# CodeBuddy 跨模型历史续接修复

## 结论与范围

修复了 OpenAI Responses 历史切换到 Workbuddy / DeepSeek-V4.1-Flash/high 时的两个本地拒绝点：`thinkingSignature` 被无条件拒绝，以及 SDK 的 `call_id|item_id` 被当作非法工具 ID。先核官方 CLI 2.179.0，再修改最小原生投影；不采用会跳过错误历史或合成工具结果的整套 Pi `transformMessages`。

- [薄适配](../../../app/src/server/providers/codebuddy-chat.ts)：不再因存在私有 `thinkingSignature` 而拒绝。只发送可读 thinking，仍拒绝 redacted、namespace、argumentsError。
- [原生构造](../../../app/src/native-providers/codebuddy/request.ts)：工具内容 ID 单独允许 `|`，原样保留并严格配对/去重，不截断、不拆分或规范化；协议身份/header 校验不变。空 thinking 不产生 reasoning，完全空 assistant 按 CLI 省略。
- 可读 reasoning 留在 `reasoning_content`，不混入普通答案；调用方 system/history/tools/security 保留，源消息不突变，不造缺失结果。

[官方切片](CLI-SLICES.md)支持 chat reasoning 文本投影、原 callId 配对及空 assistant 清理。Responses 专用 ID 规范化不属于 CN chat 依据。原始 bundle 2.179.0 SHA256 `dfba8dc057a592d1428ed2db9554aa3d5640674c9e98d794f1cce1783be5afa8`，静态版本核验沿用[初轮证据](../codebuddy-repair-20261106-01/CLI-STATIC.md)。未执行 CLI、读取其凭据或让它代发。

## 验证分层

### 源码与离线闭包

- 修前两项跨模型红测；修后签名/复合 ID 主路径通过。第二项最初的“规范化 ID”断言在官方证据取得后更正为“原样配对”，不能把旧断言当 CLI 要求。
- 整个 `codebuddy-*.test.ts` 与 `session-retry-policy.test.ts`：106 pass、0 fail/skip/cancel。日志 `/tmp/axiom-codebuddy-offline.sFqdCz/tests.log`。
- 首次 build 因新增孤儿 fixture 用 string content 而不是 SDK 文本块数组报 TS2322；已修，并使重复/aborted/error/length 负例都带合法结果，避免因缺结果而假通过，另补身份 header 含 `|` 必拒绝。
- 最终仅重跑变更的跨模型/图片测试文件：11 pass、0 fail/skip/cancel，exit0；其他不变已过检查未重复。`npm run build` exit0，`tsc --noEmit`、Vite、server TypeScript 均通过，仅 chunk 体积警告。日志 `/tmp/axiom-codebuddy-recheck.Askkt1/{tests.log,build.log,status.txt}`。
- [跨模型夹具](../../../app/tests/codebuddy-cross-provider.test.ts)覆盖可读正文/思考、opaque 不入 body、空 assistant、同前缀不同复合 ID、防重复/孤儿/中断修复、redacted/namespace/参数错误拒绝、输入不变。
- [真实 SDK / Node HTTP 测试](../../../app/tests/codebuddy-native-sdk.test.ts)使用实际 Agent/ModelRuntime，加入外源签名/复合工具历史，最终本地 socket 验证签名不出站、reasoning 与完整 ID 保留、新工具执行及续接仍通过。这是 loopback，不是上游/TLS 证明。

### 原失败会话实际上下文，仅内存离线

[脚本](../../../artifacts/codebuddy-cross-model-20261106-01/offline-original-history.mjs)用 Pi 1.4.0 `buildSessionContext(entries, failedEntry.parentId)` 加正常 `convertToLlm`，应用真实 branch/compaction/custom 转译，保留记录的 system/tools/security。结果见[白名单报告](../../../artifacts/codebuddy-cross-model-20261106-01/offline-history-report.json)：116 messages、50 assistant、25 signed-thinking、61 复合工具 ID、1 system；1 次 synthetic fetch、**0 上游请求**，opaque 不入 wire、61 对完整 ID 保留、源不变、stop。

早期 393-message/99-signature/224-ID 是原始 JSONL 盘点，不是 Pi 模型可见上下文；不能据此宣称 393 条实际上下文已验。验证脚本最初错误导出、flatten 计数及未转译自定义角色的失败是脚本方法错误，改用实际 runtime 投影后通过，不是额外产品故障。真实上下文/签名/构造体未落调试证据，也未向用户主会话发送测试 prompt。

### 构建与正式服务

正式4317由独立重启器 verified，2026-11-06T17:56:02+0800，PID4787→20276，HTTP200/WS connected。状态：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-sb4af9ui/status.json`。[部署证据](../../../artifacts/codebuddy-cross-model-20261106-01/runtime-proof.json)冻结6个生产模块 SHA/mtime，server及2个观察到的worker均晚于构建、parent为20276；这是基于产物指纹、进程时序及父子关系的间接加载证据，不是逐模块运行时追踪，不沿用旧PID。[最终只读核验](../../../artifacts/codebuddy-cross-model-20261106-01/final-check-report.json) exit0：6模块及mtime未变、4317仍PID20276/HTTP200、1个已耗尽claim、旧UI runner禁用、无活动live runner；未调用模型。

### 有界真实上游

按[新合同](CASE-CONTRACT.md)，生产 SDK + 合成外源历史 → DeepSeek/high 单次实发 **PASS**。见[runner](../../../artifacts/codebuddy-cross-model-20261106-01/live-native-history.mjs)及[白名单报告](../../../artifacts/codebuddy-cross-model-20261106-01/native-live-03-report.json)：1 payload、1 HTTP200、15 text delta、stop、205 thinking chars，正确回忆代号/原数/计算/fixture。可读 reasoning/历史答案/结果准确保留，opaque 不出站，复合 ID 原样配对，输入不变。耗时1060ms，0 新工具调用/执行，无session/global default变更，正常认证、临时所选模型profile已删除；唯一claim `03-native-foreign-history`已耗尽，禁止重跑。

两次前置脚本门禁失败均发生于claim/model invocation之前：第一次猜错模型目录；第二次错误地把SDK聚合的advisory availability视为请求门禁。固定分类报告保留，0 payload/response，无已耗尽claim重用。最终按正式worker的selected-provider snapshot及`invalidModelDefinition`做无凭据定义校验，允许只读availability warning存在，真实请求正常成功；未因此改动产品实现。这个单次SDK检查不同于精确 GPT-6.1 Sol Fast → Workbuddy 的双轮 UI 验收，也不是原116条实际上下文全量上游实发。

旧双轮 UI 计划未执行、0 claims/0 prompts；因独立审查发现全局默认条件恢复非原子、工具只软约束及源模型 retry/deadline 门禁不闭合，已禁用 runner，保留[原计划](UI-PLAN-NOT-EXECUTED.md)。不为测试额外修改生产权限或全局重试设置。

## 八准则逐项核对

| 准则 | 当前证据与边界 |
|---|---|
| 1 只发 CLI 字段 | 已证本次投影白名单：可读 reasoning、正常消息/工具字段，无私有 thinkingSignature；合成 SDK/最终 loopback 覆盖。不声明所有认证/目录 wire 已验。 |
| 2 字段值同源 | 已证 CLI2.179.0 reasoning/callId/空 assistant 静态依据；此前 UA/UUIDv7 保持不变。不是全部动态账号/恢复值等价。 |
| 3 无额外本地身份 | 已证不放宽身份 header，仅工具内容 ID 允许复合符；caller 原路径/system/tools/security 不删改。已知测试差异：harness把合成fixture的本机绝对路径作为工具历史内容发送，不是协议identity注入，但确实披露了测试工作区路径；不声称完全无本地信息，未来合成case应使用虚拟路径。 |
| 4 验实际请求 | 已证实际 SDK→原生 sender→本地 Node HTTP 的最终请求白名单/签名与配对；真实上游仅按新合同验证，不声称真实 TLS wire 比对。认证/目录最终 wire 未新增验证。 |
| 5 行为同 CLI | 本次 reasoning/ID/空 assistant 投影已据静态证据修正；严格配对、不造结果、zero-replay 保持。已知差异：redacted不支持，工具ID仍有原字符与160长度边界；完整恢复/所有事件未对齐。 |
| 6 不伪造 | 已证未读取/复制 CLI 账户凭据、未伪造账号/profile/签名；测试的 opaque 是显式合成且保证不发送。正常 SDK 认证不回显。 |
| 7 不夸大 | 只称限定范围功能修复；源码、build、loopback、原历史离线、正式加载及有界上游分别列出。精确源UI、原全历史live、图片跨模型、TLS/keepalive/refresh/完整恢复未验。 |
| 8 证据白名单 | 已证调试落盘仅计数/布尔/固定分类/状态和模块指纹；真实历史、签名、body/headers/响应留RAM或正常应用历史，未保存敏感原文hash。 |

## 使用与限制

正式后台已加载修复。用户原会话不需要删除历史或清空上下文。原主会话从未自动重发；是否继续提问由用户决定。当前修复尚未另行 commit/push；之前 `f54ec165` 的提交推送仅覆盖初轮图片/身份修复。
