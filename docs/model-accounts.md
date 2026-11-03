# 多账号管理

## 使用方式

在「设置 → 多账号管理」进入 `/model-accounts.html`，也可从「模型服务」页面跳转。

此页按两类资格展示：需要供应商专属信息的账号可以独立展示，当前包括 **OpenAI OAuth（`openai` / `openai-codex`）的订阅/额度账号**；其他供应商须有 **至少 2 个 Auth 账号** 才整组展示。认证已移除的记录不计入数量，也不生成卡片。其余账号仍保留、可在「模型服务」管理，不会发起隐藏卡片的额度查询。资格根据完整账号集计算，搜索和供应商筛选不改变资格。OpenAI OAuth 不代表一定是付费订阅；套餐只展示官方响应或授权信息中的明确字段，不从登录方式猜测。

卡片采用 **通用骨架 + 供应商扩展**：通用部分优先显示名称、真实区域/认证、邮箱或账号 ID；详情与非当前账号的「启用」操作放在身份头部，当前卡片显示「当前启用」，不重复为禁用按钮；供应商组头同时说明该组的新任务默认账号。供应商扩展保留该供应商提供的全部指标；额度结构取决于实际响应，而不是看到 OAuth 就假定有订阅数据。普通卡片保持原版 20%～35% 面积的紧凑密度，OpenAI 等扩展卡片按信息自然增高，不为面积隐藏余额、点数、次数或金额信息。普通组以 240px、订阅扩展组以 320px 为最小列宽自动分列，320/390px 窄屏均为单列；筛选只剩一张卡时也不拉宽，普通卡不被同排长订阅卡撑高。点数与次数在视觉和 DOM 阅读顺序中均优先，所有独立窗口保留。邮箱、账号 ID、令牌有效期、套餐及来源直接展示；仅较长的重置券到期明细可折叠。Kiro 企业登录选项等少用技术配置仍通过「详情」查看。

页面只保留系统导航、简短标题与结果数、添加账号、列表刷新和轻量供应商分组。完整合格集合有多个账号时才显示搜索，多供应商才显示供应商筛选；搜索或筛选生效时持续保留控件，不随结果数量消失。列表刷新不等于刷新所有账号额度；额度刷新紧邻实际额度，账号操作留在身份头部。长介绍、重复教学和页脚导航不再占据正文；异常、断线、旧数据和金额归属限制仍明确显示。

单个 OpenAI direct 授权不可查询额度时，账号资料仍是卡片主体：已有资料直接展示，缺少身份或套餐明确显示「本地授权未提供」。没有数据不生成报表标题或不可用刷新按钮；查询原因及金额归属限制直接可见，官方用量入口仅在底部辅助，不再要求展开说明。首次失败有明确错误和重试，不能伪装成不支持；刷新失败有旧值时保留数据并标记过期。

身份信息由后端按白名单投影。OpenAI 优先使用凭据显式邮箱，兼容 Sub2API 的 ID token 顶层 `email`、access token 顶层 `email`，以及 `https://api.openai.com/auth` 内的账号 ID / 套餐字段；有长度和格式限制，不返回原始令牌或 claims。令牌声明仅作区分账号的展示元数据，不是身份验证结果，界面说明其来源，不用于认证、权限或切换路由。Pi 1.4.0 的原生 Codex 登录不保留 ID token，因此旧凭据可能只有账号 ID；卡面优先采用实时额度响应邮箱，次选授权邮箱或账号 ID，不并排堆放两套身份；不一致时直接列出授权邮箱及两种来源；来源一致时不重复提示，更不因保存字段来自 token 就把实时官方邮箱标为未验证。长名称、区域、身份与套餐自然换行，不依赖省略或展开。Kiro 等供应商没有邮箱时不虚构。原生 direct 登录也可能未保存 ID token 中的身份资料，UI 无法补回已丢失字段，详见[直显方案与来源边界](model-accounts-inline.md)。

