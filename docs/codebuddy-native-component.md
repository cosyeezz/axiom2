# CodeBuddy CN 原生组件

基准为官方 CLI **2.179.0**，不是 WorkBuddy 桌面协议。本轮固定 `codebuddy-cn / deepseek-v4.1-flash / off`。已完成独立核心、Pi 接线、公共入口与分发闭包；修复后真实SDK已完成2轮/3模型请求/1工具及下一轮续接。官方CLI已真实返回精确文本，两侧模型/off/UA和流字段有实际对照；不是同输入或字节等价，未部署/重启。见[真实对齐报告](codebuddy-native-parity.md)和[协议矩阵](evidence/codebuddy-native-component-01/PROTOCOL-MATRIX.md)。

## 入口与分工

源码：[公共 index](../app/src/native-providers/index.ts)；构建入口：`app/dist/native-providers/index.js`。不新增独立 npm 包或稳定包名承诺。核心只依赖 Node 和既有代理依赖，不导入 Pi 或 Axiom 会话代码。

| 入口 | 责任 |
|---|---|
| `createCodeBuddyNativeProvider(options?)` | `auth.login/refresh`、`getCatalog`、`catalog`、`stream`、`dispose` |
| `createCodeBuddyOAuth(options?)` | CN state/poll/refresh协议；无自动登录、存储或刷新调度 |
| `createCodeBuddyCatalog(fetch?)` | `get/refresh/invalidate/dispose`，仅RAM、账号作用域与epoch，目录≠权限 |
| `createCodeBuddyClient(fetch?)` | 单次原生请求/流解析/工具候选/取消；不刷新、不重试、不执行工具 |
| `createNativeAccount(auth, store)` | 可选独立账号生命周期；宿主实现事务安全存储 |
| `NativeContext/NativeStreamEvent` | 统一进程内domain契约，不统一供应商wire |

`options.fetch` 是显式测试/宿主传输覆盖，作用于该组件的认证、目录与推理；未提供时认证/目录使用Fetch，推理使用独立Node HTTP(S)。不要为了观测而用通用Fetch替换原生sender。`getCatalog`只读当前RAM或内置兼容声明；`catalog`显式发起网络刷新。两者返回 `permissionsVerified:false`。

## 独立使用

下面只声明函数，导入不登录、不发请求。宿主必须已有合法账号、调用预算和安全存储；`store`不是Pi credential store，**Pi接回时不能再叠此刷新owner**。

```js
import { createCodeBuddyNativeProvider, createNativeAccount }
  from "../app/dist/native-providers/index.js";

export async function* reply({ store, context, signal, sessionId,
  continuationId, validateToolInput }) {
  const provider = createCodeBuddyNativeProvider();
  const account = createNativeAccount(provider.auth, store);
  try {
    // 首次登录只在用户明确操作时调用 account.login(interaction)。
    const credential = await account.resolve(signal);
    const model = provider.getCatalog(credential).models
      .find(item => item.id === "deepseek-v4.1-flash");
    if (!model) throw new Error("所选模型未声明；不切换模型。");
    for await (const event of provider.stream({
      model, access: credential.access, context,
      options: { signal, sessionId, continuationId, reasoning: "off",
        maxTokens: 1024, timeoutMs: 60000, validateToolInput },
    })) {
      if (event.type === "error") throw new Error(event.message);
      yield event;
    }
  } finally { account.dispose(); provider.dispose(); }
}
```

- `context`保留caller system、历史、工具schema和安全约束，不替换为CLI提示词。带工具时必须提供完整严格schema验证器，返回未经coercion的原参数；支持不了就拒绝。
- `tool-start/tool-delta`仅预览。即使收到`tool-end`，也须等完整成功`done/toolUse`，再交宿主审批/执行；组件不会调用工具。回传需保留原call ID、tool name及完整结果。同一逻辑run的工具续接复用`continuationId`，下一run换ID；每次物理调用另有invocation ID。
- `identity`可选字段来自可信调用上下文，不编造Purpose/Runtime/设备/权限。恢复/辅助调用缺依据时不猜。坏类型、未知身份字段或受保护头覆盖本地拒绝。
- 账号切换/退出：宿主先取消活动请求，关闭旧provider/account，再按新账号重建。`account.logout`只管理其store，不代替provider取消；`provider.dispose`不删除凭据。组件目录可信`accountKey`可跨token轮换，否则只按RAM精确token区分，不hash/落盘。
- 认证/目录/模型请求分别预算。没有自动交互登录fallback、重定向或native模型重试；令牌刷新由唯一owner负责。

完整纯Node合成示例见[fixture](../app/tests/fixtures/codebuddy-component.mjs)，对应[测试](../app/tests/codebuddy-native-component.test.ts)。fixture会执行合成本地验证，不是生产应用或live harness。

## Pi 映射

