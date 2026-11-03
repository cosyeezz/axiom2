# Runtime matrix 修订复核

## 结论

**本轮指定范围内，A1/A2两项文档事实阻断均已关闭；S04状态歧义亦已澄清。** 无需为此修改业务或执行模型。不撤销上一轮对未执行验证及其余设计待办的限制。

## 复核证据

1. **A1（phase来源）关闭。**
   - [capability-matrix.json](/Volumes/D_Work/axiom2/docs/evidence/agent-runtime-capabilities/capability-matrix.json):46 V02明确现有stop→final_answer兼容推断，并要求新中性DTO区分原生phase、宿主显示推断、unknown。
   - 同文件:182 H04明确显示交付的phase可能来自兼容推断而非原生事实；:107 B01明确fork资格中的final包含现有显示兼容推断。
   - [agent-runtime-capability-inventory.md](/Volumes/D_Work/axiom2/docs/agent-runtime-capability-inventory.md):163、184分别写明phase来源DTO和实际displayPhase推断、UI/fork用途；未再把未来约束冒充当前保证。
   - [agent-runtime-adapter-contract.md](/Volumes/D_Work/axiom2/docs/agent-runtime-adapter-contract.md):318（6.1第7条）明确原生phase、宿主推断显示交付和unknown，保留显示行为不等于原生确证。
   - 再读[transcript.ts](/Volumes/D_Work/axiom2/app/src/server/transcript.ts):20–36，仍有Responses流式提示、textSignature解析及非流式stop兜底；上述修订与源码一致。V02/H04保留live可接受，因为表示主行为接线，不表示原生phase保证。

2. **A2（observer字段）关闭。**
   - 矩阵:159 U05已收窄为provider级start/end及http/call精度计数，明确不含完整模型选择、路由或终结原因，结束不证明上游终结，内部retry未全覆盖；partial保留恰当。
   - 主报告:216明确同样字段及其不能代表完整request记录/上游终结，:223继续限制deferred和原生内部retry观测。
   - 再读[provider-requests.ts](/Volumes/D_Work/axiom2/app/src/shared/provider-requests.ts):1–5，类型实际只有start(id/provider/precision)、end(id)，与修订一致。

3. **S04和状态读法澄清完成。**
   - 矩阵:25限定live仅为现有用户stop退役worker/process tree；通用可恢复软中断无既成契约保证，不由abort/reload暂停推定。
   - 主报告:89、95明确live是现有链路源码可见、非中性接口已实现，semantics的“应/需/不能”可为迁移要求，并以S04举例；:142仍把interruption.v1完整DTO列为待设计。足以关闭上一轮关于整项live易误读的意见，无须为保持统计项数强行增行。

## 边界

本次仅只读定点复核上述修订及两处对应源码，没有重做151项/14域审计或任何已过抽查，没有运行测试、应用、模型、构建、安装或网络，没有修改仓库。仅通过Python将本报告写入独立/tmp文件；该写入命令成功不代表产品测试通过。未新增运行时、SDK或DSH能力验证。上一轮报告中的ModelGateway中性类型、可靠事件/交互、账务修订等设计待办依然成立，但不构成本次A1/A2修订的未关闭事实阻断。
