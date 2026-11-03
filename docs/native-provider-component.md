# 原生供应商组件：Kiro 首次接入

本文保留Kiro首次接入的验收范围。后续独立的[CodeBuddy CLI组件](codebuddy-native-component.md)共享domain契约，不复用Kiro wire，也不回写或扩大本文的历史实测结论。

状态：Kiro 独立组件与 Pi 接回已完成[离线验收](evidence/kiro-native-component-01/REPORT.md)及[独立进程真实集成验收](evidence/kiro-native-component-live-01/REPORT.md)：真实工具往返、下一轮历史续接、3次模型请求全部通过。现有服务未重启；不等同于 UI 部署或完整 wire/TLS parity。

## 目标与边界

先把现有 Kiro 接入提升为完整的、进程内、SDK 无关的组件，再接回 Axiom 的 Pi Provider。Kiro 验证通过前不接第二家；第二供应商身份另行确认，不假定 WorkBuddy 与 CodeBuddy 相同。

组件负责 OAuth 协议、刷新、目录、profile、请求构造、原生传输、流解析、协议校验及供应商状态。宿主负责登录 UI、安全存储载体、账号选择、会话、工具审批与执行。SDK 适配器负责消息和事件转换、SDK 能力/用量映射及 SDK 接口约束。

不新增 HTTP 服务、OpenAI 兼容反代、CLI 子进程代发或用户 API Key/Base URL 配置。不启用 [原生重试设计](kiro-native-retry-design.md)，不降低隐私保护。保持 `kiro / deepseek-3.2 / off`、既有官方版本 UA、`optout=true`、单次发送和现有 continuation 语义。

## 代码布局

采用 [app/src/native-providers/](../app/src/native-providers/) 作为组件库源码边界：

- `contracts.ts`：供应商无关的交互、存储、消息、工具、模型能力及事件契约。
- `kiro/`：独立认证、目录、profile、协议、发送、解析及生命周期实现。
- `index.ts`：可复用的公开入口，不导出 Pi 或 Axiom 的宿主类型。
- 现有 `app/src/server/providers/kiro*.ts`：Pi 适配与兼容导出；不保留第二份协议实现。

当前仓库不是 workspace，服务端 TypeScript 的 `rootDir` 是 `app/src`。先保持现有构建体系，不为此次接入安装 SDK 或重排整个仓库；组件仍位于该 rootDir 内，发布文件清单须包含 `app/dist/native-providers/`。独立打包及 plain Node 测试证明组件依赖闭包，而不是以目录名称宣称独立。此次不承诺 npm 发布或任意 SDK 零适配。

## 公共契约与责任

### 认证与存储

- 组件拥有 OAuth 请求与响应校验、PKCE/设备流程、刷新、取消及超时；不读取 CLI 缓存、Keychain 或 Pi 的 auth.json。
- 登录交互使用组件自有提示/通知类型。Axiom 的 `kiroLoginField` 等 UI 元数据在适配层装饰，不能形成组件到宿主的反向 import。
- 宿主注入安全凭据载体及原子更新/互斥能力；独立调用必须可在不加载 Pi 的情况下完成登录、持久化交接、刷新与取用。
- Pi 已在 CredentialStore 锁内执行 refresh。Pi 接回时沿用这一锁与账号路由，禁止再叠加独立自动刷新器。
- 一次性 opaque ticket 是 Pi 通用认证槽的边界技巧，留在 Pi 侧；不是组件认证模式，更不是发给 Kiro 的 API Key。
- profile/cache 状态与真实账号范围绑定，访问令牌变化、刷新轮换、退出及账号切换不能恢复其他账号的数据或复用错误凭据。

### 目录与推理

- 目录事实与 Pi Model 分开；未知能力/用量/价格继续为未知，不因为映射为零值而宣称免费或精确。
- 保留现有 V1/V2 目录恢复与作用域校验；Pi 缓存格式的转换留在适配边界，完整分页后才能发布。
- 组件接收自有 domain 消息、工具 schema、所选模型、凭据、会话/逻辑轮身份及取消信号；不读取 Pi session 或推测调用目的。
- 组件输出 SDK 无关的流事件及完整终态。工具 JSON、ID、名称与终态必须校验；schema 验证如由宿主注入，须显式且失败关闭，不能因独立调用而省略。
- 工具由宿主执行；流片段或尚未成功终结的 tool call 不构成执行许可。失败、截断和取消不得执行不完整工具，也不得隐式重发。
- Pi 的 system/custom/history/tools 归一化、thinking 能力判定、mutable AssistantMessage、价格快照/摘要计价等保留薄适配；Kiro 协议和发送逻辑下沉组件。

### 传输与观察

保持现有固定端点、账号/profile/model/origin 保护、请求大小上限和错误白名单。Responses 仍经 native HTTP/1.1，observer 仅包装真实 sender；不能因解耦恢复为 Fetch/HTTP2 或添加 Fetch 默认头。

保留 payload replacement、response header、原始 provider event hooks 及其取消语义。调试证据仅落盘白名单；凭据、Authorization、真实上下文及响应原文不得写入此次验证产物。

## 验收

1. 静态及独立打包依赖闭包：公开组件及其传递依赖不引用 Pi、Axiom runtime、账户 UI、会话数据库或旧 Provider 适配器。
2. plain Node：合成认证/刷新与注入存储；目录/profile；本地 HTTP 文本、工具回传及下一轮；取消、晚到结果清理、账号隔离与失效。
3. Pi 接回：真实 ModelRuntime/AgentSession 的注册、认证锁与票据、目录缓存、system/tools/history、hooks/observer、工具审批/执行、事件完整性和用量继续通过。
4. 回归覆盖现有 Responses/AWS 路径、thinking、图片、工具输入、失败/截断、continuation、profile、认证和目录边界；明确列出实际运行检查及未验证项。
5. 类型检查、构建及发布路径检查通过。修改期间不同时运行覆盖这些文件的测试；相关变更后重跑受影响检查。
6. 交付公开入口、调用示例、Pi 映射说明、验证证据和限制。功能与本地验证不等于完整服务端 parity。

