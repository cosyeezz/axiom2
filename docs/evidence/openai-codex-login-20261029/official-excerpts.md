# Official-source excerpts — 2026-10-29

Public documentation only; no authenticated API requests. Excerpts retain extracted-text line numbers. Whitespace/layout reflects HTML extraction, not a new API contract. Raw HTML and full text remain in the original research directory; hashes below identify the full extracted text. Codex URLs were reached via official developers.openai.com redirects. Interpretations and limits are in the main report.

## direct/token-sharing.txt

Source: https://developers.openai.com/siwc/token-sharing-open-source

Full extracted-text SHA256: `02b901b38ac5c5e6f4236e1d617a98670ec35de10f29f6ed5b03c59ea4871785`

```text
L765: Introduction
L766: ChatGPT plan usage is an optional capability within Sign in with ChatGPT. In addition to identity scopes, your open-source app can request permission to use the user’s ChatGPT plan for eligible Responses API requests. This does not grant access to their ChatGPT conversations or other account context.
L767: These docs explain ChatGPT plan usage for open-source and locally hosted apps. If you’re interested in offering it in a paid or remotely hosted app, complete the interest form.
L768: The OAuth flow for OSS clients registers a user-defined agent during Sign in with ChatGPT. Before the first sign-in, choose and persist the required ext_agent_host_id.
L769: A client vs. an agent host
L770: A client is the OAuth registration a user authorizes for your tool during Sign in with ChatGPT. In this dynamic-registration flow, each issued client_id is bound to the authenticated user and the workspace selected during registration. Its issued client_id identifies that registration, its security boundaries, and its ChatGPT plan usage settings.
```

## direct/quickstart.txt

Source: https://developers.openai.com/siwc/quickstart

Full extracted-text SHA256: `3d140a1afe10d6b6e01461b7d681ca61892313de0e536d3d872e8b9f9392fd97`

```text
L764: Choose a Sign in with ChatGPT integration for your website, plugin, or open-source client.
L765: Sign in with ChatGPT lets users sign in to your app with their ChatGPT account
L766: and, when eligible, use their ChatGPT plan for AI requests. It supports sign-in
L767: and optional ChatGPT plan usage:
L768: For users: Sign in with an existing ChatGPT account. Eligible ChatGPT Plus
L769: and Pro users can use their ChatGPT plan for AI requests in participating apps
L770: and manage app usage and access in ChatGPT settings.
L771: For partner apps: Offer a familiar sign-in option on your website or in your
L772: ChatGPT plugin. Apps approved for ChatGPT plan usage can also complete eligible
L773: AI requests with usage included in the user’s ChatGPT plan or available credits.
L774: For open-source developers: Let users run AI workloads in your tools with
L775: their ChatGPT plan, without requiring them to provide an API key. The
```

## direct/models-and-inference.txt

Source: https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference

Full extracted-text SHA256: `17957ef8d193fa8ed9a01fdef29469628a6f2408b6a69e9fd720158c5969eff6`

```text
L765: Use the access token saved during Sign in to populate a model picker and complete the first inference request.
L766: 1. List available models
L767: Before showing a model picker, request the selected ChatGPT account’s model catalog with the same access token you will use for inference:
L768: curl --fail-with-body --silent --show-error \
L769: https://api.openai.com/v1/models \
L770: -H "Authorization: Bearer $ACCESS_TOKEN" \
L771: | jq '[.models[] | select(.visibility == "list") | {slug, display_name}]'
L772: The model-list response contains a models array. This example keeps models intended for display (visibility: "list") and preserves the server’s ordering. Show display_name in your UI and pass the selected slug as model in the next step. Refresh these choices when the user switches ChatGPT accounts. If you use Codex app-server, its model/list RPC may use a bundled or cached catalog. Use the request above when your UI needs current account-specific model choices.
L773: 2. Call the Responses API
L774: To perform inference on behalf of the user, send the OAuth access token as Authorization: Bearer <ACCESS_TOKEN> to POST https://api.openai.com/v1/responses.
L775: Supported endpoint: Use the public Responses API endpoint above for this ChatGPT plan usage flow; do not point it at ChatGPT’s backend-api endpoints. Use a model available to the signed-in account.
L776: Set store to false and stream to true on each HTTP inference request in this flow. Consume the response as a stream of events.
L777: Read the saved access_token for the selected ChatGPT account into the process environment as ACCESS_TOKEN before running these examples.
L778: curl example
```

