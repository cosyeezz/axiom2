# Windows / Frida / owner 生命周期清单

这里只记录Windows案例验证的陷阱与尚待实现/验证的契约；不是可直接运行的Native实现。用户已改为macOS原生CLI主线，本页是历史附录，不是Mac待执行方案。Job/Wait/HANDLE/UTF16/NtResume及具体尺寸不跨平台继承；通用所有权/故障/迟到对象原则参见[Mac路线](macos-native.md)。版本、结构尺寸、权限与Frida行为须在对应平台新自有夹具验证。

## A. 命令与隔离先过关

| 陷阱 | 操作规则 |
|---|---|
| PowerShell 5.1没有PS7/.NET新API | 不用 ProcessStartInfo.ArgumentList、JsonDocument、Get-Date -AsUTC；确认版本，以Arguments正确Windows quoting启动子进程。 |
| foreach语句直接接管道报ParserError | 先 `$rows=@(foreach (...) {...})`，再 `$rows | ConvertTo-Json`。区分“没启动目标”与“目标失败”。 |
| 自动变量被覆盖 | 不把业务表命名为 `$matches`；-match覆盖$Matches。先将InterfaceGuid转[guid]。 |
| 路径/编码/参数集 | 中文文本显式UTF-8；读文件用read；Split-Path LiteralPath/Parent不兼容时用FileInfo/DirectoryInfo；Python -c复杂引号改新脚本或here-string。 |
| Python隔离误解 | 本案例Python3.12.10统一 -B -I -S；显式追加已核portable路径，不设全局PYTHONPATH。隔离不是OS沙箱。 |
| Frida包布局/版本漂移 | 17.x JS导出查询用对应module实例；portable Python可能没有core.py，先列真实文件。不要据旧SDK文档假定API存在。 |
| Pi/测试runner误判 | 读当前安装README、d.ts及实现；Agent无setModel就不要as-any绕过。tsx本地命名pipe不等外网；精确白名单，不泛放。 |
| 技能污染fixture | agentDir隔离不一定隔离共享home skills；离线fixture明确noSkills并保留显式skillsOverride，不能改变生产用户技能策略。 |
| 结构体看起来对 | 精确核ABI/sizeof/alignment和signed status；NT_SUCCESS为signed32≥0，Pending0x103不等完成；ThreadSuspendCount=35/ULONG4B，不是8B。 |

## B. 所有权与身份

1. 只管理新创建且明确归属的Job/进程/句柄。源exe/version/hash、观察到的完整UTF16路径、creation time、PID、前后Wait258、Job membership分别核。预声明路径可预canonicalize；**观察值不得casefold/realpath/前缀或basename替代**。
2. QueryFullProcessImageNameW同时核返回code-unit长度、精确UTF16字节、终止NUL、容量与无内嵌NUL；Python字符数不是UTF16 units。传入path应是声明完整local-drive路径，不接受UNC/device fallback。
3. borrowed proof只能Query，不Open/Close/Resume/Terminate；lifetime由caller维持。原caller持借句柄期间窄dup：process query+sync 0x00101000，thread候选query-info+sync 0x00100040，inheritFalse/options0。候选权限不等已证真实平台接受。
4. 首次身份/query/member错误sticky；不Enum/Open补证。部分held集不能变成完整短命树。仍允许控制owner执行自身accounting/Wait/Term/Close。
5. 获取成功后登记失败必须局部Close一次；role collision先于dup拒绝。Close失败保留事实，不重试可能已复用的handle。child从extra转members，先成功插入后删extra。
6. stdio组件的on_created异常必须用原创建句柄兜底。Create→Assign前outer Job杀不到未入Job进程；登记并未消灭supervisor被杀或Create未返回窗口。不要声称原子containment。

## C. 输出与EOF

- callback只记录计数、fault/Event及有界白名单；控制线程负责停止和关闭。不能持callback锁等待reader结束。
- stdin_write在初次Resume前真实Close并确认；某组件.release()会WriteFile x，不能用作EOF。
- stdout有界内存接收，严格UTF8/JSON/duplicate/exacttype/schema校验；未知正文、环境/命令行、原faulttext、handle值不写报告。
- 自有fake child使用真实固定请求+EOF再执行写入，不把“解锁字节”当IPC。Legacy立即写的程序需要wrapper，不改变其普通argv来掩盖。
- 本例已知Windows stdout为CRLF131B；LF129B应判不一致，不normalize。
- 读后检查cap可能多读一个chunk；SDK/OS/traceback等副本未入预算。MemoryStream无总cap，timer不保证所有native硬墙钟。

## D. 自然resume与故障屏障

