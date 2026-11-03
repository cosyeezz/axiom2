# 当前Axiom入口复核（限定源码范围完成）

仅源码与SDK文档定位，未启动应用/provider/模型请求，未直接读取账号或真实模型配置。正式pair0。Pi文档locator单次[actual0/.4s](DOC-LOCATOR-TOOL.json)，仍1.4.0；脚本显式调用仅package/doc路径函数，不把它当运行认证验证。此前README/custom-provider/sdk完整阅读记录可参考；本轮没有重新全文读这些Markdown。

## 已读范围

- model-runtime.ts全文；model-service.ts 1–270/710。
- agent-worker.ts 80–239、500–769、770–1119、1230–1349/1441；不是全文。
- model-account-storage.ts全文（1–89及90至尾分次读取）；integrations/model-proxy-env.ts、data-root.ts全文。
- providers/kiro-chat.ts全文（272行）；providers/kiro.ts、provider-request-observer.ts全文。
- agents.ts 535–714；agents/runs.ts 1–110、245–344。
- Pi skill及documentation-paths.mjs全文；请求基线/parity skill本轮重读。

阅读后按[有界合同](SNAPSHOT-CONTRACT.md)完成唯一公开源码保全：[实际工具0/.1s](SOURCE-CAPTURE-TOOL.json)，内部.003444667s，11文件/267426B；[SOURCE-BINDING](SOURCE-BINDING.json)逐文件完整SHA、sameFD前后stamp及副本逐byte/readback相同。完整副本在[source-snapshot](source-snapshot/)，每件0400。此为post-read snapshot，不证明早前每次read与快照逐byte同、跨文件原子版本、编译产物或实际加载。没有启动应用测试/构建/服务或改生产文件。source-capture gate耗尽，不重跑。

## 当前结论

1. 完整上下文仍在worker内部async run(WorkerInput)构造：正常网络→ModelService.runtime→Settings/installed resource loader→本地主机权限与context/context_with_system hooks→openTranscript/createAgentSession→Axiom prompt/retry/safe-point hooks→bindExtensions/active tools→正常prompt。不能用user-only provider调用冒称该路线，也不必复刻存储/压缩。
2. WorkerInput有root/cwd/file/modelsFile/capabilities/memory/selection/prompt/history相关标志等；所读完整interface没有first-request-only字段。现有executionGate是awaitExecutionPermit准入，最终session.prompt是整轮；first-request observer不是模型执行budget。start由process IPC进入run；disconnect调用abort并有9s退让timer。完整stop/lease/单次执行合同尚未核，不把IPC中止意图当已经退出。
3. 缺model或定义错误会保存modelRequestError、保留逻辑虚拟选择；observedStream先throw该error再调用baseStream。这是正常UI保存意图的处理，不允许独立driver自造替代model。仍须精确kiro/deepseek-3.2与native api，正常model不可用报告不换模；本轮未验证实际可用性。
4. createModelRuntime的normal providerScope、accountRuntimeStores仍在。Kiro新包装区分native getAllModels与composed getModels；getAuth先assertKiroChatModel；stream/streamSimple丢弃旧axiom-kiro-native handoff option让SDK为每个物理请求正常取OAuth，不能自造/复用ticket或绕过包装。configurationOnly专门禁凭据与目录恢复，不是正常请求入口。
5. accountRuntimeStores只获取一次binding并路由AuthStorage/FileModelsStore；无binding返回undefined交给SDK默认。accountBindings前半已补：若AXIOM_EXECUTION_PROFILE和AXIOM_MODEL_ACCOUNT_BINDINGS同时存在，消费已捕获且经过object/UUID检查的binding；否则正常读取account index，legacy回默认路径。实际env和binding未读取，独立runtime的当时active选择不能自动视为与host冻结snapshot相同。ModelService.runtime使用this.dir下auth/store及指定modelsFile，allowModelNetwork=false/refreshOnCreate=false；constructor支持dirOverride和tilde归一化。dataRoot默认Mac Application Support/Axiom2或AXIOM_DATA_DIR；实际环境/root/账号没有读取，不根据memory路径猜。
6. configureModelNetwork来自integrations/model-proxy-env.ts，不是model-network.ts。正常配置选择Agent/EnvHttpProxyAgent，Kiro keepAlive60s/max120s，setGlobalDispatcher+undici.install；只有正常safe point可重绑。不得偷偷绕过代理。
7. kiro-chat仍经正常ticket消费→可选identity-center profile discovery→完整kiroChatRequest→thinking→onPayload→profile/model/origin守卫→JSON.stringify→受限header合并+Bearer/AWS header→正常fetch POST redirect:error。单次stream中的model fetch只有所读一处，OAuth/profile/外层retry/tool-loop不是因此被证明不存在。实际收到Response后会调用options.onResponse；当前observer不采完整wire，不能把这个callback当body逐byte服务器接收证据。
8. worker observedStream还调用现有normal account observer/latency与prefix bookkeeping；不改掉它们制造简化链，不宣称全应用没有磁盘写入或日志。其model-request事件发生在SDK auth之前，不能当认证/发送完成。IPC可能包含完整context，未来owner只能RAM+固定投影，不能原样落IPC日志。
9. Agents host先捕获modelsRaw、准备capabilities/attachments/skills/session/history，后传WorkerInput；AgentRuns会把environment snapshot复制成私有writable modelsFile，并启用executionGate。Agents host还出现titles.start调用（仅静态候选，未核实际模型调用）；直接worker采样与整个host/UI调用范围必须区别，不为此次重造会话层。

10. kiroProvider实例内kiroChat(kiroOAuth(options), options.fetch)共享正常auth/stream；catalog仅恢复通过当前scope/version的缓存，allowNetwork=false时不fetch远端目录。目录恢复不证明模型推理可用。
11. 请求统计仅workerInstance存在才安装；recognized native Kiro且stream引用未被换时包装onPayload/fetch。profile discovery在payloadReady之前，不计推理；统计start是fetch调用边界而非wire/receipt，完成只观测原stream.result，不消费/重放response。没有workerInstance的独立runtime不会自动有这些worker统计，不能用其缺失判定0网络。

## 下一动作与限制

本轮fresh入口问题已限定回答，停止扩展会话/压缩/调度；真实scope、模型可用性、完整输入等仍需正式运行合同。下一进入自然观察入口/正式runner：完整WorkerInput/自然安装与来源、精确模型、正常opaque账号/网络、请求计数/独立deadline及secret-safe结果。无须证明全应用不可逃后代；也不允许因没有first-request-only就擅删tools/context或复跑runtime01找hook。

一次导航rg包含猜测的不存在worker-pool/agent-host等文件，overall2且stderr被丢弃；只消费已返回锚点，不记完整搜索PASS。后由agents/runs实际import定位到execution-pool/execution-protocol，尚未展开，不恢复旧监督研究。t12094/r12095缺openai APIkey的委派已结束/消费，实际读取数unknown；主继续，不重启task/改登录。无活动后台/测试/REA目标。

Memory correction：早期FINDINGS/本会话详情把read工具的剩余行数提示推算成service711/worker1443/kiro-chat274行；快照按bytes.splitlines实际为710/1441/272，已纠正。该计数差不能被当作源码发生改变的证据。实际读取offset/range保持原记录。

另一处Memory correction：压缩摘要明确agents/runs 1–110/245–344、agents535–714及kiro-chat246至尾仅有工具调用、无回执，本报告初版却提前列为已读。随后已从source-snapshot实际read上述四窗补齐并核实相关结论；这些新回执不能被回填为初版时已读。