- **添加账号**：点击添加后进入 `/model-config.html?add-account=1`，在模型服务填写账号名称及可选区域/备注，复用现有供应商选择和 Auth 登录界面。OAuth 与已有自定义接口的 API Key 都走独立认证槽；仅确认登录保存成功后，自动返回多账号管理。取消、失败或仅关闭登录不会假装成功回跳；普通模型服务入口不带此上下文，仍保留原行为。
- **新增自定义供应商**：从供应商旁的「+ → 自定义接口」填写并保存连接和共享模型配置，再点击「添加 API Key 账号」使用 Auth 保存独立密钥。添加模式不会把 API 密钥夹带在普通配置保存中，避免覆盖已有账号；配置已保存但认证失败时保留配置供继续登录。
- **当前账号**：为已有供应商新增账号不自动切换、不覆盖旧账号；全新供应商没有旧账号可切换，因此其第一个成功保存的账号直接可用。凭据写后失败的恢复登记仍不自动激活。若新供应商唯一账号因此尚未启用，可在模型服务选中该供应商，点击「启用已保留账号」显式确认；无需重复登录，也不必为未达到展示门槛的普通供应商生成卡片。
- **选择账号**：点击卡片「启用」并确认。每个供应商独立选择一个账号，不影响其他供应商。新任务捕获新的账号绑定；已运行的任务继续使用原来的绑定。组头按完整未过滤集合显示当前选择，不受搜索影响。切换提交后必须重读账号与配置才能确认当前选择；若重读失败，旧记录标为「上次选择」，暂时禁止继续切换并提示刷新。断线及同页重连后新列表尚未返回时也保持未确认，确认绑定当前连接代次，不把旧标识当作新状态。按钮、已经打开的确认框及写入口均受此限制；成功读取后才恢复操作。
- **原有登录入口**：模型服务中的登录、密钥保存和退出仍针对该连接当前使用的认证槽，不会自动新增卡片。需要保留多个账号时应使用账号管理入口。
- **供应商与区域**：供应商列表复用已有原生认证能力与模型连接；自定义 API 接口须先在模型服务中发布。国内/国际原生接口按各自 provider ID 区分；「区域/备注」仅用于卡片标识，不会改变实际服务区域或请求地址。
- **共享模型列表**：同一供应商只编辑一份根 `models.json` 中的模型定义和连接，不按账号复制可编辑模型列表。添加目录内的配置只是认证时的暂存快照；后续运行和模型编辑使用根配置。与账号、区域或权限绑定的动态目录缓存仍分别保存，不能用 A 账号目录冒充 B 账号的可用权限。
- **网络**：新增登录默认继承相应模型连接的网络配置；OAuth 登录时可复用原网络选择界面，此选择属于供应商共享连接，会用于该供应商其他账号及后续请求。额度查询使用该连接当前的网络设置。不另建隐藏代理，也不在代理失败时回退直连。
- **Kiro 登录选项**：成功凭据保留登录方式、企业 Start URL、认证区域及 PKCE/设备授权流程，令牌刷新时继续保留。再次从 Auth 登录时，按当前选中账号的已保存非敏感选项可见回填，允许修改、仍需逐步确认，不自动提交。企业认证区域不同于模型服务区域；授权码、令牌和客户端密钥不会作为默认值回传。旧凭据没有保存授权流程时不会猜测。

## 用量与剩余额度

卡片查询其自身账号的官方指标，而不是当前选中账号的指标。可见卡片默认约每 60～70 秒自动更新，同时尊重服务端更近的 `nextRefreshAt`；不可见卡片和隐藏页面暂停发起查询，恢复可见后按服务端期限补查一次。支持手动刷新，后台保留单飞、超时及短时节流保护。

