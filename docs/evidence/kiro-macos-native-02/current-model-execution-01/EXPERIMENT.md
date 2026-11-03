# 当前KAS单模型调用边界：静态局部

问题：首个候选请求是否可能是title/换模路径，哪些代码guard能限定正式deepseek-3.2主请求。只消费已提取并与旧归档逐byte相同的当前public acp-server.js；不启动official/提取JS/Node，不读任何账号或真实配置，不改engine，不扩大native研究。

源 `/private/tmp/kiro-current-kas-member01-k5vna1mo/node_modules/@kiro/agent/dist/server/acp-server.js`，15025207B/SHA bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1。前后sameFD stamp及完整SHA；只读一次≤15025208B，提取源码总window≤24576B，输出单文件≤32768B。候选沿既有entry-model-evidence定位：固定[14778851,14783400)补全model pin到title结束；另精确MODEL_FALLBACK_REFUSAL/MODEL_FALLBACK_AVAILABILITY/fallbackChainsCache/dpd[/session.title.llm/fetchFallbackChains(共6needle，每needle≤8、总hits≤32，每hit前后384B，merge后总cap。达到cap就结束失败，不扩大同case重跑。PythonCPU3/4/alarm6/tool10，CreateNew RUN.lock一次；无系统工具/REA全分析。

成功只表示这些public静态窗口已绑定并可读，不是runtime配置/当前触发/模型可用/天然一次推理证明。若仍缺直接caller/guard，明确缺口后另定有界读；不执行bundle填补。后续结论需要辨别标题模型、主模型显式选择、refusal/availability切换，不能把字符串存在当发生。
