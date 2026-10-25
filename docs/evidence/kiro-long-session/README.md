# Kiro：AXIOM 连续长会话实测与修复

真实模型请求仅经过 `/ws → 登记任务 → agent worker → kiro-chat`，不以直连 API、官方 CLI 或离线夹具代替。主会话和默认子任务的模型选择未改变。

**本次运行已停止，不是“8 型号各 20 轮全部通过”。** auto 在初试完成 20 轮；其余 7 型号的受控恢复记录了 **137 / 140 轮，其中 136 completed**。Sonnet 第 17 轮 HTTP 429，冷却约 8 分钟后的唯一新增输入仍然 429，剩余 3 个计划输入未发送。上游限流与额度不足无法区分，不再自主追加模型请求。

协议完成、严格语义/工具断言和整轮输出格式分开报告；断言失败也不一概归因模型。

## 档案与计数边界

| 档案 | 内容 | 不能推导的结论 |
| --- | --- | --- |
| [初试](initial-attempt.json) | 8 型号、58 落盘轮，52 completed、6 HTTP 429 | 不代表 8 × 20 完成 |
| [初试 MiniMax 2.1 第 8 轮补充](initial-minimax-m2.1-turn08-supplement.json) | 原 run 的独立只读观察 | 不回填原 7 轮 state，不伪造 runner 退出码，不计入 58 或 137 |
| [受控恢复](controlled-recovery.json) | 独立 attempt，7 型号、137 轮 | `complete=false`，不是 140 轮通过 |
| [串行 attempt 边界](serial-attempts.json) | v2 准备锁失败、v3 续测与实际退出码 | controller/driver/curator exit 0 不等于能力全部通过 |
| [Sonnet 限流后续](sonnet-post429.json) | 1 条新持久输入失败、0 工具调用 | 不与原第 17 轮合并或替代；不算恢复的第 138 轮 |
| [断言归因](assertion-audit.json) | 21 项原始失败的离线分类 | 诊断性类型归一化不产生新的计分通过 |
| [Qwen 完整参数补采](qwen-tool-input-supplement.json) | 原第 10 轮只读补采 2 个截断 input，检查全部 6 calls | 不是新模型轮，不修改原 7 项失败 |
| [终态快照](runtime-checks.json) | 两次终态 gate、8 专用任务、默认配置及历史冻结 hash | 不是后来修改的发布脚本又跑过真实矩阵 |
| [生命周期](lifecycle.json)、[REA](rea.json) | 取消/续聊/reload 及静态对照的白名单证据 | 不证明工具无副作用或与官方全策略等效 |
| [当前离线验证](verification-v3.json) | 命令、实际退出码、覆盖范围及最终发布文件 SHA-256 | 不将 mock/unit/build 当真实模型验证 |
| [EOF 清理前快照](verification-v2.json) | 保留终审修复后的 32 文件快照与 63 项回归 | 测试文件 EOF 空行随后清理；不改历史结果 |
| [终审前快照](verification.json) | 保留终审加固前的离线结果与 31 文件快照 | 已被当前清单替代，不代表最终发布字节 |

各 attempt 保留原失败；只合并明确属于受控恢复的型号状态。不同档案中的矩阵 run 去重，Qwen 事后观察明确引用已经计数的原 run。

## 初试：8 型号，保留原失败

52 项已执行检查中 48 通过、4 失败；6 个协议失败轮没有语义检查。v1 没有独立逐轮格式观察，不能声称格式全过。

