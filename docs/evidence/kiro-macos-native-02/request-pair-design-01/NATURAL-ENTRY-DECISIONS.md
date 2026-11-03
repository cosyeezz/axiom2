# 自然入口接续决策（尚未运行）

正式pair0/实证修复0。用户明确继续既有可推进候选，主只推进自然观察入口；未恢复失败/放弃/耗尽gate，没有应用或模型启动。以下来自公开源码，只为一次受控worker请求，不扩内部调度研究。

## Axiom启动接口已足够定位

- execution-protocol.ts全文：没有workerInstance时acceptsLease允许legacy IPC；但required executionGate要求lease+instance。正常gate发binding_ready、等待匹配execution_permit或stop/shutdown/disconnect/30s超时。不是物理请求上限。
- execution-pool.ts仅1–260：fork PreparedEnvironment.workerPath，cwd/execArgv/env来自该对象，并追加实例/代际/profile；前三stdio ignore，第四ipc，Mac detached。binding_ready后正常复核环境再permit。没有审整个pool/退出闭包，也没有执行。
- execution-profile.ts全文：源码模式使用agent-worker.ts和--import tsx；编译模式agent-worker.js。env正常继承process.env，设置AXIOM_PI_DIR、AXIOM_MODEL_PROVIDER及accountBindings快照。正常resource/model定义身份在RAM和自身私有snapshot中使用；观察报告不导出这些hash/env/path。
- **禁止独立new ExecutionProfiles(正在使用的真实root)**：constructor会清除root/execution-models中匹配文件，并依赖Store service lock。本观察器不拥有该锁，不能拿真实root试运行，也不能擅改该生产实现。换空root又会改变root/pi资源与context，不能冒充完整normal输入。
- agents.ts735–799已读：正常host prepareAsync→pool.acquire(bindingGate)→环境/文件复核→commit；auth属于真实请求、不在资源准入。
- agents/runs.ts565–624已读：实际child.send({type:'start',input,lease},callback)；send返回bool只backpressure，callback错误也不能证明未送达。原full-context WorkerInput路线继续有效，不能瘦化成user-only provider。

因此不再为了启动反向追完整pool。正式caller仍待选定：复用现有正常host入口，或明确标注范围的现有worker IPC兼容入口；后者不能冒称完整host生命周期，也不能继承当前会话的instance/lease冒用所有权。此文件未决定绕过正常准入或把legacy入口当已验证替代品。

## 观察器接口与仍缺项

重读first_request_window.cjs/private_pair.cjs全文，未改且未重跑已有验证。installWindow只显式endpoint/deadline，不自动role验证；同步安装、first candidate后microtask关闭，done不是owner终态。createPair只比较首候选原始body/header文本，scope硬编码unknown；source身份/精确deepseek与实际出站/服务器receipt均不因此成立。库释放原body后只留固定比较结果，不能事后从报告凭空取得模型ID或认证scope。

body_pair.cjs全文已实际read：currentModelId只输出两侧存在性/相等性，不能证明值为deepseek-3.2，不返回raw值。可考虑在仍持有候选的受控RAM处，用既有compareRequestBodies与公开目标模型参考对象比较该字段；此选项未实现/测试，不改输入，不需重写parser。下一将正常worker启动选择、首次观察来源、完整受控输入、目标字面检查、独立deadline与secret-safe结果落实为有限runner合同。用户最新要求交付进度后新开会话执行，本会话停止实验，只完成交接；完整接续见上级docs的kiro-native-request-progress-handoff.md。若投影不足，只补直接必要缺口，不重复已有PASS或扩程序闭包。单模型侧title selector/严格env parser已静态核，但实际继承/registry优先级/fallback caller还未知；不能把envfalse当已证禁用，不补runtime01 prompt找hook。

## 当前证据边界

上述新增源码阅读未做额外SHA快照，原fresh入口11文件267426B快照仍保留，不能把它扩成覆盖execution-profile/pool/protocol。此次定位rg实际exit0；读取与保存公开说明不是模型实验。无活动子任务/测试/后台进程/REA目标；生产未改、真实配置未改、账号文件未由agent打开。source-capture与两个静态model case门禁均仍耗尽。
