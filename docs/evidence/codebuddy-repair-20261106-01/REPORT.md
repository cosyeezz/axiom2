# CodeBuddy 国内原生修复验收

范围：CLI2.179.0 / Pi1.4.0 / macOS arm64。只用当前源码与新合同；旧36轮UI和旧独立SDK03不计为本轮成功。[合同](CASE-CONTRACT.md) / [官方静态证据](CLI-STATIC.md)。

## 修复与离线核验

- `request.ts`：CN product-gateway的工具图片保留tool角色、原call ID、文本与image_url；不使用custom-model hoist。未知/不支持图片仍明确失败。
- `request.ts`：丢弃无CLI依据的额外headers，认证/身份等受保护头冲突仍拒绝。
- `ids.ts` + Pi薄适配：CLI形状UUIDv7（session带横线，run/invocation32hex）；host session/run仅作运行时RAM别名，不进入wire；任意Pi identity metadata拒绝。系统、真实历史、工具定义不改写。
- **已知限制**：映射只在同一provider runtime中稳定；worker重建、invalidate后会重建，不宣称官方持久恢复等价。核心低层API仍允许显式供应商协议ID，调用方必须自己拥有并遵守其生命周期；Pi边界不把host ID当此API输入。

修前红测试：图片/header两失败；SDK host-ID隔离断言失败。修后：

| 层级 | 本轮结果 | 证据 |
|---|---|---|
| 原生/宿主离线回归 | 100通过，0失败/跳过/取消 | `/tmp/axiom-codebuddy-readonly.Ij4Jwo/test.log`；`tests/codebuddy-*.test.ts tests/session-retry-policy.test.ts` |
| 图片夹具类型修订 | 4/4通过 | `/tmp/codebuddy-native-images.AjwPMx/test.log` |
| 实际Node sender + 真Pi SDK（loopback） | 1/1通过；严格最终HTTP header/body字段白名单，host ID未发出、同run稳定 | `/tmp/axiom-codebuddy-sdk-check.xtH89W/sdk-test.log` |
| TypeScript/Vite/server产物 | 最新npm run build exit0（含TypeScript校验）；独立SDK增强时tsc --noEmit exit0 | `/tmp/axiom2-build-review.XXXXXX.log`；`/tmp/axiom-codebuddy-sdk-check.xtH89W/tsc.log` |
| 正式服务加载 | 第二次独立重启verified HTTP200/WS connected；新4个观察worker均晚于最新build、6模块SHA未变 | [runtime-proof](../../../artifacts/codebuddy-repair-20261106-01/runtime-proof.json)；重启status目录见会话记忆 |
| 独立SDK本轮真实上游 | **未重跑** | loopback不能冒充上游live |
| 正式worker/UI | GLM-5.3、DeepSeek-V4.1-Flash各8/8通过；非独立SDK代测 | [GLM](../../../artifacts/codebuddy-repair-20261106-01/glm-report.json) / [DeepSeek](../../../artifacts/codebuddy-repair-20261106-01/deepseek-report.json) |
| UI刷新只读复核 | 两模型通过，未发prompt/model/resume | [GLM](../../../artifacts/codebuddy-repair-20261106-01/glm-refresh-readback.json) / [DeepSeek](../../../artifacts/codebuddy-repair-20261106-01/deepseek-refresh-readback.json) |
| 最终状态 | 16claims、16cases、6模块未变，两run completed无活动、默认恢复 | [final-check](../../../artifacts/codebuddy-repair-20261106-01/final-check.json) |

原构建曾因新测试对readonly数组splice而失败，已改为新数组赋值并复测。独立审查发现第257个身份的容量淘汰会破坏仍活动run，红测复现后移除任意淘汰并补300runs/300sessions稳定断言，最新100回归及build重新通过。未放宽产品类型或修改node_modules；现构建只有Vite体积警告。正式UI首次脚本在菜单render时序门禁停止，0cases/0claims/0prompt，不是模型失败；补wait后才开始GLM首个case。GLM报告保留的harnessStopped/harness-gate为首次门禁历史，不是后来8项失败。

## 正式多轮结果