| 型号 | 落盘 | completed | 检查通过 / 已查 | 边界 |
| --- | ---: | ---: | ---: | --- |
| auto | 20 | 20 | 20 / 20 | 含用户图、工具返回图和历史图追问 |
| claude-sonnet-4.5 | 16 | 15 | 15 / 15 | medium 第 16 轮 429 |
| claude-haiku-4.5 | 1 | 0 | 0 / 0 | 首轮 429 |
| deepseek-3.2 | 11 | 10 | 10 / 10 | 第 11 轮 429 |
| minimax-m2.5 | 1 | 0 | 0 / 0 | 首轮 429 |
| minimax-m2.1 | 7 | 7 | 3 / 7 | runner 被执行预算中断，无可靠正常退出码 |
| glm-5 | 1 | 0 | 0 / 0 | 首轮 429 |
| qwen3-coder-next | 1 | 0 | 0 / 0 | 首轮 429 |

MiniMax 2.1 第 8 轮另行验证 completed、唯一持久输入与实际 user 全文、两次真实 read 的配对/顺序/CSV 及 ledger 数值，采用原 v1 规则。原 state SHA-256 未变。初次补采脚本的中文经 PowerShell ASCII 管道损坏导致观察失败；改用 UTF-8 源文件后通过，失败件保留。

## 受控恢复：137 轮，不补写缺失尾轮

沿用各型号原专用子会话并保留历史，不冒充全新空上下文。每型号一遍，用户 prompt 间隔 30 秒、型号间隔 90 秒；不改全局预算。模型选择前先确认任务、队列、持久输入及 fixture；用临时不兼容 profile 冷 reload 淘汰旧 worker，并验证模型消息 ID 未变。

| 型号 | 落盘 | completed | 严格检查通过 / 已查 | 整轮格式通过 / 已查 | driver exit |
| --- | ---: | ---: | ---: | ---: | ---: |
| minimax-m2.1 | 20 | 20 | 17 / 20 | 4 / 20 | 1 |
| claude-haiku-4.5 | 20 | 20 | 20 / 20 | 4 / 20 | 0 |
| minimax-m2.5 | 20 | 20 | 15 / 20 | 4 / 20 | 1 |
| glm-5 | 20 | 20 | 18 / 20 | 4 / 20 | 1 |
| qwen3-coder-next | 20 | 20 | 13 / 20 | 20 / 20 | 1 |
| deepseek-3.2 | 20 | 20 | 17 / 20 | 3 / 20 | 1 |
| claude-sonnet-4.5 | 17 | 16 | 15 / 16 | 0 / 16 | 1 |
| **合计** | **137** | **136** | **115 / 136** | **39 / 136** | — |

严格格式的对象是**本轮所有 assistant 正文的拼接**，不只是最后一条回复；工具前说明也会违反纯 JSON 约束。格式失败不等于最终 JSON 数值错误。种子与 checksum 为单行规则，第 17 轮为 `RECOVERED_JSON` 加 JSON，其余为 JSON-only。

每轮按 `receipt.inputId → 唯一 user.inputIds → runId` 关联，检查实际完整 user 文本包含发送的 prompt；不以“最新 run”或相同答案 hash 猜归属。curator 复核保存的身份关系与 driver 全文匹配事实，不声称又实时读过全部原文。

### 原始 21 项失败的分类

[归因档案](assertion-audit.json)保留全部原分数，各项仅做独立诊断：

