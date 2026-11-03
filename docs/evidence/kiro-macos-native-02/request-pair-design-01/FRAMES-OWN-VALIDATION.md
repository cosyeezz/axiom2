# Candidate-only RAM 帧组件：有限验证

**18 named cases功能通过，不是完整执行合同、IPC、observer、模型门禁或真实请求一致性通过。** t12060/r12061已matched消费；主完整读manifest/controller/harness/result/controller-result并核case名单、计数、PID/exit及源码前后/当前SHA，七原件exclusive逐字节保全：[AUDIT](frames-own01/AUDIT.json)，[归档工具实际exit0](FRAMES-ARCHIVE-TOOL.json)。未复跑。

原root `/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/candidate-ram-once-n__o_u71/`，0700。manifest命令`python3 <root>/controller.py`，Python实际解析版本/二进制未另存；Node命令为固定绝对host路径+own harness。

- 一次Node held68524/waitExit0，无timeout；实测v22.23.2/darwin/arm64。controller .040358375s包含launch/wait及后验读写，不是whole-author wall。
- stdin/stdout/stderr均DEVNULL，**无pipe EOF证据，也没有实测stdout/stderr字节数**。actual tool numeric unknown。
- 18cases/18PASS；encode47、decode15、reader11、push1062是外层harness显式调用计数，不是内部递归decode总计，更不是网络请求。
- 三label往返（一个named case）、非ASCII/孤立surrogate保真、root-target、getter/nonprimitive拒、标签/proof/保留位/长度/截断/尾字节、header-boundary/body cap、aggregate/frame/call/ordinal、分片+合并、late、unfinished、reentry/finish-pending、sinkthrow。
- 执行的是TEMP两个byte-identical源码副本，原manifest称从既有读取内容重建；主已核两副本与repo原文件逐字节一致。不是执行官方提取产物，也不证明natural安装。
- manifest/controller记录四源前后SHA一致，主核当前相同。45093B为子自报的repo源读量（不含OS/loader），并无完整syscall读量审计；whole-task≤180s未独立证实。
- stream-cap直接分支、header精确边界、所有native buffer变体、物理擦除未测，不补跑未变PASS。
- **执行范围偏差**：子自报曾在own0700TEMP之外创建后删除一个仅含TEMP路径的`/tmp`定位文件；文件名、创建/删除原始记录未提供，不能独立证实已删除。没有证据该文件含raw输入，但不将本次标为完整执行约束PASS。

原件：[manifest](frames-own01/manifest.json)、[controller](frames-own01/controller.py)、[harness](frames-own01/harness.cjs)、[result](frames-own01/result.json)、[controller result](frames-own01/controller-result.json)、[执行codec副本](frames-own01/candidate_frames.cjs)、[执行helper副本](frames-own01/traffic_values.cjs)。控制器没有闭合结果校验；主已完整读本次fixed结果并核无raw值。

此组件只传candidate，尚无真正Unix socket、fault/status relay或正常完整输入runner；finish/无剩余frame不是owner终态。后续应直接完成这些缺口，不扩旧snapshot/M3、不运行旧矩阵、不发模型找hook。
