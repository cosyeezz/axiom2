# catalog-metadata-02
同 CATALOG-METADATA-01 合同，仅目标模型改为精确 claude-opus-5.5；只读 profile 1 次 + catalog 1 次，0 次模型推理；只保存白名单投影。

# Axiom 原生目录 schema 只读核验

新问题：官方list-models正常输出不暴露toggle/effort元数据；KAS静态代码按additionalModelRequestFieldsSchema构造实际thinking/default/effort，而Axiom目录转换丢弃该schema。核精确Sonnet5.5真实schema，不推理、不借CLI凭据、不更改账号/模型默认/代理。

新catalog-metadata-01独占wx claim；失败/超时亦耗尽。正常readModelCredential读取Axiom当前企业凭据，要求us-east-1/direct/无显式baseUrl且未过期，使用已构建原生fetchKiroCatalog与原fetch。最多1美国ListAvailableProfiles、1management ListAvailableModels，0模型/刷新/重试；不发布或保存新目录缓存。若分页需要第2次请求则发送前拒绝。

15秒native总限、20秒观察总限、4秒cleanup、25秒硬停；每响应2MiB、请求64KiB。沿原reader一次有界读取，JSON只RAM，提取精确Sonnet55 schema的已知字段、布尔与enum/default/required白名单；原字节交回原native parser，不clone/tee/改正文。未知值为other、未知键不输出；完整目录、profile/token/配置不持久化或hash。错误仅固定状态/阶段，不保存未知原文。

正常模型/settings/账号索引前后仅RAM相等比较；并核pending/body归零、dispatcher关闭。运行前pure投影拒泄漏与离线native profile/catalog fixture、分页超预算、超限/取消/late/不完整JSON门禁；仅离线通过且独立审核后live。完整白名单结果json写新名，旧case不复用。目录schema证据不证明400根因，也不证明模型推理可用。
