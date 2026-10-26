# 不重启加载路径与边界

用户明确授权仅本次Qoder补丁应用及经Axiom复验。已确认当前4317进程PID28732，直接子进程agent-worker路径F:/Axiom/axiom2/app/dist/server/agent-worker.js。仅原子替换qoder-sse.js与其source map，旧文件备份见[applied.json](applied.json)。source map将隔离构建相对路径调整为生产目录相对路径，不改执行JS。

只读核查：agent-worker → model-service → model-runtime动态加载providers/qoder.js → 静态import qoder-sse.js。新sessionId不能使用其他会话已绑定的agent实例；未绑定预热agent仅process warm，首次绑定才动态创建runtime，因此替换后新会话可首次读取补丁。worker profile hash不覆盖provider依赖，不能保证旧会话更新。已加载模块的旧会话保持ESM缓存；本轮没有终止它们或重启server。

新测试sessionId 7b50a829-c07c-42b8-9f2a-35546d7df053，run bc71926d-a0ca-4dec-b614-9a5c7e98e028。运行结果未验收成功：外层model.response记录200，但随后流错误被报告403，无model.first_event。不能把403标签误认为HTTP外层拒绝，也不能直接断言登录过期。待安全结构诊断及后续Axiom验证。
