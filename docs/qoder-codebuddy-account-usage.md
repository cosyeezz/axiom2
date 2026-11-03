# CodeBuddy 与 Qoder 账号卡片只读查询

交付级别：功能接入。源码、构建产物和离线链路已验证；**未查询真实 CodeBuddy/Qoder 账号，未验证现有后台加载或浏览器端到端效果，也未重启后台**。

## 显示能力

| Provider | 卡片信息 | 边界 |
| --- | --- | --- |
| `qoder`、`qoder-cn` | 官方套餐名、订阅到期、套餐/附加/组织/专属资源包额度、资源包到期 | 有字段才显示；不推断免费套餐；组织显示分母为 used + remaining |
| `codebuddy-cn` | 个人版 / 企业版，安全的企业名称 | 所取证 CLI 未找到额度/订阅套餐端点；不制造额度，提示暂不支持查询额度，禁止卡片刷新 |

沿用通用卡片：套餐徽章读取 `usage.account.plan`，额度支持小数并显示剩余进度；非 active 状态隐藏数字。新增适配器使用现有单飞/缓存/账号隔离层，先验证凭据有效期，不调用刷新令牌流程。账号卡片不自动轮询；CodeBuddy 首次可取账号版本，但成功结果 `refreshable:false`，不提供手动额度刷新。

## CLI 协议证据

### Qoder CLI 1.1.81

静态证据：官方 npm 包 `@qoder-ai/qodercli` 的 `bundle/qodercli.js`（本机取证目录 `qoder-cli-1181/package`），第 86 行的 `fetchQuotaUsage`、`fetchUserPlan`、normalizers；第 2 行的 `Hc/S9i` 公共 sender、`iK` 请求 ID 与 `tO` trace 注入。

取证文件 SHA-256：`dcabbcaece1c0683ee4929ac7c0cf0ea00bbea4d319f5abeaae8216088b9888f`。

- 并行 Bearer GET `/api/v2/quota/usage` 和 `/api/v2/user/plan`。
- 国际站仅 `https://openapi.qoder.sh`；国内站仅 `https://openapi.qoder.com.cn`。账号凭据 `region` 必须与 provider 相符，不跨区域尝试。
- 显式头：`Accept`、`Authorization`、`Cosy-Version: 1.1.81`、`Cosy-ClientType: 5`、`Cosy-MachineOS`，以及每个请求独立生成的大写 UUID `X-Request-ID`。不继承宿主 OTel trace。
- 响应使用官方编码解码，失败回退明文 JSON；身份字段仅作有效性验证，不输出 `userId/userType`。
- 额度字段接受 CLI 的 snake_case / camelCase；仅输出套餐、额度和时间。专属资源包须有 ID 与有效金额，跳过过期状态；ID 不进入 DTO。
- `end_date` / `expiresAt` 依据 CLI 按毫秒解析，另容忍秒值。plan 单独失败仍保留额度；任一请求 HTTP 401 优先判授权失效。403、限流、服务与网络故障不假定账号已停用。
- 不调用 `/sash/api/v2/me/usage`：CLI 此路径在 401 会刷新令牌，本需求禁止刷新。

### CodeBuddy CLI 2.179.0

静态证据：官方安装包 `@tencent-ai/codebuddy-code/dist/codebuddy.js` 第 5014 行的 `getAccountSnapshot`、`createAccountSnapshot`、`isPersonalEditionAccount`、`isAuthenticationInvalidError`；`product.json` 的 `prefixPath: /plugin`。

取证文件 SHA-256：`677fa5d88dcea63223da5c525c7b48646dba80fd9f53f713e52d0d1dad003881`。

- CN 独立账号向 `https://copilot.tencent.com/v2/plugin/accounts` 发一次 Bearer GET，复用现有固定 origin JSON helper 及 CLI 头：`Accept`、`Content-Type`、`User-Agent`、`X-Requested-With`、`X-Domain`、`X-Product`。
- 按 CLI 过滤 truthy `pluginEnabled`；优先 truthy `lastLogin`，否则首个。无 enterpriseId 且非 ultimate/exclusive 为个人版，其余企业版。
- 仅投影 edition / 安全企业名到账号版本，不输出 uid、昵称、enterpriseId 或完整列表。
- HTTP / 业务码 401、403 为授权失效；其余错误为 unknown，不自动重试或刷新令牌。
- 额度接口的结论仅限这个 CLI 版本的静态取证，不代表厂商不存在其他未公开接口。