- **8 项数字字符串类型歧义**：GLM 第 6/7 轮、Qwen 第 6/7/15/19 轮、DeepSeek 第 6/7 轮。数值提取/回忆正确，只将 `ARCHIVE_VALUE` 从数字字符串改成 number 后，原其他必需字段均通过；原提示未完全明确 JSON 数值类型，不能直接称事实或记忆错误。
- **MiniMax 2.1 第 5 轮**：multiplication 是正确结果的算式字符串而非 number；同属类型约定不充分，原失败仍保留。
- **MiniMax 2.5 第 20 轮**：正确的单行 JSON checksum 1555 被裸文本正则拒绝；原提示未明确禁止 JSON，是 validator 假阴性。
- **Sonnet 第 1 轮**：三个种子值可见，但整轮未匹配裸文本规则。种子提示本身已包含 703，因此此轮不作为独立乘法推理正确性证据。
- **4 项可见中文损坏**：两款 MiniMax 的第 10/17 轮真实 read 结果包含 U+FFFD，校验词错误；第 17 轮读取同一问题文件。不能仅据此确定损坏发生于哪一编码层，未独立检验磁盘 bytes。
- **4 项真实数值偏差**：MiniMax 2.5 第 14 轮 difference 647（应 652）；Qwen 第 14 轮 683（应 652）、第 20 轮 1866（应 1555）；DeepSeek 第 20 轮 1503（应 1555）。
- **MiniMax 2.5 第 13 轮**：仅 callback/初值片段，缺少所要求的完整 reduce 调用。只做静态检查，未执行模型生成代码；历史受控提示已给出“初值 0”这一核心修复，不能把此题计为独立代码修复推理成功。
- **Qwen 第 10 轮**：原 harness 只保存了 512 字符工具参数预览；另有“取第一条写/读”不能识别同轮真实修复的检查缺陷。补采验证全部 6 calls 的消息归属、长度、prefix、revision、结果配对与顺序；新规则验证最终 read 正确及之前成功写入，事后通过。旧规则在仅补全参数后仍失败，原 state/分数不改。

### 两次停止边界

v2 在 MiniMax 2.5 准备阶段遇 `RELOAD_BUSY`，当时该型号 0 prompt、0 模型轮。reload completed 事件可能早于 finally 释放锁。终态检查后，仅对**明确在 mutation 前被拒绝**的模型选择操作增加最多 40 次、间隔 250ms 的等待；prompt、未知错误和传输/receipt 超时不重试。已完成的两型号未重测，剩余五型号使用新目录/tag。

v3 自然结束时 Sonnet 第 17 轮已完成两次真实工具调用及结果，但随后 429；第 18–20 轮未发。冷却约 8 分钟后新输入明确禁止工具，仅请求基于已有结果续答；再次 429，0 calls/0 results，立即停止。**1 条新持久输入不等于 1 次 HTTP 请求**：AXIOM 自身记录了有界内部重试，最终 attempt 3 / maxAttempts 3 exhausted；driver 没有重发旧输入或工具。

两次 owner 自然退出后均验证 6 个冻结 hash、8 个专用任务终态、队列 0、持久输入均 delivered、reload 终态和默认配置不变，然后才解冻源码进行后续 harness 修改。

## 覆盖与未覆盖

20 轮序列覆盖文本、跨轮逻辑、真实 read、ENOENT 恢复、双 read、PowerShell 写后读、受控 throw 恢复、两份各约 82 KB 合成附件的提取/远距离回忆、会话状态更新、Unicode/JSON 转义和 checksum。

只有目录声明支持图片的 auto、Sonnet、Haiku 使用用户图、工具返回图及无新图的历史追问；其他型号用文本/代码替代，**不计图片能力通过**。Sonnet/Haiku 同一子会话依次 high、off、minimal、low、medium、high，并检查实际 run selection；Sonnet 恢复未走到最后 high 尾轮。

矩阵为 `MATRIX-K3 / 白鹭 / 703`，磁盘库存 51、会话更新后 56、附件值 318 和 427。原 Sonnet 复现会话是另一组 `ORBIT-K7 / 青鹭`，不得混用。工具写入仅在专用测试 workspace。

不涵盖最大上下文窗口、极限请求大小、计费、任意网络条件、任意时长或所有工具副作用。HTTP 429 不证明型号不支持能力。原 Sonnet 曾要求不存在的 codemode 工具、初试星期 substring 曾误拒英文，以及前轮禁工具作用域不清，均属于需保留的验收前提问题。

## 已修复的集成缺陷

### 隐藏思考不再降级为普通正文

旧实现把历史 thinking 包装成普通 assistant 正文，Sonnet 后续轮曾模仿该包装。新实现只从远端正文省略隐藏思考，保留本地 thinking、普通答案、用户内容、图片及配对工具；不猜 opaque/signature 回放，不正则清洗普通正文中的同名标签。