## direct/preview-limitations.txt

Source: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations

Full extracted-text SHA256: `76f2b8eff14aba0963bc4c467c6dca1d869c49a6e51588f296248c71a65e0887`

```text
L765: Preview behavior and limitations
L766: These limits apply to ChatGPT plan usage through Sign in with ChatGPT and https://api.openai.com/v1, both directly and through Codex app-server.
L767: Responses API requirements
L768: HTTP requests: Set store: false and stream: true. Send input as an array containing the context needed for each request. Use instructions or developer messages; explicit {type: "message", role: "system"} items are rejected.
L769: Unsupported fields: Omit background, conversation, max_output_tokens, max_tool_calls, metadata, moderation, multi_agent, prompt, prompt_cache_retention, safety_identifier, temperature, top_logprobs, top_p, truncation, and user.
L770: Conversation state: Omit previous_response_id over HTTP and send the required history in input. WebSocket continuation can reference only responses from the same authenticated connection; it does not provide persistent conversation storage.
L771: Supported tools: Group function/custom tools in namespaces or supply them through additional_tools input items. Web search remains subject to model and account/workspace policy.
L772: Unsupported tools: Image generation, file search, Code Interpreter, native computer use, hosted MCP/connectors, and Responses tool_search. Client-side execution does not make tool_search supported. programmatic_tool_calling is not accepted in top-level tools on this route.
L773: Inputs: Text, images, and files are supported when the selected model accepts them. Audio/video input, the Files upload API, and the transcription API are not supported by this flow.
L774: Codex app-server behavior
L775: Transport: The Codex app-server configuration uses stdio between your app and app-server, then HTTP/SSE to Responses. App-server sets store: false and stream: true; supports_websockets=false selects HTTP for this configuration.
L776: Local tools and agents: Codex can run shell and MCP tools and coordinate child agents through supported function/custom tool calls. These are separate from hosted Responses tools. Configurations that emit Responses tool_search will fail.
L777: Inputs and history: Use app-server’s RPC inputs; it does not accept arbitrary Responses parameters. Local thread history and thread/resume still work with store: false.
L778: Token renewal: Your app must refresh the OAuth token. With the env_key setup, restart app-server with the renewed ACCESS_TOKEN, then resume the saved thread.
L779: Previous
```

## direct/profiles-and-sessions.txt

Source: https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions

Full extracted-text SHA256: `73d6fb960a82e349b8bf9847b850bc3b8802aa1482cb5c3a52c95b4592aa7f76`

```text
L790: Set limits for each app’s use of your ChatGPT plan and credits.
L791: VercelManage limits
L792: CanvaManage limits
L793: FigmaManage limits
L794: Changes apply only to this example. Your ChatGPT settings stay unchanged.
L795: For ChatGPT Plus users, the five-hour usage limit is shared across all apps where they use their ChatGPT plan, including private and open-source clients. Usage in one app contributes to the same five-hour usage total, and no app receives a separate allowance. The five-hour usage limit does not apply for Pro users.
L796: Previous
L797: Registration and sign-in
L798: Next
L799: Models and inference
L800: Ask AI
L801: Docs agent
L802: Loading docs agent...
```

## direct/codex-app-server.txt

Source: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server

Full extracted-text SHA256: `3209f227b961b036751f67bceb5a7a60e956f60d97d331faec9bd59e2bc6decd`