## 安全与对齐八条核对

以下“已证”仅限新增账号只读路径，不扩展至整个 provider 的认证、刷新和推理。

| 项 | 状态与证据范围 |
| --- | --- |
| 1. 只发 CLI 字段 | 已证：固定路径、GET 无 body、按 CLI sender 白名单组头；loopback 实际 HTTP 断言头集合，无宿主自定义头。原生传输的 Host/Connection 等另在测试白名单中核对。 |
| 2. 值与 CLI 同源 | 已证（静态及本地发送）：固定 CLI 版本、客户端类型、平台映射、CodeBuddy CLI UA、独立 UUID。Qoder 未显式设置 UA，本地 Node fetch 实测默认 `node`；未与官方 CLI 进程最终 UA 对照。 |
| 3. 不携带本地信息 | 已证：不发送会话/工作区/用户名/内部账号 ID；Qoder 每物理请求生成新 ID，不沿用宿主 run ID。 |
| 4. 实际发送验证 | 已证（本地 HTTP）：合成凭据经真实 Node fetch，临时 loopback 端口，6 个物理请求包含成功和 redirect:error 拒绝。未验上游 TLS、代理 wire 或官方 CLI 完整网络基线。 |
| 5. 行为一致 | 已知差异：禁用刷新/重试/地区 failover/宿主 trace；Qoder plan 失败可降级，缺失金额保持 null 不按 CLI 补零；安全边界限制金额、名称及最多 32 个专属包，不承诺完整组织看板。 |
| 6. 不伪造 | 已证（实现与离线测试）：正常使用调用方传入的独立账号 access token，不读 CLI/Keychain 凭据，不伪造 profile、设备、签名或权限。真实账号路径未验。 |
| 7. 不夸大范围 | 未验：真实账号、上游直连 TLS/复用/HTTP 版本、运行中后台加载、浏览器 UI；不宣称整体等价或服务端不可区分。 |
| 8. 证据白名单 | 已证：fixture 全为合成凭据；结果仅投影允许字段，错误仅固定分类中文文案；不记上游响应/错误原文、真实认证头或 token。 |

不执行推理，不消耗模型额度；不修改全局代理、CA 或认证文件。loopback 测试仅替换目标 origin，不把真实 token 发往本地。

## 实现位置

- [Qoder adapter](../app/src/server/providers/qoder-quota.ts)
- [CodeBuddy 独立账号查询](../app/src/native-providers/codebuddy/account-info.ts)（已在 native 公共入口导出）与 [宿主 DTO adapter](../app/src/server/providers/codebuddy-usage.ts)
- [Adapter 注册](../app/src/server/provider-usage.ts)
- [Qoder 测试](../app/tests/qoder-quota.test.ts)、[CodeBuddy 测试](../app/tests/codebuddy-account-usage.test.ts)、[实际 HTTP 边界测试](../app/tests/qoder-codebuddy-quota-wire.test.ts)、[卡片 React 静态渲染测试](../app/tests/provider-usage-quota-card.test.ts)

## 已执行验证

工作目录 `app/`：

```sh
npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/qoder-*.test.ts tests/codebuddy-*.test.ts \
  tests/provider-usage*.test.ts tests/kiro-quota.test.ts \
  tests/session-account-usage.test.ts
npm run build
```

- 相关回归 **173 通过 / 0 失败 / 0 跳过，退出码 0**。
- 完整 build（前端 tsc + Vite + 服务端 tsc）**退出码 0**；Vite 仅大 chunk 警告。
- 编译后 `dist/native-providers/index.js` 在独立 Node 进程导入成功，账号函数/错误类导出存在，合成账号 parser 返回个人版；无网络调用。
- React SSR 验证：小数额度、剩余进度、订阅/资源包到期、CodeBuddy 无额度提示，以及 unknown 状态隐藏数字。不是浏览器布局或交互验收。

本次没有重跑已知其他账号展示/会话 RPC 的原有失败，不把相关回归通过当成全仓测试通过。

## 待授权验证

如用户授权，可分别对 `qoder-cn`、`codebuddy-cn` 各执行一次只读账号查询：Qoder 最多两个上述 GET；CodeBuddy 一个 accounts GET；不刷新、重试或推理。只报告 HTTP 分类及安全套餐/额度字段。后台实际加载、真实 UI 检查和重启需另行确认，不以构建成功代替。
