# 企业目录服务验收 catalog-01

用户授权重启后拉企业目录、添加 Opus5.5/Sonnet5.5，随后测 Sonnet。当前 case 只读实时目录，不添加/推理。

对象：本机重启后 Axiom 4317 /ws，正常 configuration.get → configuration.catalog kiro，选中账号须 identity-center；凭据只由正常 readModelCredential 内存核模式，绝不复制 CLI 或输出 token/profile。

独占 catalog-01.claim（wx），所有结果耗尽，不重试。一次目录 RPC，外层45秒；服务目录期限15秒，原生上限20目录页、1000模型、每响应2MiB，profile最多2区域×20页，正常 OAuth刷新最多1次。总辅助请求理论上限61，不发任何模型请求；实际物理数本case无观测，不宣称计数。现有原生循环上限是发送前限制，不注入服务 transport。连接关闭触发服务取消，外层50秒硬停。

先运行 --preflight，只调用 configuration.get、核路由账号模式与配置，不取auth、不目录联网；通过后 --live。不换账号/代理/默认模型，不配置 save。目录缓存更新和正常 OAuth刷新写原存储允许。前后models.json RAM相等；不存配置摘要或敏感原文。

证据仅 source、公开模型ID/名称/能力、请求数（RPC）、布尔谓词和固定错误分类；配置和未知错误不输出。成功要求 source native/refreshed（非local）、目录非空，配置不变。名字查不到为待用户确认，不补造模型。WebSocket关闭后退出。该case证明真实后台配置目录路径，不代表浏览器UI或CLI一致性。