```text
L765: Using Codex app-server
L766: If your app uses Codex app-server, configure it to send inference requests to the Responses API using an OAuth access token authorized for the user’s ChatGPT plan. You can use model/list to populate a model selector, but with the provider configuration below it can return a bundled client catalog. Treat it as a catalog, not an entitlement check; a successfully completed inference turn verifies access to the selected model for that request.
L767: Pass the OAuth access token to the child process. After exchanging the authorization code, read the token response’s access_token field. Set ACCESS_TOKEN in the app-server child process’s environment to that value.
L768: Start app-server with a Responses provider.
L769: codex app-server --listen stdio:// \
L770: -c 'model_provider="openai_chatgpt_plan"' \
L771: -c 'model_providers.openai_chatgpt_plan.name="ChatGPT plan"' \
L772: -c 'model_providers.openai_chatgpt_plan.base_url="https://api.openai.com/v1"' \
L773: -c 'model_providers.openai_chatgpt_plan.env_key="ACCESS_TOKEN"' \
L774: -c 'model_providers.openai_chatgpt_plan.wire_api="responses"' \
L775: -c 'model_providers.openai_chatgpt_plan.requires_openai_auth=false' \
L776: -c 'model_providers.openai_chatgpt_plan.supports_websockets=false'
L777: Codex sends the user’s OAuth access token as Authorization: Bearer <access_token> on requests to /v1/responses. No separate Codex sign-in is required.
L778: Drive the conversation over stdin/stdout. Send newline-delimited JSON messages. Start with initialize and include these fields in params.clientInfo:
```

## codex/auth.txt

Source: https://learn.chatgpt.com/docs/auth

Full extracted-text SHA256: `191c48fbff7ebc292ed1bffebcd1bb3235aff5eb96d9438068410aa5727b9c30`

```text
L811: OpenAI authentication
L812: Codex supports two ways for a person to sign in when using OpenAI models:
L813: Sign in with ChatGPT for subscription access
L814: Sign in with an API key for usage-based access
L815: The ChatGPT desktop app, Codex CLI, and IDE extension support both sign-in
L816: methods for local work. Codex cloud requires signing in with ChatGPT.
L817: Your sign-in method also determines which admin controls and data-handling policies apply.
L818: When you sign in with ChatGPT, Codex usage follows your ChatGPT workspace
L819: permissions, role-based access control (RBAC), and ChatGPT Enterprise
L820: retention and residency settings.
L821: With an API key, usage follows your API organization’s retention and
L822: data-sharing settings instead.
L823: For managed workspaces, authentication is only one layer of access. Workspace
L824: membership and provisioning determine who can sign in, while seats and
L825: workspace roles determine which product surfaces and features they can use.
```

## codex/models.txt

Source: https://learn.chatgpt.com/docs/models

Full extracted-text SHA256: `a1880f8cb89cb37da7f4c2cb0bf02c8c61ae37e867a80c7b3225b1869a4df92f`

