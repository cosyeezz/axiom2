# 2.35.2 KAS完整源码与旧public成员等同性

## 新版原生边界与完整解包

新版冻结chat完整SHA `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`，[本地身份与签名](../identity-rebind-01/SUMMARY.md)。[新native报告](native-resource/report.md)独立从新anchor/xref/函数表定位resolver；原生指令构造ptr`0x104832e96`、len **22000545**。全file offset290729622，compressed SHA `a5e411f1eb7fb0924e441b5076f3dde33137aaa226b8ec6399de34b84db923aa`。

旧长度22001675多1130B；[source03实际失败](../v3-kas-source-03/FAILURE.md)保持exit1/trailing-compressed-data，不改旧结果。本case相对03只改新native长度和TEMPprefix，[AST检查](ast-check.json)已过；decoder/selector/所有预算不变。

唯一main **exit0 / 0.515s**：[verification](verification.json)。同FD完整hash正确/stat稳定；compressed读=消费=22000545，frame EOF/checksum完成且无压缩trailing。decoded197488640B、847 tar成员，只选三public文件/15030951B。decoded SHA `5da33dd04f069609a019f21d601d04d7e46df205a28461e54f1618c9410bb526`不等旧版，不能把完整tar说成等同。

## 三个public成员逐字相同，可复用既有静态审计

[成员比较与保全报告](member-comparison.json)一次exit0：新三文件读回，与旧选择metadata及永久归档的实际成员逐字相等。原生资源23份copy也逐字匹配TEMP；独立核原mov/movk组成长度22000545。

| 成员 | bytes | SHA256 |
|---|---:|---|
| acp-server.js | 15025207 | `bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1` |
| acp-server.externals.json | 465 | `99bf8b686ced7f999ffc2733565fdb92d895705272454445b46a6286db17b14c` |
| package.json | 5279 | `017660a7415dc49d09c0d2503fc4a1e475c219a2641f1ed218996c499fb61e42` |

无需再存一份同内容归档，安全可取的完整副本为[只读三成员归档](../v3-kas-source-02/selected-public-source.tar.gz)，4097039B、SHA `0ab5cb92dae244ffb20577d7767baee9706c5f4605b615c279300f4b01cae267`；本次重新核完整archive SHA、各成员类型/mode0400/大小/实际bytes。只读归档不授权执行/import/require官方成员或依赖。包自述@kiro/agent0.66.70、AWS-IPL、Node>=22.13.0，并非CLI外层版本。

因此以下旧public源码审计可**仅限这三个同bytes成员**用于新版静态实现参考，无需重做相同源码扫描：

- [入口与模型](../v3-kas-review-01/entry-model-evidence.txt)：模型目录动态获取，`deepseek-3.2`唯一字面量是no_vision集合，不是可用目录；initialize可能远端/持久化/遥测，有副作用。
- [实际双API caller](../v3-kas-review-01/dispatch-report.md)：feature精确`create_response`启用`POST /v1/responses`，否则GenerateAssistantResponse候选为`POST /generateAssistantResponse`，不能把默认disabled等同当前有效值。
- [transport与feature来源](../v3-kas-review-01/transport/REPORT.md)：两候选实际链均为Node HTTP/1.1 http(s).request，SDK或raw分支；实际endpoint/region/代理/UA/实验值仍需runtime。forSmithy也非最终headers。

## 严格边界

原生resolver接收资源和路径join已有静态证据，完整frame/tar已另核；但被调函数完整语义、外层自然Command、所用Node/runtime、当前session engine/选路、目录实时可用性仍未证。新版native Node资源与Bun/TUI候选不同；三public成员相同不证明整个CLI、Node二进制、完整tar或服务器行为相同。

0官方CLI/JS执行、0依赖安装、0模型、0真实HOME/settings/auth读取、0app源码改。未跳Mac观察门禁，不宣称最终parity。原生直连与精确`deepseek-3.2`要求不变。
