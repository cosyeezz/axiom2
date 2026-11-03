# 案例回溯：971742f3，从开始到交接

本案例是未完成工程的经验总结，不是成功复刻声明。历史检索工具本轮返回“查询暂不可用”；以下依据本会话已保存详情、主代理已核报告及两个只读回溯任务，不伪称重新执行全部原始实验。新版接手以交接清单/manifest当前值为准。

## 1. 最初定位与REA预算

错误：feed提到2.12.0、EXE没VersionInfo，就把该号用于当前CLI；PE检查成功、预算调大就把深度分析标Completed。
证据：旧快照528630968B/SHA0ff1d24e…；330s provider_timeout没有目标C。后来当前安装407386296B/SHA6f8898ee…、CLI实测2.35.1，属于另一个绑定。
教训：版本、组件、大小和全SHA一起存。旧分支父状态已纠正，不能恢复失败尝试或套旧VA；readback只是配置生效。

## 2. Ghidra从全局耗时转目标化

错误：继续等500MiB程序全局分析；看到resource_constraint就猜OOM；有decompile_completed就接受C。
证据：16G/1800s仍在全局DecompilerSwitch分析，原错误是timeout。小3072B控制PE先成功，再用-noanalysis/.pdata/DecompInterface得到完整3618B函数。另有2931B函数膨胀成562481字符/1895 CFG且1832越界；补全函数边界无效，局部Rust状态表误吞邻表才是问题。
核心指导：**先定位，再局部分析**。从问题和候选xref开始，小控制验证工具，再分析局部完整函数范围，核ASM/CFG/gap/表项；不是默认全局分析失败后才缩小范围。call-fixup/JumpTable注释只改私有DB，不是原符号/原类型/源级UB证明。有限切片够回答问题就停止std/allocator无限扩展。

## 3. 早期日志、ACP与认证

错误：5342B发送前日志当wire；trace stdout不影响ACP；命名管道自测能替代CLI recorder。
证据：旧探针是pre-transmit、目标exit1、API pipe0B、日志还截断；KIRO_LOG_STDOUT继承污染JSONRPC。wrapper0或initialize0不等模型响应。
教训：先验证通道及协议隔离；send前、实际网络、server接收分开。Social JSON、External form、企业联邦与API_KEY分别核；mode不是bool、region不决定mode，缓存scopes与表单scope不能混同。31C/49C等有限成果不等完整传输闭环。

## 4. 原生重试与去品牌

错误：provider1fetch等session1次；abortRetry等完整abort；receipt等远端exactly-once；全局替换Axiom字样。
证据：Pi1.1.0缺省额外3次，2/4/8s；partial text/thought/tool含缓冲状态阻重放，abortRetry有控制器安装窗口。7生产/8测试去品牌累计190覆盖=44+114+8+未变24，不是单次190。
教训：分session/provider/host，保custom/history/安全/用户路径。SDK Agent无setModel，核d.ts修test而非as-any。test fixture共享home skill污染断言，用test-only noSkills；tsx命名pipe被误当网络，用精确IPC白名单。删除显式UA不等Undici最终不补头。离线通过不等部署。

## 5. 便携Frida、身份和管道

错误：Node Frida不可用就认为路线全阻；自然退出后仍要求RPC；Close调用返回过就算清理；用PID补开或basename辨身份。
证据：隔离Python portable Frida可用，Native fake和natural退出夹具取得有限闭合。strict image/creation/Job前后活体与借句柄仍需分层；某些observer安装到launcher而非产生连接的另一个exact-runtime。
教训：显式隔离依赖，query-only与控制分离；原创建/借句柄登记和Close失败留证；不把部分held集合称全树。stdin必须真EOF，不是写x。schema03两次预算已耗尽，CLI0+未分类诊断仍Root失败，不能放宽parser重跑。

## 6. NUL探针与真实case

错误：可安装hook就能收正文；append-only与GENERIC_WRITE差异可通过改ordinary access“修复”；多次空发会自然揭示问题。
证据：自有fake-NUL 2sink/5Write/86B成立，current02/05/08/10各1语义prompt均CLI正常回答但NUL0。代码锚点匹配只说明安装条件，不证当前路径执行。新分支共4，不是整个会话或物理请求总数。
教训：保ordinary flags/参数；找实际执行时机/actor，先非模型验证。已占用case不重复，无第5次空发。旧logger/control探针成功不代真实请求。

## 7. Wireshark、TCP和DNS

错误：抓包即可证明HTTP sender；tshark SYN按1/0；用$matches保存业务表；content_type23=0就称没TLS密文；旧DNS快照反复比较。
证据：case09仅DNS门禁失败、0prompt；10改fresh快照digest绑定后采样成功。PID67056的两个候选443 row keys只是TCP归属；wire33帧/2流，runtimeTLS1.3、q只有SYN/SYNACK。补充指出runtime9帧opaque23，非“无密文”，仍无HTTP。SYN与SNI误判分别源于True/False与$Matches覆盖。
教训：精确字段原顺序，不normalize；pcap、owner、send前、server分层。snapshot不证未来route，重传不等API retry；旧PID结束不可重开。

## 8. 自然NtResume交接

错误：CPW onLeave才attach；JS throw保证原API不执行；VM timeout就是真Native park。
证据：JS01纯VM61=59pass+2故障路径失败，永久禁Native。JS02改best-effort fault+诊断Sleep+无返回fallback，74/74 VM，但真实Frida行为未知。
教训：原NtResume onEnter交接，普通参数不改；需独立owner先终止ownJob再SDK。fault不返回不能称finally已恢复lastError，CPU fallback需明确限制。

## 9. IPC oracle与controller01

错误：Windows stdout归一到LF；单行131空白应到JSON decoder；17preflight即可跑Native；all(empty)成立就clean。
证据：Windows原始CRLF131B；原IPC189=188pass+1错oracle，单行先RuntimeError才正确。严格资格189=188旧PASS沿用+1新执行，12诊断沿用，不重跑旧suite。
controller01独审复现：timer只fault不独立Term；TermFalse但held0仍SDK；空waits假绿；export期间/之后latecallback仍green。另dup登记失败丢handle、UTF16长度缺口、超时丢SDK lease和坏export。
教训：分实现失败/oracle错/启动失败；4测试入口exit0只是成功复现，audit_exit1才是安全结论。保失败，不改冻结01取绿。

## 10. 当前交接点与过程性教训

02设计采用独立owner+sticky Event+candidate+lease epochs，但只是有条件设计认可。controller02仅draft-a，DRAFT_READY=False；38partial pure通过不证明完整owner或Native，supervisor未写。
本轮为了证据索引曾产生1.3MB派生报告；再生成25KiB digest，原件保留。教训是最小scalar+pointer/行/byte/SHA/关键trace足够，不让审计复制膨胀取代修复。用户要求交接后暂停实现，先冻结可读快照和明确下一步，避免新Agent接到漂移状态。

## 可追溯来源与路线更新

[Windows证据摘要及来源SHA](windows-evidence.md)保留关键原件的文件名、完整SHA、观察边界和禁跑状态；原件仍在冻结Windows交接包，不把缺失原件说成已在Mac重验。

用户现已明确转向 **macOS版Kiro CLI**，以免费Ghidra为主，不需要Hopper。旧Windows controller02续写不再是迁移前置，不能按本页历史步骤自动恢复。先读[最新接手入口](session-entry.md)与[Mac原生门禁](macos-native.md)。搬到其他环境时只复用方法，不自动沿用授权、版本、PID、限额、ABI或地址。