```text
L844: The six Power presets shown are Luna High, GPT-6 Sol Light (selected
L845: in this example), GPT-6 Sol Medium, Astra Light, Astra Medium, and Astra Extra
L846: High. Some paid plans omit Astra Extra High. Advanced controls are illustrative;
L847: available options and defaults vary by plan, client, workspace settings, and rollout.
L848: Recommended models
L849: Start with the kind of work you want to do. Astra suits the most demanding
L850: workflows. GPT-6.1 Sol offers near-Astra performance at a lower cost than Astra.
L851: GPT-6.1 Terra is a fast, efficient choice for writing, visual understanding, and
L852: computer use. Luna suits focused, repeatable tasks.
L853: These recommendations apply to ChatGPT Work and Codex. For Chat, see models in ChatGPT in the Help Center.
L854: Astra
L855: Our most capable model for complex work across code, apps, and research, combining advanced reasoning, computer use, and stronger judgment.
L856: codex -m gpt-6-astraCopy command
L857: Capability
L858: Speed
L859: ChatGPT desktop app
L860: ChatGPT web
L861: Codex CLI
L862: Codex IDE extension
L863: ChatGPT Credits
L864: API Access
L865: 6.1 Sol
L866: Near-Astra performance for complex work at a lower cost than Astra. Consider it for repeated, long-running work across code, apps, and documents.
L867: codex -m gpt-6.1-solCopy command
L868: Capability
L869: Speed
L870: Work and Codex in the desktop app
L871: ChatGPT Work on the web
L872: Codex CLI
L873: Codex IDE extension
L874: ChatGPT Credits
L875: API Access
L876: 6.1 Terra
L877: A fast, efficient model for clear writing, visual understanding, and computer use. Try it for drafting proposals, interpreting charts, or working with information in an app.
L878: codex -m gpt-6.1-terraCopy command
L879: Capability
L880: Speed
L881: Work and Codex in the desktop app
L882: ChatGPT Work on the web
L883: Codex CLI
L884: ChatGPT Credits
L885: API Access
L886: 6 Luna
L887: Our most efficient model for focused, high-volume tasks, including summarization, extraction, and focused coding.
L888: codex -m gpt-6-lunaCopy command
L889: Capability
L890: Speed
L891: Work and Codex in the desktop app
L892: ChatGPT Work on the web
L893: Codex CLI
L894: Codex IDE extension
L895: ChatGPT Credits
L896: API Access
L897: GPT-6.1 Sol uses a default context window of 500,000 tokens in Codex and
L898: ChatGPT Work. See pricing for subscription usage and credit rates.
L899: For model availability, pricing, and usage limits, see ChatGPT Work and Codex in the Help Center.
L900: Choosing a model
L901: Start with a task you know well and compare the result with what you need.
L968: If your model supports Ultra but it doesn’t appear in the desktop app’s model
L969: slider, go to Settings > Configuration, then turn on
L970: Ultra in model picker slider.
L971: GPT-5.5 retirement
L972: Effective October 14, 2026, at noon PDT (19:00 UTC), GPT-5.5 retires from
L973: Codex for users signed in with ChatGPT. The OpenAI API and Codex sessions
L974: authenticated with an API key aren’t affected.
L975: For Codex with ChatGPT sign-in, choose an available replacement:
L976: On Plus, Pro, Business, Enterprise, and Edu plans, choose GPT-6.1 Sol
L977: (gpt-6.1-sol) when available.
L978: On Free and Go plans, choose GPT-6 Luna (gpt-6-luna) in the desktop app
L979: when available.
L980: Replace gpt-5.5 in workspace defaults, saved model settings, managed
L981: configurations, custom agents, scheduled tasks, and scripts that select a model.
L982: See workspace model availability
L983: for administrator guidance.
L984: Other models
L985: With API-key authentication, model availability follows your API organization
L986: and project. GPT-5.5 remains available through the OpenAI API and in Codex
L987: sessions authenticated with an API key. See the API model catalog.
L988: For a custom model provider or gateway, use a compatible Responses API endpoint.
L989: See Custom model providers
L990: for configuration and Gateway compatibility
L991: for streaming, tool, and conversation requirements. Current Codex releases don’t
L992: support wire_api = "chat" or a Chat Completions-only endpoint.
L993: Deprecated Codex models
L994: GPT-5.3-Codex-Spark retired on September 14, 2026, and is no longer available
L995: in the ChatGPT desktop app, Codex CLI, or IDE extension. Update saved
L996: configurations, custom agents, and scripts that select gpt-5.3-codex-spark
L997: to use an available model. See the
L998: Spark retirement notice.
L999: GPT-5.5 retires from Codex with ChatGPT sign-in on October 14, 2026, at noon
L1000: PDT (19:00 UTC). Replace gpt-5.5 with a model available to your account and
L1001: client. API-key sessions aren’t affected. See
L1002: GPT-5.5 retirement for plan-specific
L1003: replacements and the migration checklist.
L1004: The gpt-5.4 and gpt-5.4-mini models retired from Codex with ChatGPT sign-in
L1005: on August 31, 2026. Replace gpt-5.4 with gpt-6-sol and
L1006: gpt-5.4-mini with gpt-6-luna when available to your plan and client.
L1007: In Enterprise and Edu, an administrator must enable Luna first. Update workspace
L1008: defaults, saved model settings, managed configurations, custom agents, and
L1009: scheduled tasks with an available replacement.
L1010: The gpt-5.2 and gpt-5.3-codex models are already deprecated in Codex when
L1011: you sign in with ChatGPT. Update scripts, configuration files, and
L1012: codex exec --model commands that still reference those models.
L1013: The OpenAI API and Codex authenticated with your own API key aren’t affected
L1014: by the GPT-5.4 retirement. For current API model availability, see the
L1015: API models page.
L1016: Configure your default local model
L1017: The ChatGPT desktop app, Codex CLI, and IDE extension use the same config.toml
L1018: configuration file. To specify a model, add a
```

