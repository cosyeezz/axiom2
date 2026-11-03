# 新请求适配器：有限自有传输验证

**不是官方请求采集，也不是 Axiom 正常端到端或服务器等价验证。** 原件由主代理完整读回，源身份、计数、退出及逐字节归档已核；归档工具实际 numeric exit=0，未重跑测试。绑定见 [ADAPTER-SOURCE-BINDING.json](ADAPTER-SOURCE-BINDING.json)，归档工具结果见 [ADAPTER-ARCHIVE-TOOL.json](ADAPTER-ARCHIVE-TOOL.json)。原两个 fixture 的 tool numeric exit 都 **unknown**，不能由 shell/child 成功补成 0。

## Node HTTP adapter own01

t12042/r12045。原 root `/tmp/node-adapter-own.D8IRylC7`，0700；命令 `/usr/bin/python3 /tmp/node-adapter-own.D8IRylC7/controller.py`。

- 1 个 Node held 57964，实际 wait exit 0，双 EOF，stdout/stderr 171/0B。实际 v22.23.2/darwin/arm64。
- **12 cases / 12 PASS，4 个自有 HTTP 请求**。HTTP 和 HTTPS 各 control/instrumented 一对；127.0.0.1:55463、55466。合成证书一次生成 exit0，未保存该子 PID；自有 CA 与 servername=localhost，无禁证书验证。
- 请求原始 HTTP1 header/body 在 RAM 相等，捕获值与 server bytes 相符。真实 end 返回/callback 次数、参数数目及 receiver 两组结果相同。listener 检查仅原有引用前缀，不是全事件集合严格相同。
- 十个独立 fake-prototype case：original throw identity/this/args/一次；Buffer 与 write unsupported 但原 API 执行；reentry/repeat；saved wrapper after-close sticky；sink throw；candidate/call cap；新 descriptor owner 冲突拒覆盖。
- 11 次完整 descriptor 恢复，另一个为预期冲突。未覆盖 body/header/aggregate/record cap、非 configurable 安装等边界，不补跑。
- manifest 保存最大次数及完整 harness SHA，具体 cases 在执行前已保存的 harness 内，报告只有总计、没有逐 case ID；不能宣称 manifest 本身含逐 case 清单。
- controller elapsed .187s 包含证书与 Node；不是 whole-author/task wall。源阅读总实际字节未单列，预算不是实测读量。

原件：[manifest](node-adapter-own01/manifest.json)、[controller](node-adapter-own01/controller.py)、[harness](node-adapter-own01/harness.cjs)、[result](node-adapter-own01/result.json)、[AUDIT](node-adapter-own01/AUDIT.json)。未复制合成证书/key，也未读真实 TLS key。

**Memory correction — r12045 的“每管道64KiB硬接收上限”不成立：** controller 限制 bytearray 保留并在超限后 kill，但每次仍可读4096B，且后续继续 drain；也没有超时后最终 drain 的独立硬 deadline。实际本次171/0B均在阈值内、双EOF/exit0不受此纠正影响。不能把 fixture collector 直接作为 live collector 或完整监督协议。

## Undici Client.request adapter own01

t12043/r12053。原 root `/tmp/axiom-undici-own-l1nqvz02`（controller resolve 后 `/private/tmp/...`），0700；命令 `/usr/bin/python3 /tmp/axiom-undici-own-l1nqvz02/controller.py`。

