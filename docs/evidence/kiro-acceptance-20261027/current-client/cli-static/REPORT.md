# Current CLI native wire: partial static recovery

## Conclusion / blocker
Current 2.33.1 binary demonstrably implements the old AWS JSON target and extended GenerateAssistantResponse body. A separate callable resolver maps regions to new Kiro runtime endpoints. **The engine→resolver→that serializer connection was not established; do not claim current default CLI sends the old target to runtime.** This subagent received only read/grep/find/ls/bash tools, no mcp__rea/codemode tool. Existing native target was not switched, opened again, closed, or otherwise touched. No new REA Evidence IDs exist. Shell observations below are NOT REA Evidence. Existing parent cli-open.json records the target identity.

Binary: /tmp/kiro-cli-static.Bz5akg/binaries/kiro-cli-chat-arm64
SHA256 independently recomputed: 1061c72fc190e0772ab74202c9ce1acbb83e11e8ab7e6a68a3aa3cf2e41a19d4.

## S1: actual target and body serializer
LC_FUNCTION_STARTS bounds 0x1007d2a98..0x1007d3dd4. generate-serializer.asm is canonical disassembly; *.annotated.asm is a convenience (annotation register tracking is heuristic, may contain stale comments).
- 0x1007d2dd4 materializes application/x-amz-json-1.0 at 0x104777418; w6=26; helper call 0x10080a540.
- 0x1007d2edc materializes x-amz-target; length 12; 0x1007d2f1c materializes full AmazonCodeWhispererStreamingService.GenerateAssistantResponse at 0x1047781ea; w6=61, then same helper at 0x1007d2f38. This is not a nearby InvokeMCP string attribution.
- 0x1007d3058 writes '{'. Explicit JSON key emission calls at 0x1007d3084 conversationState, 0x1007d35a0 profileArn, 0x1007d35c8 agentMode, 0x1007d35f0 additionalModelRequestFields, 0x1007d3620 systemPrompt. Optional branches exist; not all fields always emitted.
- conversationState key emissions: conversationId 0x1007d30d8, workspaceId 0x1007d3100, history 0x1007d312c, currentMessage 0x1007d3220, chatTriggerType 0x1007d32b8, customizationArn 0x1007d3340, agentContinuationId 0x1007d3368, agentTaskType 0x1007d3398, rootConversationId 0x1007d3548.
- currentMessage delegates at 0x1007d3270 to 0x1007e3670..0x1007e5890. That function emits userInputMessage (0x1007e36c0), content (0x1007e3708), userInputMessageContext (0x1007e3738), origin (0x1007e41c8). Its origin enum branches include CLI at 0x1007e4850 and KIRO_CLI at 0x1007e4910 (length 8). **Actual caller-selected enum value not traced**; do not assert CLI vs KIRO_CLI by enum presence alone.
- Literal callerContext is absent from whole binary; no conclusion that all caller context is absent. userInputMessageContext is positively emitted.
- Method/path, final auth headers, token-type/profile transport headers, Accept/event-stream headers not recovered. No HTTP path inference from desktop JS.

## S2: actual new runtime resolver
runtime-resolver.asm bounds 0x101b81c68..0x101b8205c. Region strings are compared, then a 48-byte tuple is copied from a table. runtime-region-table.json decodes tuples at 0x10b759628..0x10b759778: commercial us-east-1 -> https://runtime.us-east-1.kiro.dev; eu-central-1 -> https://runtime.eu-central-1.kiro.dev; Gov and isolated partitions also listed. URL full start is **0x108ae85bb**, while supplied 0x108ae85d5 lies within it. Runtime pointer table at 0x10b759778 points to full URL at +8.
Direct BL callers: 0x100e2acac and 0x101bb3324 (direct-callers.json). runtime-caller2 bounded excerpt has kas.rs adjacent source strings, but not sufficient engine attribution. No direct BL to serializer found (likely trait/vtable dispatch, not proof of unreachability).
Separate legacy q.* endpoint/region table is constructed by 0x101b82cd0..0x101b82e60 (endpoint-resolver-candidate.asm). Coexistence is established; selection is unknown.

## REA follow-up for main agent
Use the already-open target only. Bounded analyze/decompile at 0x1007d2a98 (actual serializer), 0x1007e3670 (message + origin), 0x101b81c68 (runtime resolver), plus callers 0x100e2acac and 0x101bb3324. The supplied serializer-name string points merely to debug-name function 0x1007a53e8..0x1007a540c. Follow vtable/function pointer references for serializer rather than assuming the name function is serialization. Trace engine selection and identity interceptors separately. Preserve REA Evidence IDs and current hash; no IDs generated here.

## Commands / execution record
Working directory /Volumes/D_Work/axiom2. All analysis writes confined to this cli-rea directory. bounded-xrefs.py, endpoint-pages.py, annotate.py are temporary static analysis scripts. python3 bounded-xrefs.py (exit 0) hashes binary, parses Mach-O sections and LC_FUNCTION_STARTS, scans ADRP/ADD xrefs (incomplete heuristic). LLVM tool /Library/Developer/CommandLineTools/usr/bin/llvm-objdump -d --start-address=<start> --stop-address=<end> <binary> (all exit 0) generated each .asm at bounded ranges, not whole binary decompilation. Canonical key ranges listed above; raw .asm artifacts preserve exact command addresses. Python capstone import probe exit 1 (module absent; not installed). No model execution/tests, login, refresh/get-token, DB reads/writes, configuration changes, credentials access, native target execution, REA startup, or cleanup calls performed.
