# 私有双端通道：一次主线程集成结果

**6 named integration cases PASS；仅own fixture，不是官方/Axiom模型配对。** 新Unix broker/sender已跨进程跑通，故障不产生可消费比较。当前正式实发样本仍0，生产provider未改。

## 执行与证据

- 一次`/usr/bin/python3 -I -B /private/tmp/kiro-channel-main01.qdTXlC/controller.py`，工具timeout15s；[实际工具返回](channel-main01/TOOL-RESULT.json)numeric **0**/.3s。controller Node deadline10s；held harness84579/wait0/.23718925s，无超时，实测Nodev22.23.2/darwin/arm64。
- 两own子Node84580/84581，各wait0/signalnull、v22.23.2。因此本次共3Node进程，不是6进程。各传5env keys（HOME/TMPDIR/PATH/LANG/LC_ALL）不是native实际env审计。全Node stdio DEVNULL，**无stdio字节数或pipe EOF证明**；Unix socket readableEOF另有实测，二者不混。
- P01仅2次loopback HTTP，127.0.0.1:58557；Node HTTP POST `/v1/responses`与安装库Undici fetch POST root+target。两child均显式install两个adapters，但每child仅一个transport产生candidate。
- broker own目录`/private/tmp/kiro-pair-Vh1eAO`，初建0700、socket0600检查在正常代码执行；无同UID攻击/atomic path绑定实验，不证明peer身份。
- 主预存[manifest](channel-main01/manifest.json)、[controller](channel-main01/controller.py)、[harness](channel-main01/harness.cjs)、[child](channel-main01/child.cjs)，CreateNew RUN.lock，未复跑。前后11源及4fixture大小/SHA主后验核当前一致；[14原件逐byte归档](channel-main01/AUDIT.json)，[归档工具](CHANNEL-ARCHIVE-TOOL.json)actual0不代替fixture结果。
- controller记录124928B只计算两次bound文件读取；另读CHANNEL-SOURCE-BINDING一次（具体字节在AUDIT）。不是全部repo/OS/loader读量或whole-author墙钟；整任务时长unknown。

## 实际判据

1. **P01跨进程配对**：server收到的两个body均与fixture输入在RAM逐byte相等；broker收到的两个candidate body彼此完整UTF8相等（未改写），system/history/currentTools/model字段等固定比较相等，unknown/custom/security仍参与wholebody。**本集成未直接用broker raw与server raw作同一个oracle比较**，不冒称其独立验证了capture=server；先前adapter边界实验另有有限证据。
   - 每侧1candidate、4control、两adapter均closed/faultnone。左accepted1089B，右1238B；候选帧分别1025/1174B。broker结果时left socketClosedtrue/rightfalse，两侧readableEOFtrue；这不是完整owner终态。
   - 原header文本不等，boundary也不同（Node header-cache vs Undici H1prefix）；不能从此推服务端实际wire不等。authscope unknown，没有真实认证。
   - 两sender最后closed/readEOF/writeFinished/socketClosed，子wait0；P01 dispose返回ownDirectoryRemovedtrue。这仍不证明无任何晚回调。
2. **P02远端fault**：broker stream-fault/comparisonnull，sender observer-fault。
3. **P03缺candidate**：两侧只有active/closed status，拒为incomplete-observation。
4. **P04截断**：KPR1 prefix未完即EOF，拒为stream-fault。
5. **P05重复连接**：同slot接受计数2，拒为unexpected-connection。
6. **P06静默deadline**：100ms设置触发deadline/comparisonnull，dispose返回ownDirectoryRemovedtrue；未单独测实际触发毫秒精度。P02–P05均调用dispose，但其返回未断言/保存，不声称这些case清理全证。

[完整固定结果](channel-main01/harness-result.json)、[Node sender](channel-main01/node-result.json)、[Undici sender](channel-main01/undici-result.json)、[controller](channel-main01/controller-result.json)、[argv/env](channel-main01/command.json)、[before](channel-main01/source-before.json)、[after](channel-main01/source-after.json)、[fixture身份](channel-main01/fixture-binding.json)。JSON由已知own harness生成，主读回无raw；不是可直接处理未知目标stdout的安全collector。

## 限制与失败保留

- t12088/r12089委派失败，系统仅报`No API key found for openai`；无可靠原件/执行数，不填0，不推Kiro登录故障。主未重启该task；以上是独立新main01 case，记录自身执行。没有改任何登录配置。
- send/receive精确bytecap、背压压力、sameUID攻击/路径竞态、所有late窗口、listener恢复冲突/连接失败、跨当前official runtime安装未验证。程序timer非防阻塞硬墙钟；own Python外部timeout未在本次触发。应用read上限不等Node/kernel总接收上限。
- 尚无正式完整context runner、官方自然安装证据、精确模型门禁、正常账号/代理执行与认证scope比较，不能启动真实请求只为找hook，也不能把本次2ownHTTP加入正式模型样本。
