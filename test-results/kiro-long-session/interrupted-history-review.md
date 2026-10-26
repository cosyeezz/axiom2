# Kiro interrupted tool history：安全恢复审查

结论：拟议方案可作为范围受限的 wire 兼容恢复；它不是“已证实取消”的识别算法。只在 user 边界删除未配对调用、保留配对内容，比直接套用 Pi 的补结果策略更符合当前“不伪造结果”的约束。仍需真实 Kiro 验证部分结果与 user 合并后服务接受情况。本审查未修改源码、测试、配置或运行中的矩阵。

## 故障与上下文证据

- `test-results/kiro-long-session/lifecycle-before-fix.json`：工具执行期取消，run 为 cancelled / USER_STOPPED；后续 run 为 failed / MODEL_ERROR，错误是“未完成的工具结果”。文件没有完整 native transcript，assistant stopReason=toolUse、无 toolResult 的具体历史来自任务背景，不能仅凭该 JSON 的 tools=[] 独立证明。
- `app/src/server/providers/kiro-chat-protocol.ts:72-75,99-100,129`：error/aborted assistant 跳过；新 assistant、user、历史末尾分别检查 pending。`kiro-chat.ts:95,135` 先构造请求再 fetch，故该错误确实在 fetch 前。
- `kiro-chat.ts:225-229`：模型流完整完成时写 toolUse；模型流自身取消才写 aborted。稍后工具执行期取消不会自动修改已结束的模型响应。
- `app/node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:752-765` 在 message_end 保存消息；`pi-agent-core/dist/agent-loop.js:325-332,398-403,449-458` 先结束 assistant，再执行和发布工具结果。正常取消路径可生成错误结果，但提前结束、未启动的其他调用或未落盘不能保证所有结果存在。未追查本次具体遗漏的进程终止根因。

## 是否已有更精确的取消标志

没有证实 provider 上下文已有可直接使用的历史取消标志。

- pi-ai 1.1.0 的 `dist/types.d.ts:561`，TranscriptContext 只有 messages；UserMessage 没有来源或取消字段；assistant 的 aborted 指模型响应取消，不能代表稍后的工具取消。
- `app/src/server/agent-worker.ts:961` 确实附加 axiomRunId；这是关联键，不是取消事实。`:1206-1225` 将运行结局发给宿主，未见将 USER_STOPPED 回填为历史 assistant 标记。
- `agent-worker.ts:711-741` 的 context/context_with_system 钩子未注入历史取消记录。`transcript.ts:209` 读取 native session，不查询 run 状态以补取消元数据。
- `pi-coding-agent/dist/core/messages.js:74-115` 将 custom、bashExecution、branchSummary、compactionSummary 转为 user。custom 的 details 不保留，provider 的 user 边界不等于真实用户新输入。不要用用户文本“取消”、时间戳、新请求 signal、stopReason=toolUse 或不同 runId 判定已取消。

若产品要求“仅已证实取消才恢复”，需要宿主基于持久化 run 状态，将取消 run 与活跃分支中 assistant/call ID 关联，通过明确受信通道传入；应支持进程重启与会话分支。仅凭当前协议函数不能完成这种严格策略，也不建议让 provider 直接访问全局业务数据库。

## 最小可靠方案

1. 在 user 分支、原 pending 抛错的位置做局部归一化；system 不触发恢复，toolResult 分支的名称/ID 验证不变。
2. 只操作本次构造的新 wire。保留当前工具批次所属 assistant 的对象引用或索引；不能假定 wire.at(-1) 是 assistant，因为部分 toolResult 已生成 user wire。也可按 pending ID 遍历已构造 assistant 的 toolUses，但不得修改源 transcript。
3. 仅过滤 pending.keys() 中的 toolUseId。已有配对 call、真实 result（包括 isError）、普通正文、图片、顺序全部保留。删除空 toolUses 属性；assistant 仅在正文为空且无 calls 时移除。thinking/signature 按既有独立策略处理，不升格为普通正文。
4. 确认过滤数量与 pending 对应后 clear pending；seenCalls 永不因此删除。重新取得 wire 尾部，按现有规则合并 user 正文/图片。全部调用删除且 assistant 为空时，前后 user 应正常合并；部分结果时，保留原 assistant 和 result user，然后合并新输入。
5. 末尾 pending、新的正常 assistant 跨 pending、孤立/迟到/重复 result、名称不符、重复 call ID、无效 ID/参数继续拒绝；无 user 边界不恢复。不补 success/error toolResult、不执行或重试工具。
6. 建议通过现有 diagnostics 通道报告省略调用数量/边界数量；不记录参数、工具输出或敏感 payload，不把它描述成“工具未执行”。