原专项 34/34 包括 24 轮 Agent 等级切换、30 次 mock wire 和 6 次夹具工具，不算额外真实模型轮。真实修复后 Sonnet high run `a43329b8-d5e9-46b5-a131-9b39506ba8b3` 保留原上下文且无包装，同一原生响应具有新诊断、本地 thinking 与 provider budget，证明当时 worker 加载修复；build、普通 reload 或磁盘 hash 单独不构成该证明。

### 执行工具时取消后可续聊

复现时 phase=executing_tools，原生 assistant 已定稿 PowerShell Start-Sleep 调用；精确取消后，下一轮因历史无结果 toolUse 在 fetch 前失败。没有独立 OS 进程启动 marker，不能据此证明 shell 已启动或没有副作用。

修复仅在**下一条归一化 role:user 边界**从 wire 省略仍未配对的调用，不伪造结果、不改本地 transcript。user 可能由真人、合成输入或 custom/摘要转换产生，策略不验证其来源或取消事实；error/aborted assistant 先整体跳过，system 不构成边界，其他跨 pending 的 assistant、尾 pending、迟到/孤立结果和重复 ID 仍拒绝。详见[历史策略](../../kiro-thinking.md)。省略不等于可安全重试工具。

[真实生命周期](lifecycle.json)为 Sonnet medium：

1. `f79aa6b7-dfe6-4fa4-bb6d-c4ee6251e5f9` 在上述 phase/调用条件下取消；
2. `0b84d7fd-0c0d-46d1-943f-4958724aece2` 续聊 completed；
3. reload `af1db693-7661-44ef-a322-604d020ab7c2` completed；
4. `c1d6aefb-a5d9-4189-9a04-1d316e66d14b` 重载后 completed，上下文正确、默认不变。

native proof 严格绑定最后 run、AXIOM message `95850c94-930f-4e6f-9bdc-20aa77be73c6` 和答案 SHA-256，唯一选中 entry `dfcab121`：thinking block 1、budget 16000、reasoning omission 9、unpaired-call omission 2、无包装。未从其他消息借诊断。公开 JSON 去除 session UUID、transcript basename，只留该 selected record。

### Harness 的完整参数、可移植性与防覆盖

`agent.original` 是 bounded projection，不是所有工具输入全文。现通过 `message.part({id, field:'input', callId})` 只读补全被截断 input，验证长度、原 prefix、detail/projection SHA-256 与消息/call 归属；失败记录观察错误，不重放模型请求。第 10 轮检查使用最终 read，允许中间真实失败与修复，但不能让早期正确 read 掩盖最后损坏结果。

workspace/parent/task 不再有真实身份默认值；已有 state 身份优先，显式冲突连接前拒绝。驱动与导出器拒绝所有未知、重复、缺值或把后继 flag 当值的选项；`send` 必须且只能提供 text 或 prompt-file 之一，错误参数在连接或读写状态前失败。fixture/cwd 可配置，证据导出与 native proof 使用 `wx`；lifecycle 在任何连接前独占预留新的 attempt 输出。

未来受控提示明确 JSON number 类型及 checksum 裸文本规则，不添加数值答案，并去掉代码题提示中的“补初值 0”。当前受控代码题用 TypeScript AST 静态检查所要求的完整最小 sum/reduce 形态、初值和 callback；不执行生成源码，也不是通用程序正确性证明。写读题额外识别带完整引用路径参数的受支持写入请求，拒绝只显示路径/命令的字符串、注释及错误目标；仍只关联请求、completed 工具结果及之后的最终 read，**不证明复杂 PowerShell 控制流实际经过写语句，也不提供独立 OS 文件写入 trace**。