## codex/pricing.txt

Source: https://learn.chatgpt.com/docs/pricing

Full extracted-text SHA256: `a2c0ded714275f8865b50d26a3b211c93a1354cfbe3a1c64f65081cf490891c8`

```text
L870: What are the usage limits for my plan?
L871: The number of messages you can send depends on the model used, size and
L872: complexity of your tasks, and whether you run them locally or in the cloud.
L873: Small scripts or routine functions may consume only a fraction of your
L874: allowance, while larger projects, long-running tasks, or extended sessions that
L875: require the agent to hold more context will use significantly more per message.
L876: Tasks that look similar can consume different amounts of your allowance. Model
L877: choice, context, reasoning, tool use, retrieval, and caching all affect usage,
L878: so prompt length alone isn’t a reliable estimate.
L879: For model recommendations, see Models.
L880: The estimates below show local messages per five-hour period for Plus and
L881: Standard Business. Pro plans currently have no five-hour limit. Cloud tasks
L882: may use more of your allowance than local messages. Usage depends on the model
L883: and task. These estimates are not fixed message limits; check your
L884: usage dashboard for current limits
L885: and reset times.
L886: Model
L887: Plus
L888: Standard Business
L889: GPT-6 Astra5-455-45
L890: GPT-6.1 Sol15-16015-160
L891: GPT-6.1 Terra35-28535-285
L892: GPT-6 Sol15-15015-150
L893: GPT-6 Luna350-3,000350-3,000
L894: Local messages and cloud chats share your plan’s usage allowance. Weekly
L895: limits may also apply.
L896: Enterprise/Edu users with flexible pricing have no fixed rate limits.
L897: Usage scales with credits.
L898: Enterprise and Edu plans without flexible pricing have the same per-seat
L899: usage limits as Plus for most features.
L900: Usage limits are shared with other agentic features once pricing for those
L901: features is effective. This currently includes ChatGPT for
L902: Excel on Plus and Pro.
L903: GPT-6.1 Sol usage drawn from your subscription has no long-context surcharge
L904: in Codex or ChatGPT Work.
L905: Fast and Ultrafast modes use included subscription limits and paid credits
L906: at different rates, relative to Standard mode for the same model:
L907: Speed mode
L908: Included subscription usage
L909: Purchased credits and Enterprise pay-as-you-go usage
L910: Fast
L911: 2.5x
L912: 2x
L913: GPT-6 Astra Ultrafast
L914: 8x
L915: 6x
L916: GPT-6.1 Sol Ultrafast
L917: 8x
L918: 6x
L919: Check your usage dashboard for
```

## codex/codex-siwc.txt

Source: https://learn.chatgpt.com/docs/sign-in-with-chatgpt

