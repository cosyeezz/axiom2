# Qoder 缺少 choices 失败调查

## 真实基线
通过 Axiom 现有 UI（http://127.0.0.1:4317，独立测试会话）调用已配置的 Qoder 国内版 GLM-5.3，思考等级 high。提示词要求不使用工具，计算17×19。实际显示323，随后“Qoder 事件流缺少 choices”，会话失败。不是curl/SDK/官方CLI绕过Axiom的测试。见[live-baseline.json](live-baseline.json)。未获取触发错误的原始帧，不能断言其具体字段。

## 静态证据
官方1.1.78 bundle SHA256 ec7b2a2c1be206f525ca974c3b9455fbec9ce7411bc5dfdee55f1e82eb90df38。静态摘录及常量解码见[research/provenance.json](research/provenance.json)，只用AST解码字符串，不执行bundle。
- [fRe.decoded.js](research/fRe.decoded.js)：先检查error，无choices?.length则处理可选usage并continue；不能将“每个JSON事件都应含choices”当协议要求。
- [K2.decoded.js](research/K2.decoded.js)与[LEA.decoded.js](research/LEA.decoded.js)：包装内空白body、DONE、quota、notification属于可忽略控制内容；finish事件仅豁免包装状态检查，不能替代choice finish_reason。
- REA本轮只分析上述3个派生片段，3/3解析、0解析失败、2894 AST nodes、775 semantic unknown；22个inventory文件未分析，图覆盖partial。父证据ev_a6a3bc0915524b8c8f5ee33fefe117041446ec023bb15ed39085ed4737205006，摘要ev_4bd47908b83d39cef3e837320b700a8960bc70e6a6a4e4171a52810020bfb2ec。静态证据不代表运行观测。

## 源码补丁边界
适配包装内控制标记/空白body，以及空对象和受限的无choices元数据。与官方无条件continue不同，本地继续拒绝未知含内容的JSON、非法choices类型、业务错误和排队；保留工具参数终态校验、结束冲突/结束后内容检查和缺finish拒绝。新增离线回归覆盖正文/思考/late usage与工具参数分片前中后的辅助帧。

只读复审发现第一轮两项边界（已修正）：已有usage路径绕过metadata检查、新扩展泛通知前缀绕过包装状态检查。最终代码对缺省/null/空数组choices统一检查metadata，usage不能绕过；仅保留原有明确`[NOTIFICATIONS]#`通知的协议提前处理，泛通知在包装状态检查之后。负例覆盖usage+未知字段、严格queue边界及finish前后出现错误。复审确认两项均已消除；第一轮日志tests.log/typecheck.log/server-build.log保留为历史，最终验证见下。

## 验证与部署
兼容补丁8文件离线回归53/53通过、exit0（30.58s），见[tests-final.log](tests-final.log)，当轮[typecheck-final.log](typecheck-final.log)及[server-build-final.log](server-build-final.log)退出0，只读复审通过。随后用户明确选择允许应用并复验，授权已取代此前未获准部署的限制，但若需重启仍须另问。

仅对运行目录的qoder-sse.js/map做原子替换，旧文件均有备份：[首次部署](deployment/applied.json)、[诊断版部署](deployment/applied-diagnostic.json)。source map路径按生产目录调整。没有全量覆盖dist、重启server或终止旧会话worker。4317父进程部署前后均PID28732，子worker绝对路径确认是本仓库app/dist/server/agent-worker.js。

## 修复后真实调用
- [第一次](live-postpatch-attempt-1.json)：GLM-5.3/qoder-cn/gmodel/high，新独立会话；无答案，错误403。通过Axiom自带window.axiomLatency确认外层响应200而非HTTP层403，不能直接断言凭据过期。
- 为定位增加固定枚举`sse_wrapper`错误后缀，仅输出包装status、事件类别、正文类别、有限数字业务码，不含raw正文、凭据或自定义event原值。第一轮新诊断测试52/53，唯一失败是夹具换行转义错误；已修正（同时修正诊断数字字符串regex）并保留[历史日志](tests-diagnostic.log)。失败夹具版未部署。
- 最终诊断版受影响Qoder4文件29/29通过、exit0，见[tests-diagnostic-final.log](tests-diagnostic-final.log)；[typecheck-diagnostic-final.log](typecheck-diagnostic-final.log)和[server-build-diagnostic-final.log](server-build-diagnostic-final.log)均0、无诊断。其余不依赖Qoder的24项此前通过、源码未变，无须重复。
- [第二次](live-postpatch-attempt-2.json)：又一新独立Axiom UI会话，同模型/等级/题；外层200，随后`[sse_wrapper status=403 event=message body=json code=403]`，无答案、无工具调用。[阶段记录](live-postpatch-latency-2.json)。新诊断后缀证明新版解析器已执行。没有使用脚本直连真实provider，没有重启、读取或输出凭据。

## 当前阻塞与结论
兼容补丁已应用，部署动作验证通过；**线上修复验收未通过**。当前是明确的流内403拒绝，不能靠跳过辅助帧或改成成功解决。403本身不能区分认证状态、账号地区、模型权限、服务端校验等原因；需要用户检查Qoder国内版账号/GLM-5.3权限或提供已恢复可调用状态/服务端403原因，必要时在Axiom重新登录后通知继续。不能代用户伪造身份或忽略拒绝，也不应盲目重放。原真实缺choices帧仍未知；不保证受限补丁已消除原故障，也不证明服务端思考等级采用。
