# 官方流字段补证02

固定官方CLI2.179.0 / macOS / 既有CN OAuth / deepseek-v4.1-flash / off。readiness通过后唯一实发；claim已耗尽，禁止重跑。

## 实测

官方child自然exit0，最后assistant精确marker。实际模型1（200/4849B）、geo/catalog各1（均200），refresh0，遥测外发0。请求目标/off/UA/身份/认证检查通过，gzip12466B、max_tokens128000、temperature1，内置上下文保留。活动请求0、子进程退出、runtime disposed、临时目录删除、配置不变。ownedListeners=1是进程exit事件前值，不表示提前显式关闭。

这次所有流出口保存了白名单：13个JSON帧、最后stop、随后DONE、累计26字符精确marker。前12帧 `finish_reason` 是**空字符串**，`function_call` 是**null**，`tool_calls` 空数组；`reasoning_content`/`refusal`空字符串。最后帧 `function_call` 是**object**，但未记录内部字段，因此不能认定具体为空对象或空name/arguments。最终usage为prompt6765/completion11/total6776/cache0。

## 验收边界

runner exit1，`strictTerminal=false`/`RESPONSE_INCOMPLETE`：观察器将末帧非null legacy对象视为不允许的调用。官方功能成功与观察器验收失败分开。传输出口aborted→error→close；不宣称自然EOF。完整SSE结构保存解决了01丢失投影的问题，但不是完整raw wire/TLS证据。

证据已足够确认当前Axiom对null function_call和空非终态finish的兼容缺口，不继续发官方请求。Axiom最小修复仍要求stop/tool_calls+DONE+干净EOF及工具严格schema/审批；空legacy占位只允许已知name/arguments缺失/null/空串，非空或未知字段拒绝。末帧对象内部形状待修复后Axiom独立SDK验证记录，不能回填到本次观察。

## 预备检查

最终fixture02与真正CLI DONE后取消fixture02自然exit0；tap-proof02十例、guards02十三例+5投影+正常Pi合成refresh、import-proof02封网封写均通过。初版观察器允许独立error/close被审查发现，已收紧后复验；所有01/02预备证据保留。当前改动只为观察，不是生产工具候选终态放宽。

完整产物：[official-live.json](official-live.json)、[claim](official-live-claim.json)、[readiness](official-readiness.json)、[合同](CONTRACT.md)。前序[Axiom失败对照](../codebuddy-cli-compare-01/AXIOM-REPORT.md)。无部署/重启。
