Read-only evidence, 2026-10-25. No third-party execution/API/credentials/tests.
Roots under C:/Users/dane/AppData/Local/Temp/:
O=axiom-kiro-catalog-research/amazon-q-developer-cli (HEAD 15cc8f3cd18c4272925ce1c7053268eedff1ea0a)
R=axiom-kiro-rs-research-551521254d8c430680481850c604da97
S=O/crates/amzn-codewhisperer-streaming-client/src
C=O/crates/chat-cli/src
H=R/hank9999/src/kiro; Z=R/ZyphrZero/src/kiro

H/parser/frame.rs:75-152: BE u32 total/header/preludeCRC; minimum16; payload [12+header,total-4); CRC prelude[0,8), message[0,total-4). 16MiB limit is reference policy.
H/parser/crc.rs:3-18: CRC32 ISO-HDLC, reflected polynomial EDB88320.
H/parser/header.rs:13-23,143-178,194-251: u8 name length/name/u8 type; type7=u16BE length+UTF8. Types0..9 supported. H/model/events/base.rs:94-151: message-type event/error/exception; event-type/error-code/exception-type.
S/event_stream_serde.rs:124-405: event dispatch, unknown event retained; exception is error, invalid message-type fails.
S/types/_tool_use_event.rs:8-16: toolUseId/name strings, optional input string and stop bool; concatenate until stop=true.
C/cli/chat/parser.rs:411-460: content appended; EOF ends response. :468-574 tool JSON assembled, object validated, empty args {}; malformed EOF errors. :176-179,368-378 cancellation.
S/protocol_serde/shape_token_usage.rs:23-56: uncachedInputTokens/outputTokens/totalTokens/cacheReadInputTokens/cacheWriteInputTokens. S/types/_metadata_event.rs:8 token_usage; _metering_event.rs:8-10 usage/unit.
C/api_client/mod.rs:584-593 adaptive max3, stalled grace300s. retry_classifier.rs:63-76 monthly quota forbids retry; 500 overload throttles.
H/model/events/context_usage.rs:16-20 percentage. Z/model/events/metadata.rs:70-103 stopReason CONTENT_FILTERED, stopDetails.refusal; third-party only. Never present percentage estimates as exact tokens.