# 当前KAS的主模型、标题与fallback边界

本轮是静态源码窗口，不是实发。唯一[执行结果](TOOL-RESULT.json)actual0/.2s，内部.068563041s；[RESULT](RESULT.json)记录sameFD前后stamp同、完整15025207B/SHA bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1。该三public成员已由[current member证据](../current-kas-member-01/SUMMARY.md)绑定当前2.36明确frame，但不证明自然native使用。

[合同](EXPERIMENT.md)、[driver](inspect_once.py)、[manifest](MANIFEST.json)先存；driver2944B/SHA e83928b0e4617c88bafd0ccc126adc971c522aa0e4799c7d0d4e4df4858d0a09。六needle共21个命中、9个合并窗口/12118B，输出[EXCERPTS](EXCERPTS.txt)12539B/SHA 2e9deef22a5445a299f4fcdf1e8e6a2ef551c0a2b3dcad574372bb1608b3c070。只读public源码15025207B，official/JS执行0，CPU3/4/alarm6/tool10未超限；Python PID/whole-author/OS-loader读取未记录。gate已消耗不重跑。

## 已核静态内容

- `[14778851,14784118)`含完整`kickoffLlmSessionTitle`：先清generationId；若`process.env.KIRO_DISABLE_SESSION_TITLE_LLM === "true"`或session feature `SESSION_TITLE_LLM`不启用则直接return。否则创建`Gx(Xs,CL,Det,...)`/`ejt(Yu(Xs,CL),...)`、独立AbortController和unref timer，异步generateTitle。`CL`实际模型ID、本方法caller/触发时序尚未核，不把它猜成deepseek或某Claude。
- `[14573307,14574142)`显示title `invoke`经`F1`与`Ce("invokeTitleModel","llm",...)`调用modelClient.invoke；这是模型调用候选，而非本轮观察到运行。它不受“首candidate一定是主prompt”的假设保障。
- `[14787098,14788120)`：`buildModelFallbackService`将enabledTriggers动态构为`dtt.filter(r => e.featureConfig.get(dpd[r]))`；autoRefusal由`MODEL_FALLBACK_AUTO_REFUSAL`取值；loadChains是cache.get的callback。FIi实现/disabled时是否会加载chains及实际调用仍未核。
- `[14684471,14685305)`映射refusal/availability两feature；`[8373367,8374279)`映射三个公开env名`KIRO_FEATURE_MODEL_FALLBACK_{REFUSAL,AVAILABILITY,AUTO_REFUSAL}_ENABLED`，**尚未核bool解析和优先级，不直接设置false并声称禁用**。
- pinSessionModelId已有e.modelId则直接返回，否则pending profile及GVt缺省目录路径。此前显式选中优先结论与本窗相符，但native如何传model、目录可用性和当前effective值仍未知。

## 下一与限制

下一只补直接标题caller及CL声明、fallback FIi/feature-env解析必要窗，围绕精确deepseek主请求的执行合同；不扩成内部会话/压缩研究。已知title-disable字面guard是可验证候选，实际环境继承未知；不在真实进程擅用未核flag，不发prompt。本轮不是无fallback/无多模型的运行证明，也不是完整全程序调用枚举。实发pair0/实证provider修复0不变。