- 1 Node held58374/wait0，实际 v22.23.2/darwin/arm64，双EOF，stdout/stderr3597/0B。1 own OpenSSL held58373/wait0。controller elapsed .204s，不是 whole-author wall。
- **12 named cases / 12 PASS**：6 个 Client.request(string) 请求 case（H1 HTTP、H1 HTTPS、H2 HTTPS，各 control/instrumented），6 synthetic cases。服务器实际收到6次，端口55502/55505/55508，非模型请求。
- 所有 pair 的 server body 和 `rawHeaders` 数组相同；后者是 Node server 暴露的 header 值数组，**不是完整原始 wire 字节**，尤其不是 HTTP2 HPACK/frame。同一 instrumented case 的捕获 header 等于另一个 DC listener 收到的原值，body bytes 等于服务器正文。
- H1 DC header 没有自动 Content-Length/Transfer-Encoding，而服务器有 Content-Length；保留这一缺口。H2实际2.0，标为文本视图；没有伪装成HTTP1。
- synthetic：duplicate/missing bodySent、sink异常、invalid UTF8、native typed-array getter零触发、Shared/Resizable拒、copy helper字节cap、128callback cap、OAuth path不入sink。部分检查共用一个 named case，不拆成更多 case。
- API reference 不变；仅 `hasSubscribers` 状态回到基线，不等完整订阅数组/顺序字面相同。saved late callback、DC aggregate/chunk/record/candidate/header cap、原API thrown identity未测。
- controller 仅对 stdout JSON parse 后保存，未做闭合结构校验；主已读回本次固定结果并核无raw。其 read 上限采用剩余预算加1来检测溢出，超限后可继续读取至停止期限；是检测阈值/有限保留，不是精确硬receive cap。实际3597/0B在阈值内。

原件：[manifest](undici-client-own01/manifest.json)、[controller](undici-client-own01/controller.py)、[harness](undici-client-own01/harness.cjs)、[controller report](undici-client-own01/controller-report.json)、[results](undici-client-own01/results.json)、[OpenSSL config](undici-client-own01/openssl.cnf)、[AUDIT](undici-client-own01/AUDIT.json)。源和前后SHA均核一致，未复制测试key/cert。

## 尚未覆盖的正常调用入口

以上 Undici 实际 caller 是 `Client.request(string)`，且路径为 `/v1/responses`；**不等已覆盖 Axiom 的 `fetch` body stream generator 和 `/`+x-amz-target 过滤**。同 t12043 追加独立新case，仅覆盖之前没有执行的fetch+root-target；原case未重跑，源未改。结果 r12059 已matched消费，主完整读回六原件并核验、exclusive逐byte归档：[AUDIT](undici-fetch-own01/AUDIT.json)，[归档工具实际exit0](FETCH-ARCHIVE-TOOL.json)。

### Undici fetch own01

原root `/tmp/axiom-undici-fetch-root-3iwdifxb`（controller resolve为/private/tmp）；命令 `/usr/bin/python3 /tmp/axiom-undici-fetch-root-3iwdifxb/controller.py`。1 Node held62283/wait0，实测v22.23.2/darwin/arm64；1 OpenSSL held62282/wait0。双EOF/stdout5563B/stderr0，controller .277s，不是whole-task wall；actual tool numeric仍unknown。

**6 named cases/6 PASS、6 fetch请求/6 server请求**，H1 HTTP/H1 HTTPS/H2 HTTPS各一对，端口55886/55889/55892。实际`undici.fetch`+own Agent，POST `/`带精确target、非ASCII primitive JSON string、redirect:error。TLS ownCA/servername localhost、未禁验证、未install替换globalfetch。

每请求1个bodyChunkSent（chunk为own data property且与header同Request）及1个bodySent；三个instrumented各提交1candidate，原header值相等、body等于serverbody、faultnone。server rawHeaders只是数组不是wire原字节；H1自动framing缺口仍在、H2标2.0文本view。fetch/dispatcher reference不变、fixture订阅unsubscribe成功、hasSubscribers恢复（不等订阅列表全等）。

原件：[manifest](undici-fetch-own01/manifest.json)、[controller](undici-fetch-own01/controller.py)、[harness](undici-fetch-own01/harness.cjs)、[results](undici-fetch-own01/results.json)、[controller report](undici-fetch-own01/controller-report.json)、[OpenSSL config](undici-fetch-own01/openssl.cnf)。stdout bounded-retention、+1检测余量、stderr只计数；controller没有闭合JSON校验，主本次读回确认fixed projection。未复制合成key/cert。六原件SHA、前后当前四源SHA及case名单均核匹配。

此补测覆盖安装Undici库的fetch发送body路线，不是运行Axiom provider或正常app；未验证Axiom最终context/auth/dispatcher条件。官方自然安装、当前sender、账号scope、完整header、owner终态和实际模型请求仍未验证。
