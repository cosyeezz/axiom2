# 账号卡片：信息直显与启用选择

用户明确要求：卡片直接展示账号信息，多账号时看清并选择启用哪个账号，不要把主体做成官网跳转，也不要多层折叠。本方案替代[上一版](model-accounts-redesign-v2.md)的身份、查询原因和金额说明折叠设计；此前v4检查仅代表历史版本。

## 卡片直接回答什么

- **这是哪个账号**：名称、真实区域、认证方式及保存来源；有资料时直接显示邮箱、账号 ID、令牌有效期和套餐。名称、区域、邮箱和套餐自然换行，不再依赖省略、title或点击展开才得到完整信息。
- **现在启用谁**：卡片明确“当前启用”；其他卡片有“启用”操作及确认框。每个供应商独立选择，组头显示其完整账号集合中的当前项，搜索隐藏当前卡片也不会误报未启用。
- **额度还有多少**：已查询到的点数、次数、独立窗口、Spark、重置及到期日期直接显示；0、未知、无限分开。唯一保留的卡内折叠是可能较长的“重置券到期明细”，不是主指标。
- **为什么没有某项信息**：缺失身份或套餐明确为“本地授权未提供”；查询原因、失败和金额归属限制直接显示。官方页面只在卡片底部作辅助入口，不能充当身份或余额。

详情弹窗保留少用的登录配置/来源解释及技术字段，不作为核心账号信息的必经入口。授权邮箱与官方查询邮箱不同时直接说明两种来源；令牌声明仅作区分，不冒充独立验证的身份。

## 启用状态的可信度

- 添加账号不擅自切换；切换仅影响该供应商的新任务，正在执行的任务保留已捕获绑定。
- 切换写入后仍须重新读取列表和配置才确认，失败保留“上次选择”并禁止继续切换。
- 确认同时绑定连接 generation。断线时降级，原页面重连但新列表尚未返回时也不能把旧记录当“当前启用”或解禁写操作。
- 所有写入口和确认框均检查确认状态，不能只靠按钮禁用。

## direct 旧账号的实际边界

`openAIUsageRestriction` 对显式 `chatgpt.tokens.use.direct` scope 本地停止额度查询；这不是上游刚返回401/403，也没有证明官方只能网页查询。当前没有已核实的 direct 点数/重置查询协议，不能用 Codex 合成响应冒充接通。

Pi 1.4.0 的 `auth/oauth/openai-chatgpt.js` 在授权码兑换时检查 ID token 存在，却只保存 access、refresh、expires、clientId、scopes；刷新也返回这些字段。旧资料可能因此没有邮箱、套餐或上游账号 ID。已有安全字段照常直显；没有的数据不能从 UI 补造，clientId、JWT subject 也不能冒充 Codex account ID。

若后续需要补齐旧 direct 身份，需单独完善登录时的 ID token 验证与白名单资料留存，并由用户参与所需的授权流程；不能保证重新授权就能获得套餐或余额。本轮不修改真实认证、读取真实凭据、尝试登录或访问真实账号。