[codebuddy-chat.ts](../app/src/server/providers/codebuddy-chat.ts)负责系统sections/工具增删归一化、Pi事件、严格schema和价格计算。正常OAuth/API-key路由产生60秒RAM单次票据，不能发给上游；每物理调用重新解析，目录API-key路径也先兑付。Pi原账号路由和锁是唯一刷新owner。

[codebuddy-cn.ts](../app/src/server/providers/codebuddy-cn.ts)提供动态RAM目录；[model-runtime.ts](../app/src/server/model-runtime.ts)在凭据/headers解析前守住API、CN目标和已声明模型，错误脱敏，防止配置覆盖落到generic实现。API标签仍为`openai-completions`，实际不用其serializer/sender。

observer注册真实`codeBuddyNativeFetch`。普通worker使用[纯身份helper](../app/src/server/codebuddy-run-identity.ts)注入真实run ID；恢复、通知、重载和压缩准备不自动推断。显式SDK身份和helper测试通过，不代表常驻worker已执行或UI已加载。

Axiom [session重试策略](../app/src/server/session-retry-policy.ts)对CodeBuddy实际失败消息禁用自动重放及失败历史省略；其他provider及独立summary重试不变。summary/overflow压缩恢复属于另一层，不能把native单send等同全应用只有一次请求。

## 已验证与边界

最新修复与实测：
- [SDK03真实闭环](evidence/codebuddy-native-component-live-03/REPORT.md)：三个HTTP200、tool_calls/stop/stop，各DONE+干净EOF；工具及宿主审批钩子各1，精确marker/NEXT、历史/身份与清理通过。真实refresh/其它aux0，不代表UI人工审批或服务加载。
- [工具增量修复](evidence/codebuddy-native-fix-03/REPORT.md)：最新41core+14SDK=55项测试及完整build通过。兼容null/安全空legacy、空非终态finish和已验证工具的后继空name；首次工具身份/改名/schema/完整终态不放松。
- 官方01/02功能成功但观察case仍Failed，旧SDK01/02和Axiom文本01失败原样保留；详[实测对比](codebuddy-native-parity.md)。所有claim含成功03均耗尽，禁止重跑。

以下为原离线/分发覆盖，未与最新55项相加；分发pack/install生命周期未新跑：

- [Pi回归27/27](evidence/codebuddy-native-component-01/pi-integration-tests-04.log)：工具/上下文/采样、auth票据、配置守卫、目录账号切换/迟到、销毁、脱敏。
- [实际Agent原生链1/1](evidence/codebuddy-native-component-01/pi-native-sdk-tests-02.log)：4个loopback请求，工具/结果/下一轮/取消；宿主工具执行与审批各1次。生产目标校验/native fetch保持，只映射最终Node socket目的地，**不证明TLS或外部服务对齐**。
- [session重试14/14](evidence/codebuddy-native-component-01/pi-session-retry-tests-01.log)与最新[server类型检查](evidence/codebuddy-native-component-01/pi-integration-typecheck-03.log)通过。新增公共导出后，[公共组件15/15](evidence/codebuddy-native-component-01/component-public-tests-01.log)、[受影响六文件48/48](evidence/codebuddy-native-component-01/component-regression-tests-02.log)及[完整构建](evidence/codebuddy-native-component-01/component-build-02.log)通过；首次构建的测试类型失败保留并已修复。
- [分发闭包验证](evidence/codebuddy-native-component-01/distribution-verification-01.json)：33个发射模块（CodeBuddy12）、77条相对依赖、0宿主依赖；npm-packlist的1055个候选文件包含全部模块。隔离临时目录仅复制5个代理依赖，实际emit入口在plain Node完成合成认证3/目录1/模型3及工具1、退出/销毁；无Pi/TS loader。未运行npm pack生命周期、创建tarball或测试安装生命周期，不等正式发布。
- 默认UA为 `CLI/2.179.0 CodeBuddy/2.179.0`，官方与Axiom真实发送路径均已检查且收到上游响应；不是独立wire采样，动态override/全部头/官方keepalive/TLS未证。close/无池/无redirect/retry是明确本地策略。
- 长度截断目前返回error；失败/取消assistant含未确认tool候选的历史拒绝重放，不静默删历史。严格完整终态、EOF及响应model匹配是保守边界。
- 显式cacheRetention、强制constrained-sampling/grammar、namespace、不可保真签名、图片工具结果拒绝；不假称支持未知providerData/extra_vars/cache_retention。`auto`与`sse`用SSE，websocket拒绝。
- output cap守模型和caller上限，但未提供额外context token余量估计。缺usage保留诊断，零占位不代表免费或完整计量；价格由Pi配置独立计算。
- 内置/云配置可见性不等推理权限；env令牌在未刷新目录时异步变化，availability不能仅凭stored-credential参数识别。

不恢复Kiro旧live/retry尝试、不修改安装版、全局代理/CA或默认模型。新的外部Flash测试须新合同、分层预算、import-safe harness自测指纹及一次性claim；任何本地PASS都不能替代此门禁。
