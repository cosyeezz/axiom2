# Pi 依赖文件与符号全量附录

> 自动生成的识别范围：app/src 下的当前代码，排除 vite-cache/node_modules/.git。包含未提交文件；不包含测试及仓库外资源。这里只是语法依赖，不是完整运行时调用图。

HEAD：`da7c037fa0157a74a750ec044d165c73ca751b58`；Pi coding-agent：`1.1.0`。

源码 manifest SHA256：`9f42b477d57636707e0e1d2a078fee8f33357a1504d89e4f7931f8e80043dd78`。

## 1. 直接依赖文件（去重）

共 **94** 个。type/value 为源码显式声明，不代表编译擦除、实际执行或该文件没有实例方法调用。能力列按人工矩阵的来源映射。

| 文件 | 显式依赖分类 | 字面量模块引用点 | 包 | 能力ID |
| --- | --- | ---: | --- | --- |
| [server/agent-session-usage.ts](../../../app/src/server/agent-session-usage.ts) | type-only | 1 | pi-coding-agent | U01 |
| [server/agent-worker.ts](../../../app/src/server/agent-worker.ts) | mixed | 3 | pi-agent-core、pi-ai、pi-coding-agent | S01、S02、S03、S04、S05、S06、S07、I01、I02、I03、I05、I07、I08、I09、V01、V02、V03、V04、V05、V06、V08、V09、V10、T04、T05、T06、T07、T08、R08、C02、C03、C04、C05、C06、B07、P03、P07、P11 |
| [server/agents.ts](../../../app/src/server/agents.ts) | value-only | 1 | pi-coding-agent | S01、S04、S08、I01、T04、C02、B05、J10 |
| [server/agents/native-queue.ts](../../../app/src/server/agents/native-queue.ts) | type-only | 2 | pi-agent-core、pi-coding-agent | I06、I07、I09 |
| [server/agents/task-notifications.ts](../../../app/src/server/agents/task-notifications.ts) | type-only | 1 | pi-coding-agent | I11 |
| [server/auth.ts](../../../app/src/server/auth.ts) | mixed | 2 | pi-ai、pi-coding-agent | M06 |
| [server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts) | mixed | 4 | pi-agent-core、pi-ai、pi-coding-agent | R04 |
| [server/builtin-capabilities.ts](../../../app/src/server/builtin-capabilities.ts) | type-only | 1 | pi-coding-agent | R01、R03 |
| [server/canonical-native-observer.ts](../../../app/src/server/canonical-native-observer.ts) | type-only | 1 | pi-coding-agent | A12 |
| [server/canonical-projection-coordinator.ts](../../../app/src/server/canonical-projection-coordinator.ts) | type-only | 1 | pi-coding-agent | A12 |
| [server/canonical-publisher-bridge.ts](../../../app/src/server/canonical-publisher-bridge.ts) | type-only | 1 | pi-coding-agent | A12 |
| [server/canonical-publisher-mux.ts](../../../app/src/server/canonical-publisher-mux.ts) | type-only | 1 | pi-coding-agent | A12 |
| [server/capability-resources.ts](../../../app/src/server/capability-resources.ts) | mixed | 2 | pi-coding-agent | R01、R08 |
| [server/compaction-display.ts](../../../app/src/server/compaction-display.ts) | mixed | 1 | pi-coding-agent | A07、P14 |
| [server/compression-context.ts](../../../app/src/server/compression-context.ts) | mixed | 1 | pi-coding-agent | S07、P02、P06、P10、P11、P13 |
| [server/compression-memory.ts](../../../app/src/server/compression-memory.ts) | type-only | 2 | pi-agent-core、pi-coding-agent | P04、J08 |
| [server/compression-request.ts](../../../app/src/server/compression-request.ts) | mixed | 2 | pi-ai、pi-coding-agent | P07、P08、P09 |
| [server/compression-worker.ts](../../../app/src/server/compression-worker.ts) | mixed | 2 | pi-ai、pi-coding-agent | P05、P06、P09、P12、U04 |
| [server/compressions.ts](../../../app/src/server/compressions.ts) | type-only | 1 | pi-coding-agent | P01、P02、P04、P12、P14 |
| [server/context-usage.ts](../../../app/src/server/context-usage.ts) | mixed | 2 | pi-ai、pi-coding-agent | A03、U03 |
| [server/costs.ts](../../../app/src/server/costs.ts) | type-only | 1 | pi-coding-agent | U02、U07、U08、U10 |
| [server/environment-resources.ts](../../../app/src/server/environment-resources.ts) | mixed | 1 | pi-coding-agent | R01、R04 |
| [server/execution-outcome.ts](../../../app/src/server/execution-outcome.ts) | type-only | 1 | pi-agent-core | S03、V04 |
| [server/execution-profile.ts](../../../app/src/server/execution-profile.ts) | value-only | 1 | pi-coding-agent | E04、E05、E06、E07、E10 |
| [server/file-edit.ts](../../../app/src/server/file-edit.ts) | value-only | 1 | pi-coding-agent | R12、H07 |
| [server/files.ts](../../../app/src/server/files.ts) | value-only | 2 | pi-coding-agent、pi-tui | R12、H07 |
| [server/history-projection.ts](../../../app/src/server/history-projection.ts) | type-only | 1 | pi-coding-agent | A07 |
| [server/images.ts](../../../app/src/server/images.ts) | type-only | 1 | pi-ai | I03、A06 |
| [server/index.ts](../../../app/src/server/index.ts) | value-only | 1 | pi-coding-agent | H01、H05、H06、H07 |
| [server/input-continuation.ts](../../../app/src/server/input-continuation.ts) | type-only | 1 | pi-coding-agent | I04、A04、A11、B06 |
| [server/installed-resource-loader.ts](../../../app/src/server/installed-resource-loader.ts) | value-only | 1 | pi-coding-agent | R02 |
| [server/integrations/model-proxy-tools.ts](../../../app/src/server/integrations/model-proxy-tools.ts) | mixed | 2 | pi-coding-agent、pi-mcp | R09 |
| [server/integrations/opencli-resources.ts](../../../app/src/server/integrations/opencli-resources.ts) | value-only | 1 | pi-coding-agent | R12 |
| [server/integrations/opencli.ts](../../../app/src/server/integrations/opencli.ts) | value-only | 1 | pi-coding-agent | R12 |
| [server/integrations/rea-diagnostic-worker.ts](../../../app/src/server/integrations/rea-diagnostic-worker.ts) | value-only | 1 | pi-mcp | R09 |
| [server/integrations/rea-resources.ts](../../../app/src/server/integrations/rea-resources.ts) | mixed | 1 | pi-coding-agent | R12 |
| [server/integrations/rea-tool-policy.ts](../../../app/src/server/integrations/rea-tool-policy.ts) | type-only | 1 | pi-coding-agent | T09 |
| [server/integrations/rtk-runtime.ts](../../../app/src/server/integrations/rtk-runtime.ts) | type-only | 1 | pi-coding-agent | T09 |
| [server/kiro-cache-policy.ts](../../../app/src/server/kiro-cache-policy.ts) | type-only | 1 | pi-coding-agent | M10 |
| [server/kiro-compaction-usage.ts](../../../app/src/server/kiro-compaction-usage.ts) | type-only | 2 | pi-ai、pi-coding-agent | U04 |
| [server/memory-recovery.ts](../../../app/src/server/memory-recovery.ts) | type-only | 1 | pi-coding-agent | T06、A11、J08 |
| [server/memory-tool.ts](../../../app/src/server/memory-tool.ts) | value-only | 1 | pi-coding-agent | T02、T03、J06 |
| [server/memory-topics.ts](../../../app/src/server/memory-topics.ts) | type-only | 1 | pi-coding-agent | A11、J08 |
| [server/memory-worker.ts](../../../app/src/server/memory-worker.ts) | mixed | 2 | pi-ai、pi-coding-agent | M11、M12、M14 |
| [server/model-copies.ts](../../../app/src/server/model-copies.ts) | mixed | 2 | pi-ai、pi-coding-agent | M03、M15 |
| [server/model-discovery.ts](../../../app/src/server/model-discovery.ts) | type-only | 1 | pi-ai | M02 |
| [server/model-latency.ts](../../../app/src/server/model-latency.ts) | mixed | 3 | pi-agent-core、pi-ai | U06 |
| [server/model-metadata.ts](../../../app/src/server/model-metadata.ts) | type-only | 1 | pi-ai | M03、M04 |
| [server/model-network-worker.ts](../../../app/src/server/model-network-worker.ts) | value-only | 1 | pi-coding-agent | M07 |
| [server/model-network.ts](../../../app/src/server/model-network.ts) | mixed | 2 | pi-ai、pi-coding-agent | C04、M07 |
| [server/model-runtime.ts](../../../app/src/server/model-runtime.ts) | value-only | 1 | pi-coding-agent | M01、M05、M14 |
| [server/model-service.ts](../../../app/src/server/model-service.ts) | mixed | 1 | pi-coding-agent | M01、M04、M05、M06 |
| [server/models.ts](../../../app/src/server/models.ts) | value-only | 1 | pi-ai | M02、M04 |
| [server/models/draft.ts](../../../app/src/server/models/draft.ts) | mixed | 2 | pi-ai、pi-coding-agent | M02 |
| [server/native-compaction-policy.ts](../../../app/src/server/native-compaction-policy.ts) | type-only | 1 | pi-coding-agent | P13 |
| [server/native-compaction-usage.ts](../../../app/src/server/native-compaction-usage.ts) | type-only | 2 | pi-ai、pi-coding-agent | U04、U10 |
| [server/pi-package-storage.ts](../../../app/src/server/pi-package-storage.ts) | value-only | 3 | pi-coding-agent | R10、R11 |
| [server/pi-settings-storage.ts](../../../app/src/server/pi-settings-storage.ts) | value-only | 1 | pi-coding-agent | R11 |
| [server/provider-request-observer.ts](../../../app/src/server/provider-request-observer.ts) | mixed | 4 | pi-agent-core、pi-ai、pi-coding-agent | M15、U05 |
| [server/provider-usage.ts](../../../app/src/server/provider-usage.ts) | mixed | 2 | pi-ai、pi-coding-agent | M13 |
| [server/providers/codebuddy-auth.ts](../../../app/src/server/providers/codebuddy-auth.ts) | type-only | 1 | pi-ai | M08 |
| [server/providers/codebuddy-cn.ts](../../../app/src/server/providers/codebuddy-cn.ts) | mixed | 2 | pi-ai | M08 |
| [server/providers/codebuddy-models.ts](../../../app/src/server/providers/codebuddy-models.ts) | type-only | 1 | pi-ai | M08 |
| [server/providers/kiro-auth.ts](../../../app/src/server/providers/kiro-auth.ts) | type-only | 1 | pi-ai | M10 |
| [server/providers/kiro-callback.ts](../../../app/src/server/providers/kiro-callback.ts) | type-only | 1 | pi-ai | M10 |
| [server/providers/kiro-catalog.ts](../../../app/src/server/providers/kiro-catalog.ts) | type-only | 1 | pi-ai | M10 |
| [server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts) | mixed | 1 | pi-ai | M10、M16 |
| [server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts) | mixed | 1 | pi-ai | M10、M14 |
| [server/providers/kiro-thinking.ts](../../../app/src/server/providers/kiro-thinking.ts) | mixed | 1 | pi-ai | M10 |
| [server/providers/kiro-usage.ts](../../../app/src/server/providers/kiro-usage.ts) | mixed | 1 | pi-ai | M10 |
| [server/providers/kiro.ts](../../../app/src/server/providers/kiro.ts) | type-only | 1 | pi-ai | M10 |
| [server/providers/openai-usage.ts](../../../app/src/server/providers/openai-usage.ts) | type-only | 1 | pi-ai | M13 |
| [server/providers/qoder-auth.ts](../../../app/src/server/providers/qoder-auth.ts) | type-only | 1 | pi-ai | M09 |
| [server/providers/qoder-catalog.ts](../../../app/src/server/providers/qoder-catalog.ts) | type-only | 1 | pi-ai | M09 |
| [server/providers/qoder-client.ts](../../../app/src/server/providers/qoder-client.ts) | mixed | 1 | pi-ai | M09、M16 |
| [server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) | mixed | 2 | pi-ai | M09 |
| [server/reload-resources.ts](../../../app/src/server/reload-resources.ts) | type-only | 1 | pi-coding-agent | T01、R06、C06 |
| [server/reload-resume.ts](../../../app/src/server/reload-resume.ts) | type-only | 2 | pi-agent-core、pi-coding-agent | C07、B09 |
| [server/request-selection.ts](../../../app/src/server/request-selection.ts) | type-only | 1 | pi-coding-agent | V06、C03、A11、U01 |
| [server/request-usage.ts](../../../app/src/server/request-usage.ts) | type-only | 1 | pi-coding-agent | U01、U10 |
| [server/resources.ts](../../../app/src/server/resources.ts) | mixed | 2 | pi-coding-agent | R09、R10 |
| [server/resume-session.ts](../../../app/src/server/resume-session.ts) | type-only | 2 | pi-agent-core、pi-coding-agent | T10、B07、B08、B09 |
| [server/session-environment.ts](../../../app/src/server/session-environment.ts) | mixed | 1 | pi-coding-agent | T01、T05、R05、R06 |
| [server/session-fork.ts](../../../app/src/server/session-fork.ts) | value-only | 1 | pi-coding-agent | B01、B02、B03 |
| [server/session-reloads.ts](../../../app/src/server/session-reloads.ts) | value-only | 1 | pi-coding-agent | C08 |
| [server/session-rewrite.ts](../../../app/src/server/session-rewrite.ts) | type-only | 1 | pi-coding-agent | B04、B05、B06 |
| [server/session-safe-point.ts](../../../app/src/server/session-safe-point.ts) | type-only | 1 | pi-coding-agent | C01、C04、C05、P03 |
| [server/skill-discovery.ts](../../../app/src/server/skill-discovery.ts) | mixed | 1 | pi-coding-agent | I03、R02、R03、C06 |
| [server/skill-import.ts](../../../app/src/server/skill-import.ts) | value-only | 1 | pi-coding-agent | R03 |
| [server/skill-input.ts](../../../app/src/server/skill-input.ts) | type-only | 1 | pi-coding-agent | I03、R03 |
| [server/task-tools.ts](../../../app/src/server/task-tools.ts) | value-only | 1 | pi-coding-agent | T02、J02 |
| [server/tasks/delivery.ts](../../../app/src/server/tasks/delivery.ts) | type-only | 1 | pi-coding-agent | I11、T10、B06、J04、J05 |
| [server/transcript.ts](../../../app/src/server/transcript.ts) | value-only | 1 | pi-coding-agent | V01、V02、A01、A02、A03、A04、A05、A06、A08、B01、H04 |
| [server/usage-accounts.ts](../../../app/src/server/usage-accounts.ts) | value-only | 1 | pi-coding-agent | M05、M13 |

