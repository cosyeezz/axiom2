# 实发前准备与修正

**Waiting：范围外Kiro源码/emit持续变化，且最新两者不匹配，尚不能实发。** 当前没有claim、外部模型或认证请求；本步骤仅零网络自测/metadata诊断，没有修改生产源码或emit。并行变化详[漂移复核](DRIFT-REVIEW.md)，本步骤不覆盖它们、不重跑旧case。需先取得稳定源码/构建快照再重新准入。

## 独立审查与修正

静态审查t12331/r12332指出初稿不能实发。主代理核对安装Pi1.4 `pi-ai/dist/auth/resolve.js`：锁内刷新15秒信号独立于caller，防止旋转令牌未持久化。已调整：

- 辅助门禁准入前检查case取消；准入后保留SDK的refresh signal，不并入caller abort。只有正常Pi锁owner调用刷新。
- 初始runtime可能为缓存恢复而检查过期OAuth，因此不把caller signal传给该初始化，等待正常锁流程完成。后续仅包装公开provider OAuth方法观察完成，RAM暂存新credential，清理时经正常账号路由确认持久化，既不自行刷新也不注入第二store。
- 工具审批和执行失败latch+abort；含多工具调用的完整响应不执行任何工具。runtime/auth之前也限定逻辑调用，再由真实sender硬限物理发送。
- 清理20秒/hard200秒，计aux acquisition、body、刷新、Agent、provider、dispatcher及新增TCP资源。超时不称成功。
- binding同时校验既有33模块source/emit分发证据、60源码、当前关键emit/Pi文件、harness/fixture/verifier；预检、自测、live必须一致。不是所有Node依赖的OS级完整性审计。

## 已实际执行

- `node --check HARNESS.mjs`：0。
- `node --max-old-space-size=256 HARNESS.mjs --selftest selftest-01.json`：1，初版只记录POSITIVE_FIXTURE，诊断不足。
- 同命令02–04：1，增加白名单诊断后定位合成`models.json`为`{}`，缺必需`providers`字段。临时fixture改为`{"providers":{}}`；未改真实配置/生产源码。调整合成过期时间不是根因修复。
- `selftest-05.json`：0，通过成功工具+下一轮、坏终态、取消/late、模型/辅助预算；所有Socket连接尝试0。
- `selftest-06.json`：0，进一步覆盖多工具拒绝（预期TOOL_APPROVAL，1模型/0工具）、刷新中caller取消仍按正常锁持久化（1合成refresh/0模型）、2MiB响应上限。正例3×200/1工具/2stop；其余负例均0工具，body/observer归零。证据含62关键产物指纹。

05/06不是最终live准入proof。t12331/r12344增量复核确认OAuth主要问题已修，指出内层cleanup轮询也须deadline、hard watchdog不能被提前撤销；已补deadline并改为unref保留硬200秒兜底。VERIFY补refresh/aux/逻辑次数及HARD_TIMEOUT不存在断言。

随后`selftest-pass.json` exit1，被SOURCE_CHANGED门禁阻断；`import-proof.json`单独通过（t12350/r12352，0网络/0写/环境未变），但绑定的harness随后改变，因此它也不是最终准入proof。

### 已调查的范围外源码变化

首次观察时，只有`app/src/native-providers/kiro/catalog.ts`与离线基准不同（后续此结论已失效）：原SHA `b87bd5bf05a142771f9aaf9fee8ca6325655d3e6252c0ca719d7419ff724e491`，观察到当前SHA `782be3978cfdf6151699365ae31cdbd4687801291a02eb8873066d63fe640182`。本轮没有修改该文件，来源未归因，不覆盖或恢复它。其余59源码及全部33组件emit仍严格匹配离线/分发证据。本次运行已有已验证emit，不重建/执行这份新Kiro源码，不扩大CodeBuddy验收为新Kiro验收。

曾临时明确固定这一项源码-only漂移的实际SHA、保留其他源码及全部emit原基准；该临时例外现已撤回，因为后续emit也发生变化且源码再次更新。第一次最终文件`selftest-final-01.json`与`import-final-01.json`均通过（合成网络0、导入网络0/写0），但首次preflight在main内部命名冲突的TDZ处、调用预检前即失败。保留`preflight-failure-01.json`；独立封网metadata诊断`PREFLIGHT-DIAGNOSTIC.mjs`/`preflight-diagnostic-01.json`确认正常OAuth路由、模型native sender、配置未变、当前proxyMode=direct、网络0。不是账号错误。

main局部证据变量已改名preflightProof，避免遮蔽preflight函数。第二次`selftest-final-02.json` exit1 DISTRIBUTION_CHANGED；`import-final-02.json`仍通过0网络/0写，但不是最终准入proof。t12369/r12372复核发现Kiro source再次改变且与emit不匹配，不能批准固定先前hash。

当前HARNESS已恢复全部原基准严格门禁、撤回临时source-only例外；不复用02结果，不覆盖旧证据。下一步依赖并行修改完成及稳定快照；届时须重新评估基准，再使用新的selftest/import/preflight文件和匹配指纹。准备文件不是成功实发结论。