当前官方额度适配仅支持 **OpenAI OAuth（`openai` / `openai-codex`）**。对已支持的 Codex OAuth 授权，卡片直接复用现有登录态，并行 GET `https://chatgpt.com/backend-api/wham/usage` 和 `/backend-api/wham/rate-limit-reset-credits`，不是以链接代替查询。实现对照 [Sub2API](https://github.com/Wei-Shaw/sub2api/tree/ba81c7fd758e425d67f856d601147ef0c5263d3f) 的 `openai_quota_service.go` / `openai_quota_reset_credits.go`、`oauth.go` / `account_codex_import.go` 及 `OpenAIQuotaResetCell.vue`。扩展保留官方邮箱、套餐、主/次窗口已用和剩余比例、独立 Spark/额外窗口与各自可用/限额状态、重置时间、剩余点数（保留十进制原值）、重置次数、最近到期和可展开的重置券到期列表（最多 64 条，仅日期，不返回券 ID）。卡片进度条明确表示 **剩余额度**：已用 37.5% 显示剩余 62.5%。上游套餐优先于较旧授权元数据；不把 workspace 到期误作个人套餐到期，没有可靠日期不展示。实际字段取决于官方返回。零、无限和未知 `—` 分开显示；不能把点数或窗口比例当成美元订阅余额。进度条只使用已知官方窗口比例，或同时有已用/剩余 Token 的可计算比例；仅有余额、次数或未知额度时不绘制虚假的百分比。其他供应商及不受支持的认证方式明确标记为未适配，不把未知余额伪装成 `0`。查询失败时标记旧数据；令牌过期时提示重新认证或等待模型调用刷新。额度查询本身不刷新 OAuth 令牌。带 `chatgpt.tokens.use.direct` 的授权当前没有已核实的应用内额度查询协议，返回明确不可查询状态和官方用量入口，不将其视为 Codex 查询成功。

**预计可用金额不会因为紧凑而删除，但必须保留来源边界。** 账号卡片直接保留此字段和完整说明，无指标时也不折叠；本机账单尚未记录 account ID，无法证明样本属于某账号，因此 OpenAI 账号金额显示 `—` 并解释原因，不对混合供应商样本做账号归因；即使目前只有一个账号，也不能证明历史未换号。原「模型用量」仍保留供应商级本机样本金额参考；账号卡不再用该跳转充当余额查询。若其他适配明确提供对应模型的绝对 Token 余额，仍可按完整配置价格显示独立的 Token 金额估计，不能以百分比或点数替代。

原「模型用量」页面保持原有 30～40 分钟刷新契约。其本机账本目前按供应商/模型等维度汇总，尚未记录 account ID，因此不会把历史消费事后归给某个账号。供应商官方额度与本机调用统计是不同来源。

## 会话套餐用量入口

会话左下角在「费用」右侧、「重新加载会话」左侧显示 Lucide `chart-pie` 图标，点击查看账号与官方额度快照。它与周围工具栏共享尺寸、描边和显示缩放；支持键盘打开、Escape/外点关闭及焦点恢复，窄屏详情在内部滚动。它不是本次会话消费统计，也不是美元余额。

**只有匹配当前模型供应商、认证仍有效且已有合法额度缓存时才显示。** 已知的零余额/零额度有效；纯空、未知、未来时间或不匹配的缓存不会生成入口。过了采样刷新期限的已知记录可带「旧数据」展示，认证过期则隐藏。此入口每 5 秒只读本地缓存，页面隐藏时暂停；打开详情也不会查询官方额度、刷新认证、写入/删除缓存、导入旧账号、读取价格或重建本机账本。支持额度查询本身不代表已经存在记录。需要更新官方数据时，使用多账号管理或原「模型用量与统计」的查询入口。

账号来源分开说明：

- **当前执行固定账号**：必须由真实原生请求取得认证及最终请求头后证明，并匹配执行捕获的账号绑定、run/lease、物理 request ID、模型及已应用版本。切换全局默认账号不能替换它；新请求先撤销旧证明，迟到的旧请求不能重新授权。启动中、停止中、尚未证实的模型切换、被替换的传输实现及无法证明身份的自定义认证/头/API/地址均保守隐藏。
- **下次执行默认账号**：会话空闲时展示当前默认账号的已存记录，明确表示下次执行，不冒称上一次调用账号。正在执行但未获证明时绝不退回此默认账号。

`agent.accountUsage.cached` 仅接受已授权的工作空间/会话范围，拒绝前端指定供应商、账号或刷新参数。返回白名单身份标签、邮箱/套餐与额度；凭据摘要仅在后端核对，不返回令牌、JWT claims、执行环境、上游券 ID 或原始响应。读取前后复验凭据/配置/缓存身份，变更即隐藏，不借用其他账号缓存。普通账号卡片的数量门槛不限制这个按执行身份展示的入口。

## 存储及运行时约束

模型目录取 `AXIOM_PI_DIR` 或应用数据目录下的 `pi`：

```text
pi/
  auth.json                      # 原有账号凭据（legacy）
  models.json                    # 模型连接及网络配置
  model-accounts/
    index.json                   # 无凭据的卡片元数据及各 provider 的 active 指针
    <UUID>/
      auth.json                  # 独立账号凭据
      models.json                # 添加登录时的单供应商临时配置快照，非独立模型列表
      models-store.json          # 该账号的动态模型目录（如适用）
```

- 原有认证自动登记为「原有账号」卡片，只记录元数据，不复制 token；其卡片额度查询始终指向原 `auth.json`，不跟随 active 指针。
- 切换仅原子修改索引指针，不复制或镜像 token。SDK 的 CredentialStore 和 ModelsStore 捕获账号路径，刷新始终写回原账号，避免切换时串号或丢失刷新令牌。
- 执行 profile 包含捕获的账号绑定，因此切换后的新任务不会误用之前的工作进程账号。记忆整理的恢复键也包含选中账号的认证和目录路径。
- 新增认证失败/取消仅清理未保存凭据的暂存目录。若凭据已写入但响应取消或后续目录同步失败，则登记为非激活账号并提示重新读取；若索引损坏或卡片已满而无法登记，则保留恢复目录，不删除已写入的凭据，且始终释放认证忙锁、不覆盖损坏文件。
- 独立目录使用 `0700`、新私有 JSON 使用 `0600`。拒绝账号目录及认证/catalog 文件的符号链接、异常硬链接和不合法索引。索引采用临时文件加原子重命名。假定本地模型目录由当前 OS 用户控制；这些检查不是对同一用户恶意并发篡改文件系统的完整沙箱。
- 浏览器仅接收安全卡片元数据和额度 DTO；不返回凭据，不写入浏览器存储。worker 登录 IPC 返回保存收据，不返回 Pi 的原始认证结果。
- 每个模型目录最多 500 条卡片。没有新增删除账号、独立账号代理编辑或跨机器同步功能。
- 若提示已保存但未登记的恢复目录，先保全 `model-accounts/<UUID>/`，不要删除或把凭据复制到浏览器。修复索引/写入权限或容量问题后，可由维护者使用 `ModelAccountService.recover` 重新登记该目录及账号信息；当前没有自动发现孤立目录或前端重新登记入口，单纯刷新未必能显示这种账号。前述「启用已保留账号」仅适用于已成功登记、但尚未激活的单账号，不会扫描孤立目录。

Pi 1.4.0 尚未在包根导出文件存储类，`model-account-storage.ts` 中集中封装该版本的内部模块桥接。升级 Pi 时须复测接口及跨进程刷新锁行为。

## 验证

从 `app/` 执行：

```sh
npx tsx --test tests/model-account-info.test.ts tests/model-account-presentation.test.ts
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_PROVIDER \
  npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/session-account-observer.test.ts tests/session-account-usage.test.ts tests/session-account-runs.test.ts tests/session-account-rpc.test.ts
npx tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 tests/model-accounts.test.ts tests/model-accounts-codex.test.ts tests/provider-usage.test.ts tests/provider-usage-cache.test.ts
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_PROVIDER \
  AXIOM_TEST_BROWSER='/path/to/chrome' npx tsx --import ./tests/vite-assets.mjs tests/model-accounts.check.ts
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_PROVIDER \
  AXIOM_TEST_BROWSER='/path/to/chrome' npx tsx --import ./tests/vite-assets.mjs tests/model-accounts-codex.check.ts
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_PROVIDER \
  AXIOM_TEST_BROWSER='/path/to/chrome' npx tsx tests/session-account-usage.check.ts
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_PROVIDER \
  AXIOM_TEST_BROWSER='/path/to/chrome' AXIOM_TEST_OUTPUT=/tmp/account-design-touch \
  npx tsx tests/model-accounts-design.check.ts
env -u AXIOM_EXECUTION_PROFILE -u AXIOM_MODEL_ACCOUNT_BINDINGS -u AXIOM_MODEL_PROVIDER \
  AXIOM_TEST_BROWSER='/path/to/chrome' AXIOM_TEST_TOUCH=0 AXIOM_TEST_OUTPUT=/tmp/account-design-fine \
  npx tsx tests/model-accounts-design.check.ts
npm run build
```

若从 Agent 执行环境运行浏览器检查，必须去掉父任务捕获的执行 profile/账号绑定，避免隔离测试后台继承其固定快照。`AXIOM_TEST_BROWSER` 指向已安装 Chrome；已安装匹配 Playwright Chromium 时可省略此变量。

供应商扩展修改后还应执行 `tests/provider-usage.check.ts` 和 `tests/provider-quota-estimate.check.ts`，检查原官方指标、Token 估值及供应商级窗口参考未被破坏（同样使用上述隔离环境和浏览器路径）。

测试使用私有临时目录、本地 API 登录和额度 fixture，不需要真实 OAuth、真实密钥或付费模型调用。`model-account-info.test.ts` 使用 Pi 内存凭据存储及原生 Kiro 的本地 fetch/callback fixture，检查企业选项成功保存与刷新保留、受限默认值和官方进度计算。新增 `model-accounts-codex.test.ts` / `model-accounts-codex.check.ts` 使用真正账号服务、缓存、worker 和上游适配器，仅在 worker 拦截 fetch 并禁止外部 socket，验证默认 `openai-codex` 下 legacy/A/B 逐账号的两次 GET、Bear­er/路由头、共享代理、缓存重建、邮箱/套餐/点数/重置日期与卡片显示，无需替换整个 usage 服务。后端测试还包含真实 worker IPC 登录隔离、原入口覆盖当前槽、失败/取消清理、凭据提交后的同步失败/取消/断线恢复、固定账号刷新写回、只读元数据、索引损坏及路径安全；浏览器检查覆盖单个 OpenAI 订阅账号、普通供应商 1 Auth 隐藏/2 Auth 显示、缺失认证不凑资格、完整窗口/点数/重置次数/金额未知边界、筛选与切换、迟到写响应不覆盖最新选择、真实 API Key 添加流程、取消失败后迟到完成及显式重试、指标刷新及桌面/移动布局。会话入口另有真实 Pi SDK/native Codex + 内存 WebSocket 的认证观察测试、cache-only/TOCTOU 测试、通过真实 `AgentRuns.launch` 安装接收器的 run/lease/请求代次测试，以及本地 HTTP/WebSocket 的权限/RPC 测试；它们各自证明不同层次，不用 coordinator 合成事件冒充 SDK/传输证据。会话 UI 检查覆盖零/未知、来源、切换/迟到/断线/隐藏、安全只读命令、8 组窄屏/主题截图及 75–200% 缩放。

当前整页设计见[账号信息直显与启用方案](model-accounts-inline.md)，被最新直显要求替代的折叠设计见[历史v4](model-accounts-redesign-v2.md)，八个平台研究及更早被拒收的方案见[原研究文档](model-account-card-design.md)。`model-accounts-design.check.ts` 使用真实页面与额度组件、本地合成 RPC，分别运行触屏和 fine-pointer 模式；每种 7 个视口 × 深浅主题 × 75/100/150/200% 应用字号共 56 组。另加入8组单账号 direct 完整首屏（桌面/手机/大字及深浅），检查无空报表、无重复当前按钮、无不可用刷新、缺资料诚实展示、官方辅助链接、原因直显及停止轮询；另测已有安全身份的direct完整展示与token-only来源说明，真实注入首次RPC失败与有缓存后失败/恢复。混排矩阵也包含 direct，覆盖长身份/区域/套餐/错误、零与未知/旧数据、完整日期、普通卡密度、控件边界与尺寸、可见正文对比度、自然 Tab/详情焦点恢复、筛选/空态，以及切换前后权威重读失败与恢复、同页真实断线重连挂起列表时的未确认及禁写。HTTP 仅允许临时 Vite 的确切 origin，WebSocket 仅允许该 origin 的 `/ws`；测试单独关闭 Vite dev 客户端的 HMR 启动而保留真实样式注入，不放开其他网络。

上述字号是应用 `fontScale`，不是浏览器 page zoom。检查基于 Chromium，文本对比度扫描不等于占位符、所有交互图形或完整 WCAG 审计；其他浏览器及真实供应商的在线授权、实际余额权限和付费请求不由这些 fixture 证明。构建产物生成不代表已重启或部署到运行中的后台。
