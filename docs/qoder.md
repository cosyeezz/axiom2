# Qoder 原生接入

## 状态与使用

Qoder 默认作为普通供应商提供，不需要实验开关，名称不带“实验性”。**真实账号链路尚未验收**，这属于验证状态，不作为隐藏入口或禁止调用的条件。本实现沿用 CodeBuddy 国内版的接入流程：参考 9Router、静态复核官方发布客户端、实现原生 provider、运行隔离测试。并非部署 9Router 网关，也不是把 Qoder 当成标准 OpenAI API。

原 `AXIOM_EXPERIMENTAL_QODER` 环境变量不再控制展示、登录、刷新、目录或推理；未设置或保留旧值 `0` 均可使用。此变更没有修改真实配置、启动登录、重启服务或部署。

“添加供应商”默认提供两个独立项：

| ID | 名称 | 认证 |
| --- | --- | --- |
| `qoder` | Qoder | 国际站 Personal Access Token（`pt-`）或浏览器设备授权 |
| `qoder-cn` | Qoder 国内版 | 国内站 PAT 或浏览器设备授权 |

添加供应商并保存认证后，手动拉取模型列表。已有旧目录的安装也应重新拉取，以更新视觉／思考能力描述。没有内置猜测的模型清单；目录不可用会明确失败。两个地区的认证与缓存隔离，不能混用 OAuth 凭据。PAT 无法从字符串本身判定地区，请选择其签发地区。

自定义 Base URL 不受支持；私有代理应使用其他供应商 ID，不能覆盖这两个原生 ID。默认展示不改变认证要求、地区隔离或协议限制；登录、刷新、目录和推理沿用正常认证与错误处理。

环境变量 PAT：国际站支持 `QODER_PERSONAL_ACCESS_TOKEN`（优先）或 `QODER_API_KEY`；国内站优先使用 `QODERCN_PERSONAL_ACCESS_TOKEN`，兼容 `QODER_CN_API_KEY`，避免误用国际站令牌。

## 已实现范围

- PKCE 设备授权、PAT 兑换临时任务令牌和查询用户身份。
- PAT 到期前重新兑换根 PAT；设备刷新采用官方公开客户端中的 `deviceToken/refresh` 请求结构，缺失字段、期限无效或失败时不伪造续期。
- COSY 签名、编码请求、动态模型目录及 legacy `agent_chat_generation` 流式接口。目录支持普通 JSON 和严格解码后的 JSON。
- V5 端点选举：只接受 HTTPS，国际站限定 `api1/api2/api3.qoder.sh`，国内站限定 `gateway.qoder.com.cn`；拒绝跨区、重定向、带凭据、非根路径和企业端点。不实现未验收的匿名 V3 降级，选举失败不会猜测端点。
- 动态目录同时规范化系统与账号 BYOK 模型、视觉／思考能力、effort 和上下文档位；`enable:false/0` 均排除。BYOK 私密配置只留在内存，按官方规则写入 `custom_model`，不进入公开模型描述或 `model_config`。
- 系统提示、文本、工具定义、分片/并行工具调用和工具结果；SSE 信封解包、延迟 usage 合并、取消及错误处理。
- 目录声明视觉能力的模型支持用户消息与工具结果中的 PNG/JPEG/GIF/WebP base64 图片；不支持的模型／格式明确拒绝。思考开关、目录允许的等级、预算及签名／加密 reasoning item 多轮回放已接入；`preserve=false` 去除历史思考。
- 账号目录中没有所选模型时失败，不回退到其他模型；推理失败不自动重放已签名请求。
- 本地请求体上限 6 MiB，JSON 响应及单个 SSE 事件上限 4 MiB，读取时累计检查；这是数据大小限制，不是整个进程的峰值内存保证。目录缓存 5 分钟。
- 可持久化公开模型描述以供离线快照恢复；令牌、用户/机器身份及私有目录配置不进入模型缓存。无外部并发改写时，冷启动不创建缺失的模型缓存，已有缓存恢复不重写认证或目录文件；并发删除/替换缓存的竞态尚未专项验证。

流式处理要求明确的 `finish_reason`；无结束状态的 EOF/裸 `[DONE]` 判为不完整响应。支持裸 JSON／envelope、quota／notification 控制帧和 `event:finish` 规则；检查结束状态冲突、结束后的新增内容及畸形工具参数。终态与最终 usage 后仍读取后续帧，仅在没有半帧且空闲一秒时本地完成，以避免无限 keepalive；此前的临时 usage 不满足完成条件。这与官方严格等到 EOF／裸 `[DONE]` 有意保留差异，详见[客户端行为对齐](qoder-client-parity.md)。

输入输出上限采用账号目录中的值；缺失时按官方发布物回退到 200000／32000，不代表服务端能力已验证。显式输出预算不再由 provider 按目录上限裁剪；显式上下文只接受合法档位，不自动抬高计费档位。高级采样、预算、上下文和功能开关入口见[客户端行为对齐](qoder-client-parity.md)。费用元数据初始为 0，**只表示未知，不表示免费**。自动模型的实际选择、费用和权限由供应商决定。

