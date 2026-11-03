# 控制及混合帧有限验证

新C01–C16功能16/16 PASS，唯一hostNode执行，未重跑旧矩阵。主完整读9原件、核8源前后/当前及TEMP副本SHA/字节、逐caseID输出、exit/计时，exclusive逐byte归档[control-own01](control-own01/AUDIT.json)；[归档工具](CONTROL-ARCHIVE-TOOL.json)实际exit0，不是fixture工具exit。

- t12076/r12080先通知cancelled（服务退出/无可靠最终回复），随后t12076/r12084 completed；两者均matched读取。主没有重启或重复委派；产物记录唯一Node执行，不能用后通知推断后台完整重启历史。
- 原root `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-control-new-w05097ve/`0700。命令`umask 077; python3 <root>/controller.py`，Node绝对路径/argv/cwd见[command](control-own01/command.json)。Python实际解析版本未记，Node PID未保存，不能补造heldPID。
- Node wait0、controller0、Node .040050917s、controller .042604542s；runtime自报v22.23.2/darwin/arm64。actual fixture toolnumeric unknown，whole-author180s预算unknown；不称完整执行合同PASS。
- stdout通过PIPE收集后原样保存273B且完整内容已主核固定输出；stderr DEVNULL字节数unknown，无双EOF证据。controller未限制stdout收集量或闭合校验后保存，**不能用于真实请求stdout**；本次输出固定无raw。env继承、未枚举，不能宣称nativeenv最小/无preload/OS网络审计通过。
- controller仓库读取计量73802B+子按source尺寸自报read工具36901B=110703B，loader排除，非全syscall读量。
- 真实两adapter各install/close，无HTTP；控制schema/proofs/getter拒、长度/保留位/计数、混合分片合并/payload内magic、remote stickyfault、截断/非法输入、late/reentry/finish-pending/sinkthrow/32controls/1024calls/64KiB准入。candidate故障后私有owner释放引用，不证明物理擦除。
- 16是namedcases，harness内多次API调用未另计，不是16请求。整流精确bytecap可达分支、真实socket、正式app/官方/模型、wire/server parity未验证。测试源码无请求调用，不将此升级系统级网络审计。

[manifest](control-own01/manifest.json)、[controller](control-own01/controller.py)、[harness](control-own01/harness.cjs)、[result](control-own01/result.json)、[stdout固定原件](control-own01/stdout-original.txt)、[before](control-own01/source-before.json)、[after](control-own01/source-after.json)、[launch](control-own01/launch-command.txt)。冻结control/mux/deps，后续写真正有界私有socket/client/broker，不复跑已过矩阵。