**发布版与历史执行版不同**：终态 gate 后才实施身份脱敏、全文参数补采、写读顺序验收、可移植路径、提示澄清、防覆盖及终审静态检查加固；交付树还保留上游 timeout/keepAlive 改动。Qwen 补采的 `sourceHashes.publishedPlan`（83e695…）是当时观察规则的快照，早于最后提示与静态检查加固。原执行 hash、分数和 21 项失败均不改；当前发布 hash 见新版验证清单，旧清单单独保留。未用当前完整发布树重新跑真实矩阵，不将离线回归冒充该事实。

## 回归与 REA 边界

历史隔离交付基线：11 个 Kiro 文件 146/146；兼容 5 文件共 41 项，35 通过、6 个 Linux-only 跳过、0 失败。后续取消/导出器 34/34（16+18），取消/native-proof 26/26（16+10）；与前述计数有重叠，不能相加。最新 plan/配置/CLI 安全测试、完整 build、syntax 的实际结果见[验证清单](verification-v3.json)。完整应用 build 发生在终审脚本加固之前；之后仅修改 opt-in 脚本和测试，另验受影响的测试、类型及语法，不冒称重新构建运行中的 worker。未变范围不无故重跑，受影响范围在修改后另验；Windows 跳过项不代表 Linux 已验。

[REA](rea.json)对照本机 Kiro CLI 2.12.0，528,630,968 bytes，SHA-256 `0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a`。REA 6.8.0 / Ghidra 12.1.4 四次静态切片 exit 0，未运行官方 CLI/模型请求，未重新验签。确认 reasoning text/signature/redacted 分离转换及 serializer 可省略 reasoningContent/signature；不等于官方始终丢弃或 AXIOM 完全等效。响应持久化到档位清理未闭环，带坏指令警告的伪码不作策略证据，不发布完整反编译或派生 PE。

## 复现入口与安全前提

以下是后续独立 attempt 的 opt-in 示例，不用于覆盖本次失败或继续消耗当前已限流的模型。需要已启动、已认证、已授权的 loopback AXIOM，以及登记且空闲的专用任务。默认 origin 为 `http://127.0.0.1:4317`；矩阵可传 `--origin`，lifecycle 固定 4317。

按[项目依赖声明](../../../app/package.json)安装完整开发依赖后，在仓库的 `app` 目录运行[驱动](../../../app/scripts/kiro-live-check.mjs)。其中 `typescript` 仅供代码题静态 AST 解析，不执行生成代码。用真实的**专用测试身份**替换占位符；不要使用主任务或其他会话：

```powershell
$workspace = 'OWNED_WORKSPACE_ID'
$parent = 'OWNED_PARENT_SESSION_ID'
$task = 'DEDICATED_TASK_REF'
$state = 'NEW_STATE_PATH.json'
$fixtures = [IO.Path]::GetFullPath((Join-Path (Get-Location) '../test-results/kiro-long-session/workspace'))
$toolCwd = [IO.Path]::GetFullPath((Join-Path (Get-Location) '..'))
# 驱动只预检 fixture，不负责创建。复制已审查的合成 fixture 到全新专用目录。
if (Test-Path $fixtures) { throw 'Use a new dedicated fixture directory' }
New-Item -ItemType Directory -Path $fixtures | Out-Null
Copy-Item ../docs/evidence/kiro-long-session/fixtures/* $fixtures

node scripts/kiro-live-check.mjs inspect --workspace $workspace --parent $parent --task $task --state $state
# 每型号独立任务、新 state、新 tag，逐个串行；仅 auto/Sonnet/Haiku 添加 --vision。
node scripts/kiro-live-check.mjs matrix-long --workspace $workspace --parent $parent --task $task --state $state --model MODEL_ID --controlled-prompts --fresh-worker --pace-ms 30000 --receipt-tag NEW_TAG --fixture-root $fixtures --tool-cwd $toolCwd
node scripts/kiro-live-check.mjs verify-defaults --state $state

# 仅适用于已有 ORBIT/青鹭历史的原 Sonnet 专用 state，不适用于空白 MATRIX。
node scripts/kiro-live-lifecycle.mjs ORBIT_STATE_PATH.json NEW_LIFECYCLE_PATH.json medium
node scripts/kiro-live-native-proof.mjs ORBIT_STATE_PATH.json NEW_PROOF_PATH.json --expect-interrupted-tools --run-id RUN_ID --message-id AXIOM_MESSAGE_ID --answer-sha256 ANSWER_SHA256

# 默认要求完整矩阵。--allow-incomplete 只允许标记 incomplete 的导出，不会使其通过。
node scripts/kiro-live-evidence.mjs --input-root INITIAL_MATRIX_ROOT --allow-incomplete --output NEW_INITIAL_EVIDENCE_PATH.json
node scripts/kiro-live-evidence.mjs --recovery --input-root RECOVERY_ROOT --allow-incomplete --output NEW_RECOVERY_EVIDENCE_PATH.json
```

