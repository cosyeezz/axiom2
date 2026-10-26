# Kiro 2.12.0 聊天静态证据

只读对象：C:/Users/dane/AppData/Local/Kiro-Cli/kiro-cli.exe，528630968 bytes。
SHA-256：0ff1d24eea11aa2e244524d635e1cfc8f9820522f4c5bc192fb99590d909320a。反汇编后重新计算一致。以下 offset 均为原始文件偏移，不是 RVA。

已确认静态证据：
- x-amz-target @0x5d7ddaa；AmazonCodeWhispererStreamingService.GenerateAssistantResponse @0x5d7ddb6；application/x-amz-json-1.0 @0x5d7dd90。操作函数 0x140bdacc0 内，0x140bdb355 引用 header key，0x140bdb3ab 引用 target，随后 0x140bdb3dc 调用同一构建 helper 0x140bea350。见 operation.asm.txt:442、463、476。
- 同一操作函数 0x140bdb488 调用 0x145acddf0；其 0x145acde7b 调用 0x140b83e60。后者输出 JSON 对象字段 conversationState(0x5d758e4)、profileArn(0x5d758f5)、agentMode(0x5d758ff)、additionalModelRequestFields(0x5d75908)，有条件省略分支。
- conversationState 调用 0x140b82340，含 conversationId(0x5d7574c)、history(0x5d75765)、currentMessage(0x5d7576c)、chatTriggerType(0x5d7577a)。MANUAL 枚举字节 @0x5d7579e，未证明默认取值。
- currentMessage 在 0x140b82515 调用 0x140ba15c0；该函数处理 userInputMessage(0x5d78472)，0x140ba1654 调用 0x140b95c80。后者序列化 content(0x5d763be)、userInputMessageContext(0x5d7752a)、origin(0x5d77617)、modelId(0x5d7762c)，context 包含 toolResults(0x5d776cd)、tools(0x5d776d8)。这些字段层次有指令和调用支撑，不只是字符串邻接。

仅端点候选： https://runtime.us-east-1.kiro.dev @0x1b76d9a0/0x1b8ec098；https://runtime.eu-central-1.kiro.dev @0x1b76d9f8/0x1b8ec0f0。还有 q.us-east-1.amazonaws.com 常量。没有完成 endpoint 与操作绑定、区域/账户/API key 分支追踪。

未知：HTTP method/path、认证 header、字段必填及默认值、模型可用性、事件流解码和实际聊天成功。QDeveloperSendMessage 仅枚举字节，不能证明 SendMessage 网络协议。未借用 catalog 证据。

验证：工作目录 F:/Axiom/axiom2；node scan.cjs、xrefs.cjs、calls.cjs、report.cjs 均 exit 0。Microsoft dumpbin /nologo /disasm /range:<VA>,<VA> <正式EXE> 六段均 exit 0；完整前五段命令见 dumpbin-runs.json，第六段为 /range:0x145acddf0,0x145acdf30（截取范围，不是完整函数）。详细证据见 report.json/xrefs.json 和 *.asm.txt。未运行目标或真实 API，未读账户、未修改共享代码/REA。