原组件交付 case 仅离线与本机合成上游。用户后续授权的真实测试另立 [live 合同](evidence/kiro-native-component-live-01/CONTRACT.md)，没有扩大或回写原合同，也未执行或复用旧 live-01 至 live-06 的 harness/claim。4319 安装版不动；新的真实请求或部署仍须明确范围与预算。

## 已交付入口与使用方式

源码入口：[index.ts](../app/src/native-providers/index.ts)；构建入口：`app/dist/native-providers/index.js`。服务端构建显式包含组件全目录，发布清单包含完整输出。本轮不新增独立 npm 包或承诺稳定的外部包名/类型声明发布。

| 入口 | 责任 |
| --- | --- |
| `createKiroNativeProvider(options?)` | `auth.login/refresh`、`catalog`、`stream`、`dispose`；不自动读取凭据 |
| `createNativeAccount(oauth, store)` | 可选独立账号生命周期：`login/resolve/logout/invalidate/dispose` |
| `createKiroClient(transport?)` | 仅原生流、profile 缓存和取消；无自动刷新/工具执行/模型重试 |
| `NativeCredentialStore` | 宿主安全存储接口；事务串行、提交前检查取消、每次变更 revision 不复用 |
| `NativeContext/NativeStreamEvent` | 与 SDK 无关的消息、工具及事件契约 |

以下为已有合法登录的调用示例，不会在模块加载时自动发送请求。`store` 必须由宿主实现安全事务存储，不能用示例内存存储冒充生产持久化：

```js
import { createKiroNativeProvider, createNativeAccount }
  from "../app/dist/native-providers/index.js";

export async function* reply({ store, context, signal, sessionId, continuationId }) {
  const provider = createKiroNativeProvider();
  const account = createNativeAccount(provider.auth, store);
  try {
    // 首次登录由用户明确操作触发 account.login(interaction)，不自动兜底登录。
    const credential = await account.resolve(signal);
    for await (const event of provider.stream({
      model: { id: "deepseek-3.2" }, account: credential,
      context, // 完整 systemPrompt/messages；本例仅文本，不传 tools。
      options: { signal, sessionId, continuationId, reasoning: "off" },
    })) {
      if (event.type === "error") throw new Error(event.message);
      yield event;
    }
  } finally {
    account.dispose();
    provider.dispose();
  }
}
```

- 登录交互为 `prompt/notify/signal`；宿主负责展示 UI、保密与持久化。刷新失败保留原存储，不自动交互登录。`catalog(credential, signal)` 返回供应商事实，不含 Pi 配置、零价格占位或 UI 缓存。
- 同一逻辑轮工具往返复用 `continuationId`，下一轮显式换新 UUIDv4；`sessionId` 保持会话身份。组件不猜测恢复/标题等调用目的。
- 带工具必须传 `options.validateToolInput`，校验完整 schema 且返回未改变的原始 JSON；不接受 coercion。候选 `tool-end` 之后仍可能失败，只有完整成功终态 `done/toolUse` 才交给宿主审批与执行。完整工具回传示例见 [独立 Node fixture](../app/tests/fixtures/native-provider-stream.mjs)。
- 账号切换或退出时，宿主取消活动请求、关闭旧 provider/account，再用新账号重建。`account.invalidate/logout` 本身不等于取消另一个 provider 的流；`provider.dispose` 也不会删除宿主凭据。宿主仍负责跨进程存储互斥与审批安全。

## Pi 接回与验证范围

[kiro-chat.ts](../app/src/server/providers/kiro-chat.ts) 保留一次性 60 秒 opaque ticket、Pi 上下文归一化、工具 schema 校验、mutable message/事件转换及价格记账；[kiro-auth.ts](../app/src/server/providers/kiro-auth.ts) 只映射交互元数据。Pi 原 CredentialStore 仍是唯一刷新 owner，不再组合 `createNativeAccount`。

旧原生模块是兼容导出，错误类和真实 sender 函数身份与核心一致，observer 不会注入通用 Fetch。目录 V1/V2 缓存、Pi thinking 能力和摘要计价留在适配侧。未知计数/价格不被解释为免费。

实际通过：32 个测试文件、379 个不同测试；其中受 chat 类型修正影响的 9 文件另复测 95 项；类型检查、前后端构建、离线 pack 清单和隔离 plain Node 导入。21 个组件模块及 45 条相对依赖均在包中，无宿主反向依赖；仅已有 `https-proxy-agent` 及其依赖，不新增 SDK。

离线轮次限制：未运行全套 `check:package` 安装/升级/服务生命周期，也未重启或进行真实调用。后续[独立进程真实验收](evidence/kiro-native-component-live-01/REPORT.md)已验证 OAuth 刷新与模型工具闭环，但仍未重启 4317/4319、未验证新交互登录或完整官方 OAuth/direct-TLS parity。npm 10.9.8 的 pack 即使带 `--ignore-scripts` 仍执行了本地 prepare/build，不能宣称未运行脚本；详细输出及修复历史保留在 [case](evidence/kiro-native-component-01/REPORT.md)。上述Kiro验收轮未实施第二供应商、原生重试或隐私变更；后续CodeBuddy工作单独记录，Kiro原生重试和隐私策略未因此改变。
