# 首候选窗口 main01：独立own整合

只验证新first_request_window.cjs，不重跑旧codec/adapter矩阵，不运行official/模型/认证。工作目录为本0700TEMP，源来自repo request-pair-design-01/WINDOW-SOURCE-BINDING.json；功能执行前后逐文件hash核定，测试期间主不修改覆盖源码。

唯一controller（尚待创建）使用/usr/bin/python3 -I -B；主Node及W01两child共3功能Node，绝对hostNode-v22.23.2路径；另先前Node --check1进程不计功能数。新CreateNew RUN.lock、只一次；controller wall12s/timeout20s，Node CPU8/9、CORE0、NOFILE64、FSIZE262144仅ownsynthetic，normalHOME真实官方不在范围。全Node stdioDEVNULL，显式HOME/TMPDIR/PATH/LANG/LC_ALL五键（传入集合非native mergedenv证明）。源及fixture/application读取另记，不宣称OS/loader/wholeauthor全量预算。sourcehash读取≤256KiB，结果单文件≤32KiB，有限ownharness总wall上限不等实测时长。

六case仅W01有HTTP：
- W01主harness own127.0.0.1服务，左右独立child。Node ClientRequest同步.end在IPCready之前已经candidate入队；Undici fetch awaitready后发送。共2ownHTTP，body完整非ASCII fixture相同，各serverbody==input，broker两个body彼此相同（不把这两oracle冒称独立brokerraw==serverraw）。两个window最终closed、candidate1/frames5/queue0，固定报告证明调用次序和状态。
- W02同turn两次synthetic ClientRequest.end，原API各一次/返回不变，但window固定失败，队列释放。
- W03own0700目录缺socket，连接拒绝期间synthetic原调用仍一次，队列释放。
- W04显式owner abort，无HTTP，两个observer收尾/队列释放。
- W05synthetic左+手工固定右frame配对后，saved wrapper晚调用：原API继续、live snapshot变failed，而旧done保持其时间点结果。仅证明限制，不能说owner终态或无late。
- W06close冲突最后执行，fixture预排microtask换ownprototype end，observer不得覆盖新owner且window失败；人工还原fixturedescriptor后仍不声称old adapter WeakSet完全恢复，不做后续安装。

W02–W06只有own fake prototype和own Unix frame，不发送HTTP/模型；不把synthetic调用算HTTP。W01使用实际HTTP/Undici，正常own TLS不涉及（只有loopback明文）。全部body/headers只有公开synthetic；报告只固定布尔/计数/枚举/ownPID/端口/版本，不含原文或任意错误。主controller/harness/child/manifest/binding必须全保存后执行；失败保留、不修旧gate重跑。