也可用 `AXIOM_KIRO_WORKSPACE_ID`、`AXIOM_KIRO_PARENT_SESSION_ID`、`AXIOM_KIRO_TASK_REF` 提供新 state 的身份。已有 state 不受环境变量重定向；显式身份 flag 冲突/缺值在连接前失败。`--fixture-root` 和 `--tool-cwd` 同样拒绝缺值。`--tool-cwd` 仅供工具证据的相对路径解析，必须与专用 workspace 的实际工具 cwd 一致，不会改变服务/工具的工作目录。矩阵模式只预检 fixture；不得把目录指向非专用可写区域。本目录的 [CSV](fixtures/inventory.csv)、[ledger](fixtures/ledger.json)、[图 A](fixtures/visual-a.png)、[图 B](fixtures/visual-b.png) 是实际使用的合成输入，按原字节保留。ledger 和图片标题沿用 ORBIT-K7/青鹭合成标记；矩阵只用 ledger 数值及图片 CODE/色值，当前会话标记应来自 MATRIX 历史，不应被 fixture 标题覆盖。

目录输入布局为 `ROOT/MODEL_ID/state.json`。本次恢复跨两个 root，可通过导出器 API 明确映射，不能把 raw state 覆盖合并。下面 JS here-string 全为 ASCII，避免 Windows PowerShell 5 管道损坏中文源码：

```powershell
$exportCode = @'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { buildRecoveryEvidence, recoveryModels } from './scripts/kiro-live-evidence.mjs';
const [firstRoot, nextRoot, output] = process.argv.slice(2);
const states = Object.fromEntries(recoveryModels.map(id => {
  const root = ['minimax-m2.1', 'claude-haiku-4.5'].includes(id) ? firstRoot : nextRoot;
  return [id, JSON.parse(readFileSync(resolve(root, id, 'state.json'), 'utf8'))];
}));
const evidence = buildRecoveryEvidence(states, { allowIncomplete: true });
mkdirSync(dirname(resolve(output)), { recursive: true });
writeFileSync(resolve(output), JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
'@
$exportCode | node --input-type=module - RECOVERY_ROOT_A RECOVERY_ROOT_B NEW_MERGED_RECOVERY_PATH.json
```

驱动没有跨客户端原子任务锁；不要并行施压或盲目重放有副作用的工具。所有新 attempt 和导出使用新路径，保存 UTF-8 日志与真实退出码。原始 state、错误正文、完整工具参数/结果及 native-proof 本地输出**都不能直接公开**。

字段白名单不等于任意输入值的自动匿名化：curator 用于可信专用 driver state，不是通用凭据清洗器。taskRef/run ID 仍可关联，提交前须复核实际值格式及私有 ID/路径。公开文件不含原始提示/回答/思考、签名、凭据、完整工具正文、私有 session/workspace metadata、native transcript 文件名或大型 REA 原件。
