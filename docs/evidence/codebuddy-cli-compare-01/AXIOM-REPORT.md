# Axiom 同文本真实对照 01：失败，claim 已耗尽

固定 codebuddy-cn / deepseek-v4.1-flash / off。通过正常 Agent→ModelRuntime→Pi薄适配→真正native sender，不由CLI代发。预备fixture02/broken02/cut01/import01及AXIOM-READY通过后，唯一运行 `ulimit -c 0; node docs/evidence/codebuddy-cli-compare-01/AXIOM-RUN.mjs --live axiom-live.json`，自然exit1。禁止重跑。

## 实际结果

- 1逻辑/1物理模型请求，HTTP200，663B；0refresh/辅助请求；observer1对，activeBodies0。
- 模型/off/stream/同prompt/tools0/max256/正常OAuth/UA `CLI/2.179.0 CodeBuddy/2.179.0`及身份关系检查通过。
- assistant error、无精确marker；诊断 `codebuddy-failure / stage=stream / partial=false / protocolCode=terminal`。不是功能成功。
- 两帧模型回显都正确。首帧delta存在role/content/reasoning_content/tool_calls/function_call/refusal，contentLength0；第二帧无role，contentLength2。两帧finish投影均为other，未观察到DONE。
- Agent settled、runtimeDisposed、configUnchanged；无部署/重启。

## 对照与局限

官方01同模型同prompt真实返回精确marker、CLI自然exit0；其请求max_tokens128000、temperature1、gzip和内置system/context/extra_vars/cache_retention不同。Axiom使用明确安全system、max256，无删除调用方上下文以伪造一致。两端UA/目标/off/身份关系匹配，功能结果尚不匹配。

本次投影只存字段键，未存null/empty/type谓词；不能将function_call键存在推断成null，也不能把finish=other猜成空串。当前核心静态代码会拒绝function_call:null、tool_calls:null和空finish_reason；需新证据核实具体兼容缺口。

**观察纠错**：`responseExit=eof`只是包装reader的结果。cancel先await reader.cancel再记录，可能被并发pull done抢记eof；合成复现见[取消审查](../codebuddy-stream-fields-01/STATIC-AND-SYNTHETIC-REVIEW.md)。不据此宣称上游自然EOF。`textLength=0`也受投影遇unknown finish后停止累计影响，不代表接收文本字节为0。已耗尽case文件保持原样。

完整白名单证据：[axiom-live.json](axiom-live.json)、[claim](axiom-live-claim.json)、[readiness](axiom-readiness.json)。后继观察在独立02目录，旧工具SDK01的根因仍未确认；不得把这两个失败自动认定为同因。