通过正式4317页面的模型选择、输入框发送与附件上传进入常驻worker；未用CLI代发、未向主会话发测试消息。两模型串行执行同一新[合同](CASE-CONTRACT.md)，每case独占claim，仅一次prompt admission；工具闭环会产生多次推理，16cases不等于16物理请求，本轮未捕获全部live物理请求。

| 场景 | GLM-5.3 | DeepSeek-V4.1-Flash |
|---|---|---|
| off文本/Unicode、high多轮记忆及计算 | 通过；high思考19字符 | 通过；high思考140字符 |
| write→edit→read→bash真实闭环 | 通过，4调用/4结果 | 通过，4调用/4结果 |
| 工具错误后恢复 | 通过，1预期错误后正常read | 通过，1预期错误后正常read |
| UI附图→read图片toolResult→颜色/形状 | 通过，红圆，1图片结果 | 通过，绿方，1图片结果 |
| 刷新后图片与首轮记忆续接 | 通过 | 通过 |
| 流式Unicode输出取消→新prompt恢复 | cancelled后completed | cancelled后completed |
| 默认模型恢复并新空会话读回 | 通过 | 通过 |

两runner的即时refreshHistoryVisible均为false，此探针未用作通过证据；初始false的根因未独立定位。随后单独[只读UI脚本](../../../artifacts/codebuddy-repair-20261106-01/refresh-readback.mjs)等待会话渲染、再reload：两模型刷新前后均可见4篇助手内容、恢复答案与首轮代号、正确模型和侧边选中会话；WS监听确认无prompt/agent.model/agent.resume。这证明所检查内容恢复可见，不代表所有折叠工具历史均已逐项检查。原false字段未篡改。

GLM执行exit0日志：[本次日志](/tmp/axiom-glm-ui-second-20261106.xIs8XpU3)。DeepSeek执行exit0：[stdout](/tmp/axiom-deepseek-20261106-FSe10s/stdout.log)、[stderr](/tmp/axiom-deepseek-20261106-FSe10s/stderr.log)、[退出码](/tmp/axiom-deepseek-20261106-FSe10s/exit-code)。正式[runner](../../../artifacts/codebuddy-repair-20261106-01/live-run.mjs)及只读复核均exit0；[最终检查脚本](../../../artifacts/codebuddy-repair-20261106-01/final-check.mjs)exit0。测试完成监听4317仍PID4787。没有待收后台任务，产品源码在最新build后未再改动。

提交保留本报告链接的白名单结果、验证脚本及16个已耗尽claim。全局原选择/会话控制文件、正常应用历史、scratch与本地临时日志不纳入Git；脚本依赖当前机器本地状态，不是可直接重跑的授权。上列`/tmp`日志链接仅在验收机器有效，持久结论以已提交JSON报告为准。

## 八准则现况

1. **限定已证**：新推理字段白名单与最终Node loopback捕获；认证/目录/辅助路径未重新核最终wire。
2. **部分已证**：UA2.179.0、session/run/invocation格式来自该CLI；未宣称全部profile/认证值同源。
3. **限定已证、有差异**：Pi宿主身份不再进入推理头，用户真实内容保留；运行时ID映射不提供官方持久恢复。
4. **部分已证**：实际Node sender HTTP1.1本地接收断言；不证明直连TLS或真实上游完整headers，认证/refresh/目录仍Fetch且未做本轮wire捕获。
5. **限定已证、已知差异/未验**：官方CN图片正规化静态依据、离线夹具及本轮正式图片工具闭环；parser当前回归通过。仅run无session时不保证ID稳定；worker重建无持久session恢复；官方完整重试、keepalive及恢复行为未完成等价验证。
6. **遵守**：不读/复制CLI凭据、不代发、不伪造账号/profile、不改全局代理/CA/TLS。
7. **遵守，结论限功能与局部对齐**：按源码、产物、SDK、服务、UI分列；旧验收不计本轮成功。正式功能通过不证明认证/refresh/辅助请求、HTTP版本、连接复用、直连TLS或完整wire等价。
8. **遵守**：调试证据仅字段名、固定分类、计数与结论；上下文/响应/token不另存（正常应用会话除外）。
