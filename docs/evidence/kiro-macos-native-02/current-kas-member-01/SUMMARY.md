# 当前2.36已定位KAS成员：静态核验通过

当前chat明确frame内的三个public成员已完整提取，并与仓库已保留原件**逐byte相同**。这解决这些成员的2.36产物内容绑定；不证明官方运行时实际选择它们、NODE_OPTIONS继承或请求一致性。正式实发配对仍0。

## 执行与身份

- 唯一命令见[manifest](MANIFEST.json)；[实际工具返回](TOOL-RESULT.json)exit0/.7s，[结果](RESULT.json)内部.549559625s。driver9328B/SHA `73f5e07091349b69e8f1ff714fdfd68a3977202c6968a07a0c86e91fcee94c0a` 前后相同。
- sameFD nofollow读取当前chat436339984B，全SHA `609480f7c590ea84a53556fdf81e37057594fe8d7ddbec48c0728b3cd73e83a9` 与metadata03相同，前后dev/ino/size/mode/uid/mtime/ctime相同。不是原子loaded-image证明；本次没有重复验签。
- 明确frame fileoffset302659302、len21999416、exclusive end324658718。frame grammar长度匹配，libzstd完整解码/EOF/无压缩trailing通过；checksum按frame标志由decoder处理，存在位未单独记录，不能另称实测checksum flag存在。compressedSHA `c6006913eab754770c352634d12d8b3afe293ce60934c296ab0cce59c264d966`。
- decoded197488640B/SHA `ded0619f3ebf4128d5798c303d254a1e74dde15694ef2ee9e5f71791152b1352`，tar标准解析到终止处847成员，三selected共15030951B。未声称解码尾部每字节都是tar成员；frame全字节已消费校验。
- target application read458339400B，driver/source/loader/OS不包含；CPU15/internal20/alarm22/tool30为配置上限，whole-author墙钟未知。Python PID未保存；无子Node/official进程，未启动任何提取成员。

## 三成员的完整内容保全

| 成员（相对node_modules/@kiro/agent） | bytes | SHA256 |
|---|---:|---|
| dist/server/acp-server.js | 15025207 | bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1 |
| dist/server/acp-server.externals.json | 465 | 99bf8b686ced7f999ffc2733565fdb92d895705272454445b46a6286db17b14c |
| package.json | 5279 | 017660a7415dc49d09c0d2503fc4a1e475c219a2641f1ed218996c499fb61e42 |

本次原件root `/private/tmp/kiro-current-kas-member01-k5vna1mo`；[SOURCE-REFERENCE](SOURCE-REFERENCE.json)记录这三件与[既有完整archive](../v3-kas-source-02/selected-public-source.tar.gz)逐byte相等，归档4097039B/SHA `0ab5cb92dae244ffb20577d7767baee9706c5f4605b615c279300f4b01cae267`。已确认内容可完整取回，故复用该归档，不以摘要替代唯一源、不重复保存15MiB。比较脚本[compare_saved.py](compare_saved.py)，[工具返回](REFERENCE-TOOL.json)actual0，不是重跑提取或模型。

主读package.json：@kiro/agent **0.66.70**，声明Node **>=22.13.0**、bin acp-server.js；这些是包声明，不是当前实际embedded Node版本。仅三成员相同，整体compressed/decoded tar与旧版不同。旧[transport静态分析](../v3-kas-review-01/transport/REPORT.md)关于这些相同JS字节的Node HTTP/1.1 SDK发送器、raw CreateResponse发送器、默认GAR/实验分支、UA/代理内容可按内容复用；旧native VA/caller/资源选择不能复用为当前运行事实。

## 两次失败不补绿

[static01](../current-kas-static-01/SUMMARY.md)宽const第9magic超cap、未完成fullSHA；[anchor01](../current-kas-anchor-01/SUMMARY.md)第二anchor窗第9magic超cap、未完成唯一性/afterStat。两driver/gates保持失败。anchor01提供第一个明确frame候选，本case只验证该frame内容，不重扫失败窗口、不扩大magiccap；**全局唯一性和native资源使用仍false/unknown**。

[本case合同](EXPERIMENT.md)、[只读driver](inspect_once.py)、[AST-only检查](AST-TOOL.json)。没有target/JS/模型执行、真实auth/settings读取或系统配置改变。下一解决自然安装和正式完整输入执行边界，不重复这三个成员/通道组件验证。
