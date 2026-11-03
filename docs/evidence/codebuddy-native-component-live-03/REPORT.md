# SDK03 真实工具与下一轮闭环：通过

唯一 `HARNESS.mjs --live` 自然退出 **0**，随后 `VERIFY.mjs --live` **exit0**。[结果](PROJECTION.json)与[验证指纹](verification.json)已保存；claim耗尽，不重跑。

## 验收

固定 **codebuddy-cn / deepseek-v4.1-flash / off**，正常Axiom账号路由→Agent→ModelRuntime→Pi薄适配→独立原生HTTP，非CLI代发。

| 项目 | 实际结果 |
|---|---|
| 语义轮 / 逻辑 / 物理model | 2 / 3 / 3 |
| HTTP | 三次200 |
| 响应 | 4722B/11帧；6778B/19帧；7425B/21帧 |
| 协议及传输终态 | tool_calls / stop / stop；每次DONE恰好1且干净EOF |
| 工具 / 宿主审批 | read_component_fixture各1，严格path=fixture |
| 输出 | 工具后精确fixture marker；下一轮精确marker_NEXT |
| caller与身份 | system/security/history/schema保留；call-result配对；同session，前两请求同run，下一轮新run，invocation唯一 |
| UA / 思考设置 | CLI/2.179.0 CodeBuddy/2.179.0；reasoning_effort=none |
| 辅助请求 | refresh/catalog/profile/其它aux均0 |
| 清理 | observer3对、bodies/cancels/aux0、Agent settled、provider disposed、dispatcher关闭、TCP回基线、配置未变 |

三次末帧均真实观察到 `function_call:{name:"",arguments:""}`，无未知key；这是**Axiom SDK03的观测**，不反推官方02未保存的对象内部。现代工具后继空name被安全当作无增量；完整严格终态及schema后才审批执行。diagnostics为空。

上游usage：prompt/completion/total分别395/42/437、466/17/483、513/19/532，cached_tokens均0。计量不代表价格或免费。

session `511ce9dd-d436-4b0c-adbc-dda8f68c59a9`；run1 `9ec0ea59-2f5e-4b99-b6a9-79109b7d3775`；run2 `24aa21ad-29bf-4ab2-8c85-4d6fe1e764e9`。

## 准备及可复验产物

- [修复03](../codebuddy-native-fix-03/)：修前1FAIL1PASS；修后41core+14SDK=55项通过；完整build exit0。
- 冻结1089文件/62关键artifact；相对SDK02仅client.js变；manifest SHA `3f47792091f9789b0314c250e1f53911b17804a25259df3afd4aabb8a0105e49`。
- [selftest](selftest-final-01.json)：exit0，3合成model/1工具/1正常Pi合成refresh，坏终态/取消/late/多工具拒绝/刷新中取消/限额通过；网络0。
- [观察测试](observation-test-01.json)：8项皆过，网络及auth/config读取0。子任务总结被预算取消，原进程退出码未持久化；主代理读取产出并另行绑定/断言exit0，不冒称找回原退出码。
- [import](import-final-01.json)：主代理补执行exit0，network/writes/children0/env不变。两个准备子任务的最终报告被系统预算取消，没有重复已完成测试。
- [preflight](preflight.json)及[readiness](readiness.json)：exit0，当前OAuth/native sender/direct/系统代理禁用/配置未变，全部指纹绑定。

HARNESS SHA `55da2e680a82c20d40f8700143882ea577bf35a9d19e7aaa9ac908e7efb7ba1c`；PROJECTION SHA `1494917fab2987bae036905438889685ff37589b5061bc16ac886c1b93a5ba73`。

## 不包含的结论

这是独立SDK实际闭环，不是常驻worker/UI部署验收；本轮0部署/重启。冻结node_modules仍为安装链接，不是全依赖不可变快照。真实refresh未触发（其锁/持久化取消语义有合成验证）；不声称全部模型/配置/错误路径或完整wire/TLS与官方一致。SDK01/02和官方观察失败证据保留，不升级为PASS。
