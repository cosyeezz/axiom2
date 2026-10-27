# Kiro 原生接入交接

截至2026-10-27；用户要求交付并交由其他AI分析。本轮停止主动排查，不再追加模型请求、测试、构建或重启。**实现与诊断代码已交付，但真实Kiro接入未验收通过。**

## 1. 当前结论

- Axiom/Pi保留agent循环、工具、权限与恢复；Kiro仅作原生provider，不通过CLI/ACP接管agent，不伪造官方身份。
- 唯一正式Kiro文本请求失败。刚完成正式只读API核验：原失败消息可投影为 **HTTP400 / ValidationException / partial=false**；未定位具体错误字段。
- 原消息没有可投影的`observedValidationReason`。这不证明原服务body没有reason；不得从旧消息倒推新观察字段。
- 没有新Kiro请求、换模型碰运气或真实工具验收。物理HTTP次数、服务端费用、推理权限及完整官方调用链仍未知。
- 16项兼容修复及离线门禁不等于接入可用。后续修复过K39公价重估历史费用的问题，但它不是本次Validation失败的已证根因。

## 2. 最有用的证据

- [正式安全诊断及部署索引](evidence/kiro-native-compatibility/owned-failure-read-verification.json)：13:20:50.624Z只读成功，父task/child/input/run归属确认，snapshot与message.get的六字段一致。
- [诊断实现与检查总索引](evidence/kiro-native-compatibility/diagnostic-verification.json)：已更新为已部署、已正式读取，不再等待用户编译。
- [稳定窗口离线证据](evidence/kiro-native-compatibility/stable-window-verification.json)：12文件110/110、双noEmit成功，属于11:51–11:54快照，不与历史108或415累加。
- [实施报告与完整限制](kiro-native-compatibility.md)。[历史首次实调](evidence/kiro-native-compatibility/live-verification.json)、[一次目录刷新](evidence/kiro-native-compatibility/catalog-verification.json)保留原时点事实。

正式诊断六字段：

```json
{
  "stage": "http",
  "category": "validation",
  "partial": false,
  "status": 400,
  "code": "ValidationException",
  "requestId": "074e6216-67f1-43e3-b279-b14b2de841e5"
}
```

## 3. 当前部署及验证范围

用户明确授权重启skill后，根`npm run build`成功，一次独立控制器完成29659→43577，HTTP200、WS握手成功。入口`app/dist/server/index.js`，cwd为`app`，端口4317。

后续隔离server编译exit0，314个生成JS与dist逐个SHA匹配；含dist/Pi三包的4240路径在编译前后及正式读取前后无变，dist生成早于进程启动。**进程及构建证据窗口截止13:20:58.369899Z，接手时必须重新确认，不代表持续监控。**额外164个非本次生成JS不在314匹配结论内，未清理。12个诊断source/test和7个WS宿主/test的SHA未变，未机械重跑旧检查。

正式读取和证据交付的175项一致性检查exit0，独立只读交付审查无确认阻断；这些不是175项新功能测试。

## 4. 接手入口

- [聊天与最终请求组装](../app/src/server/providers/kiro-chat.ts)、[请求协议/序列化](../app/src/server/providers/kiro-chat-protocol.ts)。
- [错误分类和受控reason观察](../app/src/server/providers/kiro-failure.ts)、[安全显示投影](../app/src/server/kiro-failure-display.ts)、[冻结白名单](../app/src/shared/kiro-failure.ts)。
- [认证](../app/src/server/providers/kiro-auth.ts)、[目录](../app/src/server/providers/kiro-catalog.ts)、[正式入口驱动](../app/scripts/kiro-live-check.mjs)。不要直接运行驱动的send/matrix重放旧state。
- [相关真实SDK隔离测试](../app/tests/kiro-failure.test.ts)、[投影测试](../app/tests/kiro-failure-display.test.ts)、[WS三路径测试](../app/tests/kiro-failure-display-ws.test.ts)。测试文件是否存在以当前工作树为准，不能把历史数字当最新全量结果。

本机原始artifact：`/tmp/kof-PSUIRAoS/`含只读driver、实际结果/exit/stderr、读前后构建归属证明、175项交付核验；`/tmp/kdp-lAZ9Wt/`含隔离编译与314逐项比较；`/tmp/axiom-build-restart-9pDLzPeV/`含构建及重启提交记录。controller状态在`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/axiom-backend-restart-dv01aw49/status.json`。不要直接读server.log，可能含访问链接/token。

## 5. 原正式请求的已知范围

- workspace：`b64c057e-96ee-435a-a078-a501e8f0d128`
- parent：`6cc9d0a0-baff-4564-9066-da8402675724`
- task：`t6466` / `85db14a4-fa4e-43df-9ed1-041ae02922b3`
- child：`2b4ec727-41ed-47f2-b5ce-cea20533b174`
- failed run：`4c734cb4-60fd-4b7d-b206-6ec8e8989c34`
- input：`60df64cb-815e-413d-80e3-393d398890c7`
- 模型选择：`kiro / claude-sonnet-5.5 / off`；一次正式目录刷新含该ID，但不证明聊天接受/推理权限。

原合成prompt只要求计算37×19、回复固定一行，不调用工具。正式READY准备回合使用其他provider，不是Kiro成功。首次失败之后没有新的Kiro模型请求。

## 6. 尚需解决及安全边界

下一位AI首先区分：**字段级Validation根因尚未知**，而非“投影/部署尚未完成”。不要把400直接归因于modelId、profile、conversation UUID或system放置；已有分析未证明这些字段丢失/错误。完整官方caller/auth/endpoint/final-send证据尚未闭合，局部静态函数不能补全未知。

有价值的下一输入是：非敏感具体validation reason、官方已知可接受的请求约定，或由用户明确选择一次新的隔离诊断文本以采集已部署观察（在尚无已证wire修复的情况下，这不是已修复后的常规验收）。不要自动重试旧失败run；文本成功之前不做安全工具闭环。

只使用合法已有认证和正式Axiom/provider入口；不读/复制token，不直连绕过正式应用，不扫DB、其他用户聊天或秘密日志，不刷新第二次目录，不新登录/产品授权或扩大安装。仓库存在大量既有脏/未跟踪及并行修改，编辑前复读，不reset/clean或冒领其他人的改动，不持久修改node_modules；测试覆盖的文件运行期间不修改。