## 仍未验收

1. 真实 PAT → 用户信息 → 模型目录 → 最小聊天全链路；完整 COSY 签名及机器身份字段未与真实服务端验收。
2. 国内独立客户端发布物及国内真实账号闭环。国际客户端包含国内分支，不等于已经验证国内上线能力。
3. 真实设备登录、到期刷新、长期运行、真实工具执行与多轮上下文行为。
4. 企业组织、私有/VPC 端点、独立 security/fast 推理通道、服务账号、独立图片上传、新版 model-server HTTP/gRPC 传输。已支持的 base64 图片不等于实现官方全部附件前处理链。
5. 真实价格、计费和上下文档位；本实现不主动提高收费上下文档位。

不能仅因为 mock 测试通过而宣称稳定可用。后续需获得操作者明确授权，使用其合法账号、隔离配置和无敏感内容的测试会话进行联调；不应从本机现有客户端配置中自动提取凭据。

## 静态核验依据

- 9Router `v0.5.104`，commit `87a74e1bda3677193c6f71a7e2100c90311f0689`。参考 `open-sse/executors/qoder.js`、`shared/qoder/{cosy,encoding,sse}.js`、`services/qoderModels.js` 和 OAuth 服务。六个关键文件与公开 tag 字节一致。
- 官方 npm `@qoder-ai/qodercli@1.1.78`，下载产物通过 registry SHA-512 integrity 检查。对发布物做静态分析，并在隔离配置、禁网和禁子进程环境运行 help/version/list-models 探针；未执行签名 WASM、未登录真实账户。
- 官方 WASM 中完整 RSA PEM、自定义 Base64 字母表与参考实现相同；请求编码和响应解码有静态调用链支持。这不等于完整签名、所有头字段及账号策略逐字节一致。
- 官方 PAT `expires_in` 使用兼容启发式：大于 86400 当毫秒，否则当秒。设备授权相对期限按秒；绝对期限优先。无有效期限拒绝缓存。
- 最新官方客户端的国际 `api1/api2/api3` 是区域候选，并非 PAT/device 固定划分；登录后会进行端点选举。
- 官方仍默认 legacy 传输，body 的主要结构与参考相容；新版 `/model/v1/chat/completions` 不是可以自动切换的通用 OpenAI 端点。

参考实现使用 MIT 许可证。版权与完整许可声明保留在 [qoder-protocol.ts](../app/src/server/providers/qoder-protocol.ts)，适用于本目录中的 `qoder*.ts` 适配代码。公开发布物分析只用于协议核验，没有将官方 bundle/WASM 复制到产品。

## 离线验证

在 `app/` 下执行（使用隔离临时目录）：

```sh
TMPDIR=/private/tmp ./node_modules/.bin/tsx --import ./tests/vite-assets.mjs --test --test-concurrency=1 \
  tests/qoder-auth.test.ts tests/qoder-stream.test.ts tests/qoder-runtime.test.ts tests/qoder-parity.test.ts \
  tests/codebuddy-auth.test.ts tests/codebuddy-stream.test.ts \
  tests/codebuddy-runtime.test.ts tests/model-runtime.test.ts
./node_modules/.bin/tsc --noEmit --pretty false
```

前轮协议接入验证：上述七文件 **39/39 通过，退出码 0**；TypeScript 检查 **退出码 0**。回归包含已有 CodeBuddy 链路、冷启动不创建缓存及快照恢复不重写缓存/认证。默认展示改版将原禁用回归替换为无开关的登录／目录／推理、旧值 `0` 下的正常注册与模型可用性，并新增双地区名称和默认下拉断言。本轮十文件（上述七文件加 `kiro-runtime`、`model-oauth-config`、`models`）48/48通过，生产构建退出0；Chrome九视口及触控回归通过，两个Qoder名称及默认可见断言通过。首轮浏览器在初始按钮禁用处超时，原检查重跑及两份只读诊断均通过，未复现且根因未确定，未以固定延时绕过。最终注释同步后重跑构建、Qoder／通用runtime检查和浏览器检查均退出0。日志在 `/tmp/axiom-qoder-normal.UTOtoy/`，截图在其 `app/test-results/model-polish/`；未部署或重启正式服务。

本轮客户端行为对齐的最终结果：Qoder 四文件 27/27 通过；加 CodeBuddy 三文件和通用 model-runtime 后 **51/51 通过、退出 0**。TypeScript 检查与生产构建均退出 0。细节、扩展参数和剩余差异见[客户端行为对齐](qoder-client-parity.md)；以上历史浏览器检查不是本轮新增检查，本轮没有启动应用或重新手测浏览器。

Qoder runtime 测试对子进程预载 mock fetch 并禁用真实 socket；测试用认证值均为 fixture。测试覆盖的是本地适配器和 Axiom 运行时契约，不是供应商在线可用性。不要用仅替换父进程 fetch 的测试代替子进程网络隔离。
