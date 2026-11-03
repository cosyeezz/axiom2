# 当前目录失败确认

唯一 baseline case：当前 Axiom 默认 Kiro identity-center 账号，未过期、无 profile、direct、无 baseUrl override。只执行当前 fetchKiroCatalog 一次，最多1目录物理请求，0认证刷新/0profile/0模型请求。15秒signal、外部25秒监督；失败立即停止，不重用claim。不得读取CLI凭据。仅保存HTTP状态、固定错误分类和profile-required谓词；响应原文/凭据只留RAM。配置不写。观察器先用合成响应自测，wrapper调用原global fetch、不换底层传输。清理关闭Undici dispatcher；claim wx。