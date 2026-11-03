# 本轮协议与验收范围

|层|观察与实现|边界|
|---|---|---|
|认证|当前 Axiom identity-center 正常独立认证，access有效；不复制CLI|未测新登录|
|失败|原目录1次HTTP403，profile-required谓词false|不把403归因为profile缺失|
|目录host/target|历史官方CLI2.36实测 management.us-east-1.kiro.dev / KiroControlPlaneBearerService.ListAvailableModels；KAS0.66.70同构造|当前本机CLI2.37未抓包|
|请求|KAS0.66.70实际默认AwsJson1_0Protocol→JSON RPC serializer确认POST /、空query、完整JSON body；当前body-only|完整serializer新窗口已保存，仍不称当前CLI2.37 wire parity|
|默认项|KAS optional defaultModel?.modelId；当前不再要求每页必有defaultModel|有值仍严格校验，不把default当额外model|
|profile|首次最小迁移400；安全诊断profile/arn/invalid谓词为true。现企业缺profile时正常账号发现，显式profile不重新发现，不修改原凭据|最终当前账号发现+目录均200；不是复制CLI本地profile，不推广到所有认证模式|
|区域|profile区域优先，否则us-east-1；management欧洲模板有源码依据|本轮仅美区实发|
|分页/生命周期|20页/1000项/2MiB/15s，拒绝重复分页与部分发布，取消迟到body清理不变|无跨区域/旧接口fallback|
|推理|固定deepseek-3.2/off，一次SDK原生文本实发200、完整stop、精确标记通过|不覆盖所有模型，未重启服务/UI验收|

来源：[官方请求](../kiro-macos-native-02/mitm-manual-official-chat-01/SUMMARY.md)，[KAS命令与AWS协议](../kiro-macos-native-02/v3-kas-review-01/transport/window-05.txt)，[区域](../kiro-macos-native-02/v3-kas-review-01/transport/window-06.txt)，[目录业务](../kiro-macos-native-02/v3-kas-review-01/transport/window-07.txt)。更正：早先仅核旧临时路径不存在；后找到同SHA完整bundle新路径并保存[完整serializer及认证窗口](static-current/REPORT.md)。条件TokenType头是已知未对齐点，不影响本轮功能验收结论的限定；未声称全链路对齐。