Full extracted-text SHA256: `00822ea083f00ce1a41cea9891ec8ff4fdf270c6e14214a28e0f42ee9dc026d0`

```text
L835: Use your ChatGPT plan in this app.Continue with ChatGPT
L836: Use your ChatGPT plan
L837: Some apps also let you use your ChatGPT plan for eligible AI requests. It uses your
L838: Codex / ChatGPT work usage included in your plan.
L839: When an app asks to use your plan, review the Use your ChatGPT plan permission
L840: and choose whether to allow it. Select Continue to proceed.
L841: Connect ChatGPT and your app
L842: Use your ChatGPT plan
L843: Allow this app to consume usage from your ChatGPT Plan's limits.
L844: ContinueCancel
L845: You can manage this connection anytime in ChatGPT settings.
L846: App usage counts toward your existing plan limits. Connecting an app does not add
L847: a new allowance, and the app may have its own fees.
L848: Using your plan does not give the app access to your ChatGPT conversations or
L849: memories. Review any other permissions the app requests separately.
L850: Model speed
L851: Instant
L852: Medium
L853: High
L854: FastUses your plan or credits faster
L855: Using ChatGPT planManage usage
L856: Start chatting or describe a task...
L857: Medium
L858: See and manage usage
L859: In ChatGPT, open Settings > Usage to see how connected apps use your plan.
L860: To set a limit for an app:
L861: Under App limits, open the percentage menu next to the app.
L862: Set its weekly limit as a percentage of your overall weekly plan usage.
L863: Select Save.
L864: An app’s limit is a cap, not a separate allowance or a reserved portion of your
L865: plan.
L866: App limits
L867: Set limits for each app's use of your ChatGPT plan and credits.Save
L868: Pate Perfect
L869: 100%
L870: 10%
L871: 20%
L872: 30%
L873: 40%
L874: 50%
L875: 60%
L876: 70%
L877: 80%
L878: 90%
L879: 100%
L880: Allow other apps to use credits after reaching your usage limit
L881: Applies to apps you've allowed to use your ChatGPT plan.
L882: To completely disconnect access for an external partner tool, go to ChatGPT
L883: Settings > Security and login > Sign in with ChatGPT, select the app, and select
L884: Disconnect.
```

## codex/api-sol.txt

Source: https://developers.openai.com/api/docs/models/gpt-6.1-sol

Full extracted-text SHA256: `497cd30715c354a6a3198cbd9a945bc61c1ceb1da7f761cc95f346b198b4619a`

```text
L790: Output
L791: Text
L792: Use GPT-6.1 Sol for complex coding, computer use, and professional work.
L793: reasoning.effort supports low, medium (default), high, xhigh, and
L794: max.
L795: Tool calling requires the Responses API.
L796: See the GPT-6 guide
L797: for prompting and migration guidance.
L798: 1,050,000 context window
L799: 128,000 max output tokens
L800: Apr 30, 2026 knowledge cutoff
L801: Reasoning token support
L802: Pricing
L803: Pricing is based on the number of tokens used, or other metrics based on the model type. For tool-specific models, like search and computer use, there’s a fee per tool call. See details in the pricing page.
L804: Text tokens
L805: Per 1M tokens
L806: Input
L807: $2.00
L808: Cached input
L809: $0.10
L810: Cache writes
L811: $2.50
L812: Output
L813: $10.00
L814: Cached input tokens are priced at 5% of the uncached input token rate.
L815: Cache writes are billed at 1.25x the uncached input token rate.
L816: API prompts with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output for the full request.
L817: Fast mode prices are 2x Standard. Batch and Flex prices are 50% lower than Standard.
L818: Ultrafast mode prices are 6x Standard.
L819: Regional processing adds a 10% premium where available.
L820: GPT-6.1 Sol uses a default context window of 500K tokens in Codex and ChatGPT Work. Usage drawn from your subscription has no long-context surcharge. See Codex pricing.
L821: Modalities
L822: Text
L823: Input and output
```
