# 首候选窗口：6个own整合case有限通过

[first_request_window.cjs](first_request_window.cjs) 5644B/SHA `d6a01af49975f04adf85826d6152f0669292bbc6eae251e918d17a885148cb04`：同步安装、IPC ready前有界RAM队列、首candidate后一个microtask close/flush/finish。没有自动preload、官方运行或模型；正式配对仍0。

## 唯一执行

[预存合同](window-main01/EXPERIMENT.md)、[manifest](window-main01/MANIFEST.json)、[controller](window-main01/controller.py)、[harness](window-main01/harness.cjs)、[child](window-main01/child.cjs)、[公开fixture](window-main01/fixture_data.cjs)。root `/private/tmp/kiro-window-main01.YZHohX`，唯一 `/usr/bin/python3 -I -B <root>/controller.py`，[工具实际返回](window-main01/TOOL-RESULT.json)exit0/.3s。

[controller结果](window-main01/controller-result.json)：heldNode96988/wait0，无超时；Nodewall.1507625s/controller.153275916s。两个child96989/96990各wait0/signalnull；共**3功能Node**，均v22.23.2/darwin/arm64，Undici包声明8.10.2实读。此前模块--check与fixture vm.Script各1语法Node，单独计，不是功能case。

全部功能Node stdioDEVNULL，没有pipe EOF或字节数证据。显式5env HOME/TMPDIR/PATH/LANG/LC_ALL，非native mergedenv审计。controller wall12/tool20、Node CPU8/9/NOFILE64/CORE0/FSIZE262144仅ownsynthetic；外超时kill/reap分支未触发，不能推广到真实state/官方后代。源码hash两次各73449B=146898B，manifest/fixture/OS/loader另计，whole-author墙钟未知。

## 结果与边界

完整[结果](window-main01/harness-result.json)有W01–W06六个不同ID，全部PASS：

- **W01** 两child各一次ownHTTP，127.0.0.1:59190。Node同步.end时IPC未ready、candidate1/queue3，最终peak queue5；Undici awaitready后fetch，peak queue2。各window frames5/candidate1/queue0，两adapter和channel均closed。两个serverbody各==公开输入，broker两个body互等；**没有把broker raw与server raw放入同一个直接oracle**。W01 dispose返回removedtrue。
- **W02** 同turn两次synthetic原end各执行1次/返回receiver，window因candidate-count-or-state失败，队列释放；未阻止第二原调用。
- **W03** own目录缺socket，synthetic原end仍执行1次/返回receiver；channel-setup-fault、queue0、observerclosed。
- **W04** owner abort，无HTTP；window失败、queue0、两observerclosed。
- **W05** synthetic左+手工固定右frame已形成candidate-pair及healthy done后，saved wrapper晚调用仍执行原API。live状态变observer-fault/late-call，而旧done仍none/window-closed，明确**done及旧broker结果不是owner终态**。
- **W06** close冲突最后执行，原end1次，新prototype owner保留；window失败、Node state conflict/restore-conflict。fixture还原descriptor，但不声称old adapter WeakSet owner恢复，不再安装后续window。

仅W01有**2 ownHTTP**；其余是synthetic原调用及own Unix协议，不是HTTP/模型。新测试只新增调度/IPC整合覆盖，不重复旧codec/adapter矩阵；未测试真实Node_OPTIONS、official来源/自然安装、TLS/H2新队列组合、精确caps/背压压力、全应用时序、fallback/tool-loop/response或wire receipt。socket可延后自然进程退出；首窗口之后请求不覆盖。RAM引用释放不是物理擦除。W02/W04/W05/W06调用dispose但返回未保存，不声称全部清理证实。

## 保全

[归档工具](WINDOW-ARCHIVE-TOOL.json)actual0，主核18原件、6ID/全部PASS、3PID/exit、2HTTP、fixture SHA与source前后/当前SHA。18原件+13测试时source副本+原binding共**32文件**exclusive逐byte复制，另[AUDIT](window-main01/AUDIT.json)。旧11源未改，新window实现测试后也未改。

测试时NATURAL-WINDOW-DESIGN的5341B/1382784a30110ad6f809e050f8dd5ddadf49bb29b91566658d43022aa6149308完整副本保留于[source-snapshot](window-main01/source-snapshot/request-pair-design-01/NATURAL-WINDOW-DESIGN.md)，当前设计文档随后只更新结果，不能用旧测试绑定冒称当前doc SHA。不可把这些PASS作为真实模型执行授权或高度一致性结论。