注意：现实现先跳过 error/aborted assistant，再检查 pending，因此“所有 assistant 跨 pending 都拒绝”并不是现状。需要明确保持该既有行为，还是收紧为包括被跳过的 assistant；至少固定测试。不能在修复说明中声称后者已成立。

## 风险与限制

- 缺失结果可能是取消、崩溃、落盘损坏、扩展插入消息；按 user 恢复会掩盖部分损坏。缺少可信标记时这是显式接受的兼容策略。
- 工具可能已产生副作用但未记录结果。删除 call 会减少模型对此次尝试的认知，用户后续要求可能引发重复操作；保留 seenCalls 只防重复 ID，不能防相同动作换新 ID。不能声称回滚、未执行或可安全重试。
- 保留普通正文可能留下“正在执行”等已过时描述，但整段删除会丢失合法信息；保持正文是合理最小损失选择。
- 未证明 Kiro 服务接受所有归一化形式。尤其部分成功结果与新 user 正文共存、删空 assistant 后 user 合并，需要 mock payload 断言和真实生命周期复测。

## Pi 标准 API 实现的实际参考

安装 `@earendil-works/pi-ai` 版本 1.1.0。`dist/api/transform-messages.js:125-207`：跳过 error/aborted assistant；在新 assistant、新 user、末尾为缺失结果生成 `isError:true`、正文 `No result provided`，已有结果 ID 不补；system 暂存直到结果之后。它没有验证业务取消事实。

调用点：anthropic-messages.js:863、openai-completions.js:897、openai-responses-shared.js:90、bedrock-converse-stream.js:758、google-shared.js:154、mistral-conversations.js:29。表明公共 API 适配层确实处理这种历史，不代表官方 Kiro 行为或本地 Kiro wire 等效。不要直接复用该转换器：它会补结果、改变 assistant/末尾边界政策，还有 thinking/ID/图片转换行为。

## 必须回归

1. 单调用无结果 → user：有正文保留；无正文删 assistant；前后 user 正确合并；不生成任何 result。
2. 多调用部分完成 → user：只删缺失 ID；保留成功/错误结果、工具名和参数、图片及顺序；结果与新 user 同处 currentMessage。
3. 多调用全部缺失；全部已配对（payload 不变）；多轮独立取消；连续 assistant 已合并正文的情况。
4. 被删除 ID 再出现在历史 call 和新服务返回的 toolUseEvent 时均拒绝；不得产生 toolcall_end 或执行。保留 ID 的现有断言参考 `app/tests/kiro-chat.test.ts:200`。
5. 末尾缺失、正常 assistant 跨 pending、孤立/重复/名称不符结果、user 后迟到结果、重复/非法 call ID 和非 object 参数均失败。
6. error/aborted assistant 自身携带 call 的跳过行为；pending → error/aborted assistant → user 的明确政策；system 在 call/result 间不误恢复。
7. 自定义提示/摘要被转换为 user 的案例：显式验证兼容政策；若引入可信标记，缺标记/错 run/错分支必须拒绝。
8. 原始 context 深冻结，连续构造两次 payload 相同，源历史不变；system、图片、thinking 隐私和工具声明不回归。
9. 真实生命周期：工具执行中取消后下一轮成功到达 fetch、保留用户上下文；重开 session 后同样恢复；多工具部分完成取消。统计工具实际执行次数，不能只断言模型回答成功。

## 已运行检查及未验证项

工作目录 `F:/Axiom/axiom2`。运行 PowerShell here-string 管道 `node --input-type=module`，直接 import 安装包的 transformMessages，检查缺一结果在 user/assistant/末尾三个边界均补一个错误结果、保留真实结果内容、跳过 aborted assistant。第一次 exit 1：审查脚本错误地断言结果对象引用不变，非产品失败（非视觉模型路径会复制结果对象）；改成 deepEqual 后 exit 0，四类断言通过。未保存脚本/日志，仅工具输出。

运行 `node app/skills/pi-development/scripts/documentation-paths.mjs` exit 0，定位 Pi 1.1.0，阅读 README 和 custom-provider 文档。读取/搜索均为静态检查，部分最初 rg 路径/Windows glob 错误后已用明确路径核实。

没有运行或重启真实矩阵，没有执行 Kiro 回归测试，没有验证拟议修改后的行为；源码尚未修改，报告给主代理用于实施和验证。