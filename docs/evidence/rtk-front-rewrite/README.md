# 官方 RTK 宿主前置优化验收

日期：2026-10-29。结论：**源码实现与所列版本化隔离验证通过，但最新共享工作区尚未完成最终验收。** 本任务未升级生产 RTK、安装外部插件或重启后台；不能据隔离测试推断运行后台的激活状态。

最后一轮 UI／构建通过后，其他任务再次修改了 `RtkTool.tsx` 等文件，当前源码不再完全匹配所测快照。请先暂停相关并行编辑再定向复验，或由用户确认以已验证快照验收；本文不将历史通过结果冒充当前工作区通过。

范围按 [定稿方案](../../rtk-optimization-plan.md)：官方引擎及后续官方版本，借鉴 Pi 插件的宿主机制；零新增提示词、零额外模型调用。不引入 read 有损压缩、通用裁剪、Code Mode／索引／历史摘要。使用当前 Pi 1.4.0、Node 22.23.2、macOS arm64 和托管 **RTK 1.0.1**；不是 PATH 中的 0.45.0，也不证明其他版本已兼容。

## 1. 交付与安全契约

| 契约 | 实现与验证 |
|---|---|
| 原始与候选均受权限约束 | 末位 inline gate；先经过已有原始 `tool_call` hooks，再经公开 runner 验证重放候选；拒绝／异常／候选突变阻断，不借 fallback 执行原命令 |
| 不改模型工作方式 | 不加 RTK 工具、schema、prompt 或 suggest；同 cwd worker 测试对系统提示／工具 schema 深等，原 assistant 命令与历史保持不变 |
| 单次执行 | 计算 rewrite 发生在业务执行前；已执行后不为原文、基线或回退再跑；成功／失败的已采用结果均不再 `pipe` |
| 语义不明即旁路 | find、producer pipeline、机器格式、展开／重定向、高级语法、非 Bash 空白、包装器／状态注入、自定义 shell／prefix、初始化环境与导出函数均受门禁 |
| 取消与热设置 | 官方 rewrite 受监督、2 秒／输出限额；signal、admission、配置 revision／路径／shell 与初始化环境采用前再次检查 |
| 独立计量与恢复 | rewrite 采用／耗时与后处理实测字节分账；旧 10 列 SQLite 加 stage 兼容旧行；前置不伪装未观察到的完整原文，旧后处理回查保留 |

实现入口：[grammar 与绑定](../../../app/src/server/integrations/rtk-rewrite.ts)、[权限与前后互斥](../../../app/src/server/integrations/rtk-runtime.ts)、[worker 接线](../../../app/src/server/agent-worker.ts)、[统计迁移](../../../app/src/server/integrations/rtk-stats.ts)、[管理 UI](../../../app/src/client/pages/RtkTool.tsx)。

验证重放可能再次触发第三方 hook 的审批／日志等副作用；不是第二次工具执行，也不保证任意第三方 hook 幂等。有限 shell 门禁不构成任意脚本语义或 OS 沙箱证明。

## 2. 自动回归与构建

工作目录 `app/`：

```sh
./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/rtk*.test.ts
./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/capabilities-worker.test.ts tests/subagent-readonly.test.ts \
  tests/subagent-worker-regressions.test.ts tests/agent-initialization-admission.test.ts \
  tests/command-admission.test.ts tests/component-environments.test.ts \
  tests/tool-process.test.ts tests/axiom-prompt.test.ts
npm run build
```

- RTK **50 通过、0 失败、0 跳过**，包括新版 grammar、初始化环境／导出函数、双权限、失败不重跑、并发、取消、热开关、子代理、迁移与清理。
- 指定宿主范围 **48 通过、0 失败、5 跳过**。跳过项是 PowerShell launcher、3 项 Linux detached descendants 清理与 verbose owned-log 有界性；不计作已验证通过。
- 最终构建 `tsc --noEmit && vite build && tsc -p tsconfig.server.json`，**exit 0**，2,639 modules；仅非阻断 chunk >500 kB 警告。
- [最终 RTK 日志](logs/axiom-rtk-final-tests.log)、[宿主日志](logs/axiom-rtk-final-host.log)、[各退出码](logs/axiom-rtk-final-exits.log)、[最新稳定构建日志](logs/axiom-rtk-final-close-build.log)、[构建退出码](logs/axiom-rtk-final-close-build-exit.txt)。