- 本例观察NtCreateUserProcess成功输出，关联原本要发生的NtResumeThread onEnter；CPW onLeave通常已晚。不能改flags制造一个“证明成功”的不同执行。
- 成功status、原thread suspended flag、原CPW未CREATE_SUSPENDED、scope/thread/输出槽、seq/nonce/resume_id都要匹配；ACK仅一次，exact schema。
- attach/load后必须收到明确installed，再proof child/parent活体与thread count1、entry marker仍unset，才ACK原resume。
- 两次count1不证明期间没有SDK内部变化；Python wrapper marker不在进程首条指令。检测到异常应保真失败而不是调整ordinary flags取绿。
- JS异常可能让hook callback unwind从而继续原调用；不能把throw当安全park。案例JS01在send和recv.wait故障均失败，永久禁Native。
- JS02诊断Sleep(0xffffffff)+无返回fallback仅有VM证据，可能占1CPU；必须独立owner先Term，不靠同目标JS timer/RPC。fault不返回不能声称finally恢复lastError；正常返回才有此证据。

## E. SDK对象与关闭顺序

建议状态协议：RUNNING → ACQUIRE_CLOSED → TARGETS_DEAD → QUIESCED → TEARDOWN → SEALED。

1. 预分配slots、每slot单acquirer；worker获得对象后立即登记，在cancellable context退出/on/load之前。timeout失去返回值不能失去lease。
2. 禁止新的acquisition；Term innerJob严格True，完整非空held PID→Wait全为整型0。失败skip SDK，不能用稍后outer Term洗白。
3. cancel所有登记tokens、停timers、join workers；不能持lease锁join。以is_alive=False确认，不把cancel请求/join调用当停止。
4. 全部停止且admission关闭后才snapshot leases并进TEARDOWN。仍live就fault，外owner兜底，不卸可能仍在使用的对象。
5. unload/detach/manager.close属于新cleanup operations，亦需记录、fresh token与第二次settle；dead InvalidOperationError只对明确allowlist成立。
6. callback off、quiet、manager close、script destroyed、配对收齐均不证明general drain；可能整对未收到。原生内部未返回对象、外部服务helper不由lease保证。
7. 已死目标不要求再RPC stop或最终snapshot；协议要支持自然退出，不从阻塞fixture推导CLI必可死后RPC。

## F. 权威终态

Controller只输出candidate，不能自产authoritative pass。

- 独立无Frida supervisor持新outer Job与strong-nonce manual-reset failure Event；deadline在Controller可阻塞启动前生效。watchdog与主线程对Term/Close有明确单owner，不能并发close/复用。
- Controller任何fault先SetEvent再取Python锁/记账；Set失败立即固定非0 ExitProcess，不能仅raise被SDK吞。event句柄由OS在进程死亡收回，不提前关，不Reset。
- EVENT_MODIFY_STATE也允许Reset；“不reset”为源码契约，非set-only ACL。nonce不防恶意同用户。
- owner必须使用原held Controller句柄确认Wait0与exit0后查sticky unset；candidate有nonce/pins/strict schema，missing/partial/过大均failed或unknown。
- outer Term/active0/held全Wait0/Close全部完成，且owner deadline与COMMIT_READY短临界区仲裁、watchdog停止后，才最终发布。event最后Close失败/写flush-close失败不可残留可消费假pass。
- PID集合严格等于bindings/held/cleanup，恰2正uint distinct PID及2整型0 waits；拒empty-all、bool、重复、错集合。
- outer保障只限实际Job-contained descendants；nested Job、外部helper、全部Native硬墙钟未知。报告限制不能删。

## G. 抓包与TCP字段

- GetExtendedTcpTable全表仅瞬时内存，先PID过滤再输出；query前后fresh own/live交集，未知own endpoint只count。resize/错误/异常路径finally清零断引用；traceback可能延长raw生命周期。
- pdwSize不随意改称实际字节数；端口不能靠未证高16推断；IPv6含scope。size/count/行stride须按当前SDK ABI。
- 536次GetTCP只是该包装的次数，268 erased allocation计数不等独立readback检零，更不是所有副本secure erase。
- SYN字段可能是True/False，不是1/0。TShark字段名称先发现再精确过滤，不在含secret的全文上做宽泛输出。
- TLS1.3 `tls.record.content_type==23`为0不等没有密文；核opaque_type。opaque23也不保证内层应用/HTTP。未见ALPN offer不能推断selected ALPN。
- TCP重传不是API retry。DNS快照是公开候选，不证明未来cache/proxy/route；临启动fresh一次并digest绑定，不反复拿旧snapshot做DNS门禁。
- 原native TLS与MITM/Frida证据分层；不改全局CA/代理/filter，不导TLS key取巧，不停止他人capture。
