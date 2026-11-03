# 新窄依赖：title caller与feature消费

沿current-model-execution-01已核内容，补三个直接依赖而不重跑旧gate：标题kickoffLlmSessionTitle的caller、全局CL赋值、FIi定义/直接调用。source仍是current-kas-member-01提取的acp-server.js，15025207B/SHA bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1；sameFD nofollow/前后stamp/全SHA，一次读取≤15025208B。

固定新窗[8372600,8378200)观察已定位feature-env表的邻接消费代码。三个regex：JS标识符边界CL=、FIi(、kickoffLlmSessionTitle(；每pattern≤8hit/总≤24，每新hit前后768B。title定义和FIi旧call所在两个已保全窗[14778851,14784118)、[14787098,14788120)复用旧EXCERPTS，不重复提取。merge后selected≤24576B/output≤32768B。

新CreateNew RUN.lock一次，CPU3/4/CORE0/alarm6/tool10，超限结束不扩cap重跑。只读public源码，不执行JS/Node/官方，不读真实env/账号/配置，不设置任何真实flag、不改engine/代理/CA，不启动REA全分析。仅回答直接guard/常量，足够即停，不做全程序单调用闭包。继承/有效配置/模型可用性仍须自然证据，不把static变成runtime保证。