最终 Node 回归期间，全仓快照仅 UI `RtkTool.tsx` 与未选中的模型账户浏览器检查发生并行变化，所测后端文件未变。随后还有 15 个共享文件变化，涉及组件图标／CSS 与服务器入口等；没有据此声称旧快照覆盖最新状态，而是按实际影响补验：

- 最新完整构建 **1,632 项源码／测试／配置 SHA256 前后一致**，见 [前](logs/axiom-rtk-final-close-build-before.json)／[后](logs/axiom-rtk-final-close-build-after.json)。
- 最新 UI 的 **20 个直接相关文件**（包括 Card、Glyph、CSS、图标集、transport）前后一致，见 [比较](ui/final-close/hash-comparison.json)。
- `capabilities-worker.test.ts` 直接依赖变化后的 `server/index.ts`，因此单独补验 **1 通过、0 跳过、exit 0**，且 1,633 项哈希前后一致（比构建范围多 package-lock）。[日志](logs/axiom-rtk-final-close-capabilities.log)／[退出码](logs/axiom-rtk-final-close-capabilities-exit.txt)。该 1 项是原 48 通过中的复验，不加算成 49 个不同用例。
- RTK 核心、worker 与相关测试代码没有再次变动，不盲重跑已通过的 50 项、官方矩阵或 provider。原始 final-safe／stable 版本仍保留，但最新 UI／构建以 final-close 为准。

## 3. 真实官方命令语义

[最终矩阵](matrix/final-safe/verification.json)、[最终汇总与源码哈希](matrix/final-safe/final-summary.json)、[补充旁路](matrix/final-safe/extra.json)。脚本为该目录 `run.ts`、`supplement.ts`、`verify.ts`、`extra.ts`；均由 `app/node_modules/.bin/tsx` 执行，**四项 exit 均为 0**。

- 43 主样例＋16 补样例 × 均衡／强力 = **118 对：60 采用、58 旁路**。
- 18 项断言全部通过；接纳项退出码差异 **0**，无 signal／spawn error／timeout。覆盖成功、非零状态、`&&`／`||`／多行、安静 diff、grep 无匹配／坏正则、关键诊断与末端管道。
- 8 对 stderr 不是逐字一致：部分 status 诊断缩短、log 多换行；关键错误诊断断言保留，不能承诺原始 stderr 字节完全一致。
- 22 个 source-find 对、18 个官方生成 `rtk find` 对全部旁路，另 8 个非 find source 的 find 候选注入探针拒绝。
- 25 个危险 source × 两档 = **50 对全部旁路**，含 time／env／command、eval／source／hash／history／fc 与 NBSP／VT／FF；另 12 个状态候选注入探针全部拒绝。此组仅执行官方 rewrite，**业务执行 0 次**。
- 最终 `rtk-rewrite.ts`、`rtk-runtime.ts` 测试前后哈希一致；命令映射仍全部来自官方，不以 semver 或上游测试存在替代运行验收。

**find 的历史失败是实测，不是预期通过**：早期官方 `rtk find missing-path` 将失败变成功并改变控制流，因此宿主禁用整个原始 find 请求及所有 `rtk find` 候选，不修官方引擎。保留 [初始采集](matrix/history-find/supplement.json)；其脚本 exit 0 只表示采集完成。旧成功结果后处理仍保留。

## 4. 真实进入 provider 的工具文本

[最终摘要](provider/batch-1793286409092/summary.safe.json)、[独立字节复核](provider/batch-1793286409092/independent-byte-check.txt)、[探针](provider/probe.mts)、[日志](provider/probe-final-safe.log)、[退出码](provider/exit-code-final-safe.txt)。实际运行真实 ExecutionPool／worker／SDK，provider 是本地 loopback fixture，不调用商业模型；每次隔离 root、白名单环境、复制并校验官方 binary。