## 2. 导入符号全量表

共 **100** 个包内去重符号，**277** 个本地导入绑定。下表声明数可求和；包/文件数存在交集不得跨包直接相加。直接调用/构造仅统计以导入绑定为根的语法引用，不包含session实例方法，更不是运行频率。

### @earendil-works/pi-agent-core（2 符号）

| 导入名 | 绑定数 | type绑定 | value绑定 | 直接调用或构造引用 | 来源 |
| --- | ---: | ---: | ---: | ---: | --- |
| `AgentMessage` | 7 | 7 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/agents/native-queue.ts](../../../app/src/server/agents/native-queue.ts)、[server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts)、[server/compression-memory.ts](../../../app/src/server/compression-memory.ts)、[server/execution-outcome.ts](../../../app/src/server/execution-outcome.ts)、[server/reload-resume.ts](../../../app/src/server/reload-resume.ts)、[server/resume-session.ts](../../../app/src/server/resume-session.ts) |
| `StreamFn` | 2 | 2 | 0 | 0 | [server/model-latency.ts](../../../app/src/server/model-latency.ts)、[server/provider-request-observer.ts](../../../app/src/server/provider-request-observer.ts) |

### @earendil-works/pi-ai（43 符号）

| 导入名 | 绑定数 | type绑定 | value绑定 | 直接调用或构造引用 | 来源 |
| --- | ---: | ---: | ---: | ---: | --- |
| `AnyModel` | 1 | 1 | 0 | 0 | [server/model-copies.ts](../../../app/src/server/model-copies.ts) |
| `Api` | 11 | 11 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/model-copies.ts](../../../app/src/server/model-copies.ts)、[server/providers/kiro-catalog.ts](../../../app/src/server/providers/kiro-catalog.ts)、[server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts)、[server/providers/kiro-thinking.ts](../../../app/src/server/providers/kiro-thinking.ts)、[server/providers/kiro-usage.ts](../../../app/src/server/providers/kiro-usage.ts)、[server/providers/kiro.ts](../../../app/src/server/providers/kiro.ts)、[server/providers/qoder-client.ts](../../../app/src/server/providers/qoder-client.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `AssistantMessage` | 5 | 5 | 0 | 0 | [server/compression-worker.ts](../../../app/src/server/compression-worker.ts)、[server/kiro-compaction-usage.ts](../../../app/src/server/kiro-compaction-usage.ts)、[server/model-copies.ts](../../../app/src/server/model-copies.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts)、[server/providers/kiro-usage.ts](../../../app/src/server/providers/kiro-usage.ts) |
| `AssistantMessageEventStream` | 2 | 2 | 0 | 0 | [server/model-copies.ts](../../../app/src/server/model-copies.ts)、[server/model-latency.ts](../../../app/src/server/model-latency.ts) |
| `AuthEvent` | 2 | 2 | 0 | 0 | [server/auth.ts](../../../app/src/server/auth.ts)、[server/model-network.ts](../../../app/src/server/model-network.ts) |
| `AuthPrompt` | 2 | 2 | 0 | 0 | [server/auth.ts](../../../app/src/server/auth.ts)、[server/model-network.ts](../../../app/src/server/model-network.ts) |
| `Context` | 1 | 1 | 0 | 0 | [server/model-copies.ts](../../../app/src/server/model-copies.ts) |
| `Credential` | 3 | 3 | 0 | 0 | [server/model-metadata.ts](../../../app/src/server/model-metadata.ts)、[server/provider-usage.ts](../../../app/src/server/provider-usage.ts)、[server/providers/kiro-catalog.ts](../../../app/src/server/providers/kiro-catalog.ts) |
| `CredentialStore` | 1 | 1 | 0 | 0 | [server/model-metadata.ts](../../../app/src/server/model-metadata.ts) |
| `ImageContent` | 1 | 1 | 0 | 0 | [server/images.ts](../../../app/src/server/images.ts) |
| `Message` | 1 | 1 | 0 | 0 | [server/compression-request.ts](../../../app/src/server/compression-request.ts) |
| `Model` | 13 | 13 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/model-copies.ts](../../../app/src/server/model-copies.ts)、[server/providers/codebuddy-models.ts](../../../app/src/server/providers/codebuddy-models.ts)、[server/providers/kiro-catalog.ts](../../../app/src/server/providers/kiro-catalog.ts)、[server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts)、[server/providers/kiro-thinking.ts](../../../app/src/server/providers/kiro-thinking.ts)、[server/providers/kiro-usage.ts](../../../app/src/server/providers/kiro-usage.ts)、[server/providers/kiro.ts](../../../app/src/server/providers/kiro.ts)、[server/providers/qoder-catalog.ts](../../../app/src/server/providers/qoder-catalog.ts)、[server/providers/qoder-client.ts](../../../app/src/server/providers/qoder-client.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `ModelAuth` | 1 | 1 | 0 | 0 | [server/model-discovery.ts](../../../app/src/server/model-discovery.ts) |
| `ModelsStoreEntry` | 2 | 2 | 0 | 0 | [server/model-metadata.ts](../../../app/src/server/model-metadata.ts)、[server/providers/kiro.ts](../../../app/src/server/providers/kiro.ts) |
| `OAuthAuth` | 4 | 4 | 0 | 0 | [server/providers/codebuddy-auth.ts](../../../app/src/server/providers/codebuddy-auth.ts)、[server/providers/kiro-auth.ts](../../../app/src/server/providers/kiro-auth.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts)、[server/providers/qoder-auth.ts](../../../app/src/server/providers/qoder-auth.ts) |
| `OAuthCredential` | 5 | 5 | 0 | 0 | [server/provider-usage.ts](../../../app/src/server/provider-usage.ts)、[server/providers/codebuddy-auth.ts](../../../app/src/server/providers/codebuddy-auth.ts)、[server/providers/kiro-auth.ts](../../../app/src/server/providers/kiro-auth.ts)、[server/providers/openai-usage.ts](../../../app/src/server/providers/openai-usage.ts)、[server/providers/qoder-auth.ts](../../../app/src/server/providers/qoder-auth.ts) |
| `Provider` | 2 | 2 | 0 | 0 | [server/provider-request-observer.ts](../../../app/src/server/provider-request-observer.ts)、[server/providers/kiro.ts](../../../app/src/server/providers/kiro.ts) |
| `ProviderAuthInteraction` | 2 | 2 | 0 | 0 | [server/providers/kiro-auth.ts](../../../app/src/server/providers/kiro-auth.ts)、[server/providers/kiro-callback.ts](../../../app/src/server/providers/kiro-callback.ts) |
| `SimpleStreamOptions` | 2 | 2 | 0 | 0 | [server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `StreamOptions` | 4 | 4 | 0 | 0 | [server/providers/codebuddy-cn.ts](../../../app/src/server/providers/codebuddy-cn.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts)、[server/providers/qoder-client.ts](../../../app/src/server/providers/qoder-client.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `SystemMessage` | 1 | 1 | 0 | 0 | [server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts) |
| `TextContent` | 1 | 1 | 0 | 0 | [server/images.ts](../../../app/src/server/images.ts) |
| `ThinkingLevel` | 1 | 1 | 0 | 0 | [server/providers/codebuddy-models.ts](../../../app/src/server/providers/codebuddy-models.ts) |
| `ThinkingLevelMap` | 2 | 2 | 0 | 0 | [server/providers/kiro-thinking.ts](../../../app/src/server/providers/kiro-thinking.ts)、[server/providers/qoder-catalog.ts](../../../app/src/server/providers/qoder-catalog.ts) |
| `ToolCall` | 1 | 1 | 0 | 0 | [server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts) |
| `TranscriptContext` | 5 | 5 | 0 | 0 | [server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts)、[server/providers/qoder-client.ts](../../../app/src/server/providers/qoder-client.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `Usage` | 3 | 3 | 0 | 0 | [server/kiro-compaction-usage.ts](../../../app/src/server/kiro-compaction-usage.ts)、[server/native-compaction-usage.ts](../../../app/src/server/native-compaction-usage.ts)、[server/providers/kiro-usage.ts](../../../app/src/server/providers/kiro-usage.ts) |
| `calculateCost` | 1 | 0 | 1 | 1 | [server/providers/kiro-usage.ts](../../../app/src/server/providers/kiro-usage.ts) |
| `cleanupSessionResources` | 1 | 0 | 1 | 1 | [server/memory-worker.ts](../../../app/src/server/memory-worker.ts) |
| `collapseSystemMessages` | 1 | 0 | 1 | 1 | [server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts) |
| `createAssistantMessageEventStream` | 4 | 0 | 4 | 4 | [server/model-copies.ts](../../../app/src/server/model-copies.ts)、[server/model-latency.ts](../../../app/src/server/model-latency.ts)、[server/provider-request-observer.ts](../../../app/src/server/provider-request-observer.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts) |
| `createProvider` | 2 | 0 | 2 | 2 | [server/providers/codebuddy-cn.ts](../../../app/src/server/providers/codebuddy-cn.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `envApiKeyAuth` | 2 | 0 | 2 | 2 | [server/providers/codebuddy-cn.ts](../../../app/src/server/providers/codebuddy-cn.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `getApiProvider` | 2 | 0 | 2 | 4 | [server/model-latency.ts](../../../app/src/server/model-latency.ts)、[server/provider-request-observer.ts](../../../app/src/server/provider-request-observer.ts) |
| `getCurrentSystemMessage` | 3 | 0 | 3 | 3 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts)、[server/context-usage.ts](../../../app/src/server/context-usage.ts) |
| `getCurrentSystemPrompt` | 2 | 0 | 2 | 2 | [server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts)、[server/providers/qoder-client.ts](../../../app/src/server/providers/qoder-client.ts) |
| `getCurrentTools` | 2 | 0 | 2 | 2 | [server/providers/kiro-chat-protocol.ts](../../../app/src/server/providers/kiro-chat-protocol.ts)、[server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts) |
| `getSupportedThinkingLevels` | 4 | 0 | 4 | 5 | [server/memory-worker.ts](../../../app/src/server/memory-worker.ts)、[server/models.ts](../../../app/src/server/models.ts)、[server/models/draft.ts](../../../app/src/server/models/draft.ts)、[server/providers/kiro-thinking.ts](../../../app/src/server/providers/kiro-thinking.ts) |
| `getSystemMessageText` | 3 | 0 | 3 | 2 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts) |
| `lazyApi` | 2 | 0 | 2 | 2 | [server/providers/codebuddy-cn.ts](../../../app/src/server/providers/codebuddy-cn.ts)、[server/providers/qoder.ts](../../../app/src/server/providers/qoder.ts) |
| `normalizeContext` | 1 | 0 | 1 | 3 | [server/compression-request.ts](../../../app/src/server/compression-request.ts) |
| `parseStreamingJson` | 1 | 0 | 1 | 1 | [server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts) |
| `validateToolArguments` | 1 | 0 | 1 | 1 | [server/providers/kiro-chat.ts](../../../app/src/server/providers/kiro-chat.ts) |

### @earendil-works/pi-coding-agent（51 符号）

| 导入名 | 绑定数 | type绑定 | value绑定 | 直接调用或构造引用 | 来源 |
| --- | ---: | ---: | ---: | ---: | --- |
| `AgentSession` | 18 | 18 | 0 | 0 | [server/agent-session-usage.ts](../../../app/src/server/agent-session-usage.ts)、[server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/agents/native-queue.ts](../../../app/src/server/agents/native-queue.ts)、[server/agents/task-notifications.ts](../../../app/src/server/agents/task-notifications.ts)、[server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts)、[server/canonical-publisher-bridge.ts](../../../app/src/server/canonical-publisher-bridge.ts)、[server/canonical-publisher-mux.ts](../../../app/src/server/canonical-publisher-mux.ts)、[server/compression-memory.ts](../../../app/src/server/compression-memory.ts)、[server/compression-worker.ts](../../../app/src/server/compression-worker.ts)、[server/kiro-compaction-usage.ts](../../../app/src/server/kiro-compaction-usage.ts)、[server/native-compaction-usage.ts](../../../app/src/server/native-compaction-usage.ts)、[server/reload-resources.ts](../../../app/src/server/reload-resources.ts)、[server/reload-resume.ts](../../../app/src/server/reload-resume.ts)、[server/resume-session.ts](../../../app/src/server/resume-session.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts)、[server/session-safe-point.ts](../../../app/src/server/session-safe-point.ts)、[server/skill-discovery.ts](../../../app/src/server/skill-discovery.ts)、[server/skill-input.ts](../../../app/src/server/skill-input.ts) |
| `AgentSessionEvent` | 2 | 2 | 0 | 0 | [server/canonical-publisher-bridge.ts](../../../app/src/server/canonical-publisher-bridge.ts)、[server/canonical-publisher-mux.ts](../../../app/src/server/canonical-publisher-mux.ts) |
| `AgentSessionEventListener` | 1 | 1 | 0 | 0 | [server/canonical-publisher-mux.ts](../../../app/src/server/canonical-publisher-mux.ts) |
| `BashSpawnHook` | 1 | 1 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts) |
| `BoundaryResult` | 2 | 2 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compression-memory.ts](../../../app/src/server/compression-memory.ts) |
| `BoundaryState` | 3 | 3 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compression-memory.ts](../../../app/src/server/compression-memory.ts)、[server/session-safe-point.ts](../../../app/src/server/session-safe-point.ts) |
| `BuildSystemPromptOptions` | 1 | 1 | 0 | 0 | [server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts) |
| `CompactionEntry` | 4 | 4 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compaction-display.ts](../../../app/src/server/compaction-display.ts)、[server/compression-context.ts](../../../app/src/server/compression-context.ts)、[server/compressions.ts](../../../app/src/server/compressions.ts) |
| `CompactionEntryDraft` | 2 | 2 | 0 | 0 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compression-context.ts](../../../app/src/server/compression-context.ts) |
| `CredentialSynchronizationError` | 4 | 0 | 4 | 2 | [server/auth.ts](../../../app/src/server/auth.ts)、[server/model-network-worker.ts](../../../app/src/server/model-network-worker.ts)、[server/model-network.ts](../../../app/src/server/model-network.ts)、[server/model-service.ts](../../../app/src/server/model-service.ts) |
| `DefaultPackageManager` | 4 | 0 | 4 | 4 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts)、[server/installed-resource-loader.ts](../../../app/src/server/installed-resource-loader.ts)、[server/pi-package-storage.ts](../../../app/src/server/pi-package-storage.ts)、[server/resources.ts](../../../app/src/server/resources.ts) |
| `DefaultResourceLoader` | 4 | 1 | 3 | 3 | [server/compression-worker.ts](../../../app/src/server/compression-worker.ts)、[server/environment-resources.ts](../../../app/src/server/environment-resources.ts)、[server/installed-resource-loader.ts](../../../app/src/server/installed-resource-loader.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `ExtensionFactory` | 2 | 2 | 0 | 0 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts)、[server/integrations/rtk-runtime.ts](../../../app/src/server/integrations/rtk-runtime.ts) |
| `McpExtensionOptions` | 4 | 4 | 0 | 0 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts)、[server/integrations/model-proxy-tools.ts](../../../app/src/server/integrations/model-proxy-tools.ts)、[server/integrations/rea-resources.ts](../../../app/src/server/integrations/rea-resources.ts)、[server/resources.ts](../../../app/src/server/resources.ts) |
| `ModelRegistry` | 1 | 0 | 1 | 1 | [server/model-service.ts](../../../app/src/server/model-service.ts) |
| `ModelRuntime` | 6 | 5 | 1 | 1 | [server/memory-worker.ts](../../../app/src/server/memory-worker.ts)、[server/model-copies.ts](../../../app/src/server/model-copies.ts)、[server/model-runtime.ts](../../../app/src/server/model-runtime.ts)、[server/model-service.ts](../../../app/src/server/model-service.ts)、[server/models/draft.ts](../../../app/src/server/models/draft.ts)、[server/provider-request-observer.ts](../../../app/src/server/provider-request-observer.ts) |
| `ResourceLoader` | 1 | 1 | 0 | 0 | [server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `SessionBeforeCompactEvent` | 3 | 3 | 0 | 0 | [server/compression-context.ts](../../../app/src/server/compression-context.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/compression-worker.ts](../../../app/src/server/compression-worker.ts) |
| `SessionEntry` | 6 | 6 | 0 | 0 | [server/compaction-display.ts](../../../app/src/server/compaction-display.ts)、[server/compression-context.ts](../../../app/src/server/compression-context.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/context-usage.ts](../../../app/src/server/context-usage.ts)、[server/costs.ts](../../../app/src/server/costs.ts)、[server/request-selection.ts](../../../app/src/server/request-selection.ts) |
| `SessionHeader` | 1 | 1 | 0 | 0 | [server/compression-context.ts](../../../app/src/server/compression-context.ts) |
| `SessionManager` | 17 | 13 | 4 | 5 | [server/agents.ts](../../../app/src/server/agents.ts)、[server/canonical-native-observer.ts](../../../app/src/server/canonical-native-observer.ts)、[server/canonical-projection-coordinator.ts](../../../app/src/server/canonical-projection-coordinator.ts)、[server/canonical-publisher-bridge.ts](../../../app/src/server/canonical-publisher-bridge.ts)、[server/compression-context.ts](../../../app/src/server/compression-context.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/context-usage.ts](../../../app/src/server/context-usage.ts)、[server/history-projection.ts](../../../app/src/server/history-projection.ts)、[server/input-continuation.ts](../../../app/src/server/input-continuation.ts)、[server/memory-recovery.ts](../../../app/src/server/memory-recovery.ts)、[server/memory-topics.ts](../../../app/src/server/memory-topics.ts)、[server/request-usage.ts](../../../app/src/server/request-usage.ts)、[server/session-fork.ts](../../../app/src/server/session-fork.ts)、[server/session-reloads.ts](../../../app/src/server/session-reloads.ts)、[server/session-rewrite.ts](../../../app/src/server/session-rewrite.ts)、[server/tasks/delivery.ts](../../../app/src/server/tasks/delivery.ts)、[server/transcript.ts](../../../app/src/server/transcript.ts) |
| `SettingsManager` | 9 | 2 | 7 | 10 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/capability-resources.ts](../../../app/src/server/capability-resources.ts)、[server/compression-worker.ts](../../../app/src/server/compression-worker.ts)、[server/execution-profile.ts](../../../app/src/server/execution-profile.ts)、[server/kiro-cache-policy.ts](../../../app/src/server/kiro-cache-policy.ts)、[server/native-compaction-policy.ts](../../../app/src/server/native-compaction-policy.ts)、[server/pi-package-storage.ts](../../../app/src/server/pi-package-storage.ts)、[server/resources.ts](../../../app/src/server/resources.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `Skill` | 1 | 1 | 0 | 0 | [server/builtin-capabilities.ts](../../../app/src/server/builtin-capabilities.ts) |
| `ToolDefinition` | 2 | 2 | 0 | 0 | [server/integrations/rea-tool-policy.ts](../../../app/src/server/integrations/rea-tool-policy.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `ToolResultEvent` | 1 | 1 | 0 | 0 | [server/integrations/rtk-runtime.ts](../../../app/src/server/integrations/rtk-runtime.ts) |
| `ToolResultEventResult` | 1 | 1 | 0 | 0 | [server/integrations/rtk-runtime.ts](../../../app/src/server/integrations/rtk-runtime.ts) |
| `buildSessionProjection` | 6 | 0 | 6 | 7 | [server/compaction-display.ts](../../../app/src/server/compaction-display.ts)、[server/compression-context.ts](../../../app/src/server/compression-context.ts)、[server/compression-request.ts](../../../app/src/server/compression-request.ts)、[server/compression-worker.ts](../../../app/src/server/compression-worker.ts)、[server/context-usage.ts](../../../app/src/server/context-usage.ts)、[server/transcript.ts](../../../app/src/server/transcript.ts) |
| `calculateContextTokens` | 1 | 0 | 1 | 1 | [server/context-usage.ts](../../../app/src/server/context-usage.ts) |
| `convertToLlm` | 1 | 0 | 1 | 5 | [server/compression-request.ts](../../../app/src/server/compression-request.ts) |
| `createAgentSession` | 2 | 0 | 2 | 2 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/compression-worker.ts](../../../app/src/server/compression-worker.ts) |
| `createBashToolDefinition` | 2 | 0 | 2 | 2 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createCodemodeExtension` | 1 | 0 | 1 | 1 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts) |
| `createEditToolDefinition` | 2 | 0 | 2 | 2 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createFindToolDefinition` | 1 | 0 | 1 | 1 | [server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createGrepToolDefinition` | 1 | 0 | 1 | 1 | [server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createLsToolDefinition` | 1 | 0 | 1 | 1 | [server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createMcpExtension` | 1 | 0 | 1 | 1 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts) |
| `createPowerShellToolDefinition` | 2 | 0 | 2 | 2 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createReadToolDefinition` | 1 | 0 | 1 | 1 | [server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `createToolSearchExtension` | 1 | 0 | 1 | 1 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts) |
| `createWriteToolDefinition` | 2 | 0 | 2 | 2 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts)、[server/session-environment.ts](../../../app/src/server/session-environment.ts) |
| `defineTool` | 2 | 0 | 2 | 5 | [server/memory-tool.ts](../../../app/src/server/memory-tool.ts)、[server/task-tools.ts](../../../app/src/server/task-tools.ts) |
| `estimateTokens` | 2 | 0 | 2 | 4 | [server/compaction-display.ts](../../../app/src/server/compaction-display.ts)、[server/context-usage.ts](../../../app/src/server/context-usage.ts) |
| `getAgentDir` | 5 | 0 | 5 | 8 | [server/execution-profile.ts](../../../app/src/server/execution-profile.ts)、[server/files.ts](../../../app/src/server/files.ts)、[server/index.ts](../../../app/src/server/index.ts)、[server/model-runtime.ts](../../../app/src/server/model-runtime.ts)、[server/resources.ts](../../../app/src/server/resources.ts) |
| `getShellConfig` | 1 | 0 | 1 | 1 | [server/integrations/model-proxy-tools.ts](../../../app/src/server/integrations/model-proxy-tools.ts) |
| `loadSkills` | 7 | 0 | 7 | 24 | [server/capability-resources.ts](../../../app/src/server/capability-resources.ts)、[server/environment-resources.ts](../../../app/src/server/environment-resources.ts)、[server/integrations/opencli-resources.ts](../../../app/src/server/integrations/opencli-resources.ts)、[server/integrations/opencli.ts](../../../app/src/server/integrations/opencli.ts)、[server/integrations/rea-resources.ts](../../../app/src/server/integrations/rea-resources.ts)、[server/resources.ts](../../../app/src/server/resources.ts)、[server/skill-discovery.ts](../../../app/src/server/skill-discovery.ts) |
| `parseFrontmatter` | 1 | 0 | 1 | 1 | [server/file-edit.ts](../../../app/src/server/file-edit.ts) |
| `parseSessionEntries` | 1 | 0 | 1 | 1 | [server/transcript.ts](../../../app/src/server/transcript.ts) |
| `readStoredCredential` | 5 | 0 | 5 | 10 | [server/model-network-worker.ts](../../../app/src/server/model-network-worker.ts)、[server/model-runtime.ts](../../../app/src/server/model-runtime.ts)、[server/model-service.ts](../../../app/src/server/model-service.ts)、[server/provider-usage.ts](../../../app/src/server/provider-usage.ts)、[server/usage-accounts.ts](../../../app/src/server/usage-accounts.ts) |
| `resizeImage` | 1 | 0 | 1 | 1 | [server/agent-worker.ts](../../../app/src/server/agent-worker.ts) |
| `serializeConversation` | 1 | 0 | 1 | 2 | [server/compression-request.ts](../../../app/src/server/compression-request.ts) |

### @earendil-works/pi-mcp（3 符号）

| 导入名 | 绑定数 | type绑定 | value绑定 | 直接调用或构造引用 | 来源 |
| --- | ---: | ---: | ---: | ---: | --- |
| `McpClient` | 1 | 0 | 1 | 1 | [server/integrations/rea-diagnostic-worker.ts](../../../app/src/server/integrations/rea-diagnostic-worker.ts) |
| `StdioTransport` | 2 | 0 | 2 | 3 | [server/integrations/model-proxy-tools.ts](../../../app/src/server/integrations/model-proxy-tools.ts)、[server/integrations/rea-diagnostic-worker.ts](../../../app/src/server/integrations/rea-diagnostic-worker.ts) |
| `StreamableHttpTransport` | 1 | 0 | 1 | 1 | [server/integrations/model-proxy-tools.ts](../../../app/src/server/integrations/model-proxy-tools.ts) |

### @earendil-works/pi-tui（1 符号）

| 导入名 | 绑定数 | type绑定 | value绑定 | 直接调用或构造引用 | 来源 |
| --- | ---: | ---: | ---: | ---: | --- |
| `CombinedAutocompleteProvider` | 1 | 0 | 1 | 1 | [server/files.ts](../../../app/src/server/files.ts) |

## 3. 私有路径与非字面量补充

下列是版本敏感的静态发现，不表示已测试模块加载；与上面的字面量包锚点有包含关系，不能简单加总为总调用数。

| 来源 | 原生私有模块相对路径 |
| --- | --- |
| [server/axiom-prompt.ts](../../../app/src/server/axiom-prompt.ts#L12) | `./core/system-prompt.js` |
| [server/capability-resources.ts](../../../app/src/server/capability-resources.ts#L22) | `./extensions/mcp/config.js` |
| [server/pi-package-storage.ts](../../../app/src/server/pi-package-storage.ts#L97) | `./core/settings-manager.js` |
| [server/pi-package-storage.ts](../../../app/src/server/pi-package-storage.ts#L114) | `./core/settings-manager.js` |
| [server/pi-settings-storage.ts](../../../app/src/server/pi-settings-storage.ts#L18) | `./core/settings-manager.js` |
| [server/resources.ts](../../../app/src/server/resources.ts#L29) | `./core/mcp-servers.js` |
| [server/resources.ts](../../../app/src/server/resources.ts#L31) | `./core/auth-storage.js` |
| [server/resources.ts](../../../app/src/server/resources.ts#L32) | `./extensions/mcp/oauth.js` |

| 来源 | 借用的 Pi 安装树第三方依赖 |
| --- | --- |
| [server/pi-settings-storage.ts](../../../app/src/server/pi-settings-storage.ts#L12) | `proper-lockfile` |
| [server/skill-import.ts](../../../app/src/server/skill-import.ts#L6) | `yaml` |

| 来源 | 计算式 resolve |
| --- | --- |
| [server/execution-profile.ts](../../../app/src/server/execution-profile.ts#L37) | `import.meta.resolve('@earendil-works/${name}')` |

## 4. 可解析语法图的间接反向依赖

图闭包 **153 = 94 直接 + 59 间接**，含显式type-only和字面worker URL边；未穷尽本地import-type/require/别名/计算路径。以下仅列没有直接Pi引用的可达文件，不是应整体搬进adapter的文件清单。

- [server/agents/resource-identity.ts](../../../app/src/server/agents/resource-identity.ts)
- [server/agents/runs.ts](../../../app/src/server/agents/runs.ts)
- [server/agents/views.ts](../../../app/src/server/agents/views.ts)
- [server/capabilities.ts](../../../app/src/server/capabilities.ts)
- [server/document-files.ts](../../../app/src/server/document-files.ts)
- [server/execution-pool.ts](../../../app/src/server/execution-pool.ts)
- [server/integrations/builtin-operation.ts](../../../app/src/server/integrations/builtin-operation.ts)
- [server/integrations/component-environment.ts](../../../app/src/server/integrations/component-environment.ts)
- [server/integrations/managed-node.ts](../../../app/src/server/integrations/managed-node.ts)
- [server/integrations/model-proxy-env.ts](../../../app/src/server/integrations/model-proxy-env.ts)
- [server/integrations/model-proxy-guardian.ts](../../../app/src/server/integrations/model-proxy-guardian.ts)
- [server/integrations/model-proxy-import.ts](../../../app/src/server/integrations/model-proxy-import.ts)
- [server/integrations/model-proxy-install.ts](../../../app/src/server/integrations/model-proxy-install.ts)
- [server/integrations/model-proxy-process.ts](../../../app/src/server/integrations/model-proxy-process.ts)
- [server/integrations/model-proxy-removal.ts](../../../app/src/server/integrations/model-proxy-removal.ts)
- [server/integrations/model-proxy-xray-import.ts](../../../app/src/server/integrations/model-proxy-xray-import.ts)
- [server/integrations/model-proxy-xray-installer.ts](../../../app/src/server/integrations/model-proxy-xray-installer.ts)
- [server/integrations/model-proxy.ts](../../../app/src/server/integrations/model-proxy.ts)
- [server/integrations/native-process.ts](../../../app/src/server/integrations/native-process.ts)
- [server/integrations/node-launcher.ts](../../../app/src/server/integrations/node-launcher.ts)
- [server/integrations/opencli-removal.ts](../../../app/src/server/integrations/opencli-removal.ts)
- [server/integrations/opencli-runtime.ts](../../../app/src/server/integrations/opencli-runtime.ts)
- [server/integrations/opencli-shim.ts](../../../app/src/server/integrations/opencli-shim.ts)
- [server/integrations/rea-download-cleanup.ts](../../../app/src/server/integrations/rea-download-cleanup.ts)
- [server/integrations/rea-engine-download.ts](../../../app/src/server/integrations/rea-engine-download.ts)
- [server/integrations/rea-engine-ghidra.ts](../../../app/src/server/integrations/rea-engine-ghidra.ts)
- [server/integrations/rea-engine-install.ts](../../../app/src/server/integrations/rea-engine-install.ts)
- [server/integrations/rea-engine-process.ts](../../../app/src/server/integrations/rea-engine-process.ts)
- [server/integrations/rea-engines.ts](../../../app/src/server/integrations/rea-engines.ts)
- [server/integrations/rea-removal.ts](../../../app/src/server/integrations/rea-removal.ts)
- [server/integrations/rea-runtime.ts](../../../app/src/server/integrations/rea-runtime.ts)
- [server/integrations/rea.ts](../../../app/src/server/integrations/rea.ts)
- [server/integrations/rtk-install.ts](../../../app/src/server/integrations/rtk-install.ts)
- [server/integrations/rtk-process.ts](../../../app/src/server/integrations/rtk-process.ts)
- [server/integrations/rtk-versions.ts](../../../app/src/server/integrations/rtk-versions.ts)
- [server/integrations/rtk.ts](../../../app/src/server/integrations/rtk.ts)
- [server/integrations/tool-process.ts](../../../app/src/server/integrations/tool-process.ts)
- [server/memory-continuations.ts](../../../app/src/server/memory-continuations.ts)
- [server/memory-runner.ts](../../../app/src/server/memory-runner.ts)
- [server/model-usage-ledger.ts](../../../app/src/server/model-usage-ledger.ts)
- [server/model-usage-statistics.ts](../../../app/src/server/model-usage-statistics.ts)
- [server/pi-package-process.ts](../../../app/src/server/pi-package-process.ts)
- [server/pi-package-worker.ts](../../../app/src/server/pi-package-worker.ts)
- [server/preview-runtimes.ts](../../../app/src/server/preview-runtimes.ts)
- [server/providers/kiro-eventstream.ts](../../../app/src/server/providers/kiro-eventstream.ts)
- [server/providers/kiro-profile.ts](../../../app/src/server/providers/kiro-profile.ts)
- [server/providers/kiro-thinking-stream.ts](../../../app/src/server/providers/kiro-thinking-stream.ts)
- [server/providers/kiro-tool-input.ts](../../../app/src/server/providers/kiro-tool-input.ts)
- [server/providers/qoder-sse.ts](../../../app/src/server/providers/qoder-sse.ts)
- [server/service-recovery.ts](../../../app/src/server/service-recovery.ts)
- [server/session-drafts.ts](../../../app/src/server/session-drafts.ts)
- [server/skill-files.ts](../../../app/src/server/skill-files.ts)
- [server/tasks.ts](../../../app/src/server/tasks.ts)
- [server/tasks/commands.ts](../../../app/src/server/tasks/commands.ts)
- [server/tasks/scheduler.ts](../../../app/src/server/tasks/scheduler.ts)
- [server/usage-materialized-store.ts](../../../app/src/server/usage-materialized-store.ts)
- [server/usage-sidecar-engine.ts](../../../app/src/server/usage-sidecar-engine.ts)
- [server/usage-sidecar-worker.ts](../../../app/src/server/usage-sidecar-worker.ts)
- [server/usage-sidecar.ts](../../../app/src/server/usage-sidecar.ts)

完整边、模块锚点、引用位置及字节hash见同目录 pi-coupling-inventory.json；所有语义计数见 capability-summary.json。