公开依据：[Sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in#4-validate-the-id-token-and-chatgpt-plan-permission)、[Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)、[Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)。接口限制的既有证据见[provider-usage](provider-usage.md#direct-授权限制与历史-401)。

## 实现与验证范围

仅修改账号页与 `ProviderUsage` 的 opt-in 账号布局；共享默认展示及查询 effect、每卡单实例、缓存/隐藏暂停/屏外按需/取消/迟到保护保持原契约。账号状态确认增加连接代次约束，不改变后台账号指针或凭据路由。

本轮检查包含：两种指针模式各56组布局与8个缺资料direct场景；额外已有安全资料direct直显；真实RPC首次/缓存失败恢复；完整长值可达；核心内容无需展开、仅券明细允许折叠；筛选后仍识别当前账号；切换后权威重读失败/恢复；同页真实断线重连且挂起列表时不能确认旧选择。原账号/Codex、共享usage/estimate/session及构建须重新通过。

旧 direct ≤230px高度要求不再适用：完整信息直显后允许按内容自然增高，不再通过折叠压高度。普通账号卡20%～35%面积断言仍保留，不拿丰富卡高度强迫普通卡齐平。

## 最终结果（直显v3）

源码、隔离回归、人工审图与构建完成。两套矩阵各56个唯一组合、8个缺资料direct场景，另有安全资料/token-only direct专项；各生成39张图。主Agent核对JSON、日志与8个真实退出码均为0，错误/意外命令/外部网络数组均为空；所有组合的横向溢出、正文对比度、控件尺寸/重叠检查通过。1440px/100%普通卡为295.5×144，原396×417面积的25.77%。

| 检查 | 本轮结果与证据 |
| --- | --- |
| 触屏矩阵及交互 | 通过；[日志](assets/model-accounts-inline/verification/touch.log)、[完整JSON](assets/model-accounts-inline/verification/touch-evidence.json) |
| fine-pointer矩阵及交互 | 通过；[日志](assets/model-accounts-inline/verification/fine.log)、[完整JSON](assets/model-accounts-inline/verification/fine-evidence.json) |
| 原账号业务链路 | 通过；[日志](assets/model-accounts-inline/verification/accounts.log) |
| Codex真RPC→cache→worker→adapter，本地网络fixture | 通过，3账号6次GET、凭据不变、完整指标/日期；[日志](assets/model-accounts-inline/verification/codex.log) |
| 共享用量页 | 通过；[日志](assets/model-accounts-inline/verification/usage.log) |
| 共享估值页 | 通过；[日志](assets/model-accounts-inline/verification/estimate.log) |
| 会话cache-only入口 | 通过；[日志](assets/model-accounts-inline/verification/session.log) |
| TypeScript + Vite + server TypeScript | 通过；[日志](assets/model-accounts-inline/verification/build.log)，仅既有大chunk警告 |

每项日志均有三项 `AXIOM_EXECUTION_PROFILE` / `AXIOM_MODEL_ACCOUNT_BINDINGS` / `AXIOM_MODEL_PROVIDER` 不存在的运行检查；同目录有各自 `.exit`。使用独立临时cache、port 0，无真实授权/额度访问。最终产物包括 `ModelAccounts-4nliaogD.js`、`ModelAccounts-BFDN9Vd9.css`。

此轮实际修复了320px/200%套餐标签造成的8px横溢、重连后旧确认短暂恢复、可见“启用/重试”与可及性名称不一致，以及官方邮箱与token同值时来源title不准确。并非降低断言阈值：旧≤230px direct高度要求因用户直显要求明确替换；普通面积与控件尺寸阈值不变。

### 新版实际画面

以下全部是测试数据，不是用户真实邮箱/套餐/余额；12张代表图已独立复制并逐一校验SHA-256一致。

- [已有安全资料的direct账号卡](assets/model-accounts-inline/direct-with-identity.png)：信息直接可见，但未宣称已接通direct额度。
- [旧资料缺失的direct手机页](assets/model-accounts-inline/direct-without-identity-mobile.png) · [桌面页](assets/model-accounts-inline/direct-desktop.png)：诚实保留缺失状态，不能用上一个样例冒充已补齐真实资料。
- [多账号完整Codex页](assets/model-accounts-inline/codex-desktop.png) · [窄屏长页](assets/model-accounts-inline/codex-mobile.png)：资料、额度及当前启用均在卡内。
- [多供应商混排与超长字段](assets/model-accounts-inline/mixed-light.png)。
- [首次查询失败](assets/model-accounts-inline/first-query-failure.png) · [缓存刷新失败](assets/model-accounts-inline/cached-query-failure.png)。
- 320px/200%：[增高整卡补图](assets/model-accounts-inline/direct-card-200.png)与[原视口滚动结果](assets/model-accounts-inline/direct-scroll-200.png)分开；[长套餐末尾滚动窗口](assets/model-accounts-inline/identity-scroll-200.png)不冒充所有字段同屏。
- [自然Tab的键盘焦点](assets/model-accounts-inline/keyboard-focus.png)。

主Agent实际查看身份有/无、手机浅色、长卡混排、Codex三账号与窄屏、错误状态、大字补图/真实滚动及焦点画面；独立只读审图未发现视觉阻断。极长身份在大字号下仍需较多滚动，这是完整直显的代价；缓存失败提示位于卡片下方，不应把截图上半部分单独当实时值证明。

**验证边界**：Chromium、应用fontScale，不等于浏览器page zoom、跨浏览器或完整WCAG认证；离线fixture不证明真实上游权限。direct旧身份缺失和额度协议未接入仍是数据限制，不是本轮已解决事项。未重启真实后台，也未确认用户当前实例已经加载新构建。