| 工作负载 | 关闭→启用工具文本 UTF-8 字节 | 结果 |
|---|---:|---|
| 主代理，140 长文件名，porcelain | 15,400→15,400 | 机器格式旁路，后处理 unchanged |
| 主代理，1 文件，porcelain | 9→9 | 机器格式旁路，后处理 small |
| 主代理，140 文件，普通 status | 15,314→15,168 | 前置采用，净减 146 B |
| 子代理，140 文件，porcelain | 15,400→15,400 | 机器格式旁路，后处理 unchanged |
| **合计** | **46,123→45,977** | **仅 146 B，约 0.3165%** |

8 次 worker 运行均完成、exit 0：每次 **2 个 provider 请求、业务 `git status` 一次**，旧历史及 assistant 原命令保留；配对工具 schema hash 一致。普通 status 前置另做 RTK 自身 `rev-parse --show-toplevel`，不是重复 status 业务执行。

不同 fixture cwd 使 system hash 不同，此探针不能证明 prompt 完全相同；该不变量另由同 cwd worker 回归验证。完整 JSON 请求大小亦有 cwd 等差异，不能全部归因 RTK。这里的 146 B 是四个配对工作负载的实测工具文本，不是账单 token、普遍压缩率或历史 5,000 条工作负载的收益。

## 5. 真实页面与导出

[最新结果](ui/final-close/result.json)、[下载 JSON](ui/final-close/axiom-rtk-effects.json)、[探针](ui/final-close/probe.mts)、[亮色 320](ui/final-close/rtk-light-320.png)、[暗色 1200](ui/final-close/rtk-dark-1200.png)。使用已安装 Chrome、隔离服务 port 0；预置数据验证而非运行 RTK：

- 后处理 1 次、1,000→100 B，页面显示 900 B／90%；rewrite 检查 5／采用 3，故意设置的非零前置事件字节不污染汇总。
- 最近前置行显示“字节未测量”；下载 JSON 保留分账与 measurement 说明。
- 前置不能恢复未观察原文／不为回查重跑／仅后处理保存原文等边界断言通过。
- 暗亮 × 320／390／1200 无全页横向溢出；窄表在容器内横向滚动，无 pageerror、浏览器外网请求或 RTK 程序执行；服务正常关闭。
- 未点击安装、更新、清理或卸载，不将页面渲染验证冒充管理操作的生产验收。

## 6. 失败历史、完整性与限制

- 初始 worker 测试的隐式 any 类型错误已修；第二轮 48 项通过后，独立审查发现空白／包装器／状态问题，随后收紧 gate 并重跑最终 50 项、官方矩阵与送模探针。旧日志不是当前源码通过证明。
- 中途共享工作区出现未解决冲突，构建失败；标记消失后又因模型账户的三项非 RTK 类型错误失败。主代理未选择他人冲突版本、git reset／add 或修改该模型代码；后续外部变动消除这些错误，最终稳定构建通过。失败日志原样保留，不隐去。
- 早期额外矩阵失败是临时探针错误地把官方 code 1 当异常并换掉真实原始 source，最终更正断言后保留首轮失败。早期 provider 两次失败分别是跨 cwd systemHash 深等及把辅助 rev-parse 计为业务重跑；不是产品回退行为。
- [文件清单与 SHA256](manifest.json) 列出原始 tmp 来源、阶段及最终／历史角色；[最新来源哈希](source-sha256-final-close.json) 关联最终 UI／核心／宿主快照；[最终扫描记录](logs/archive-close-security-scan.json) 为启发式凭据检查，不保证所有未知格式秘密可识别。不归档完整宿主环境、凭据、二进制、DB、fixture root 或完整 provider 请求。
- 脚本保留实际执行时的绝对路径／临时目录以便核证；复用时须显式调整隔离路径和官方 binary，不应直接对生产 root 盲跑。
- 未跑全仓全部测试、Windows／Linux 真机、任意第三方 hook、自定义 shell 或商业模型；不宣称完整原文可逆、OS 沙箱增强或真实账单节省。当前 Git 工作区含大量其他任务改动，不等于一份干净独立提交。
