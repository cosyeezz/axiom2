# CodeBuddy 流字段兼容修复

## 依据与修改

[官方真实补证02](../codebuddy-cli-compare-02/REPORT.md)确认中间帧为 `function_call:null`、`finish_reason:""`。原生核心此前把它们视作非法终态。修前新回归2失败/1通过，证据[before.log](before.log)。不能反推旧SDK01未保存字段的精确值。

[client.ts](../../../app/src/native-providers/codebuddy/client.ts)仅增加：
- null legacy function_call及安全空占位（只含name/arguments且值为空串/null）视作无调用；非空/未知键/畸形类型拒绝。
- null tool_calls视为无新增片段。
- 空finish只表示未完成，不是合法终态。

工具schema、调用身份、审批、无coercion、stop/tool_calls+DONE+干净EOF、禁止重试均保留。官方末帧legacy对象已观察，但内部字段未知；安全空占位支持不等已观察其具体内容。

## 新跑验证

- [core-after.log](core-after.log)：core/HTTP/stream **39/39，exit0**。
- [sdk-after.log](sdk-after.log)：Pi/native组件/独立SDK/continuation **14/14，exit0**。指定的session-retry.test.ts不存在，未计入，未冒称旧测试重跑。
- [build-01.log](build-01.log)：完整tsc/Vite/server **exit0**，仅chunk大小警告。

合计53测试。新SDK02冻结1089文件/62关键artifact，manifest SHA `42389cfda8a470c93aa8c99d4f0a2768b8f7c2dbccdc27646093c32422880b1b`。node_modules仍为安装链接，不是完整不可变依赖快照；范围外Kiro/worker产物漂移未回退、未纳入本修复验收。

修复后SDK02已唯一实发：nullable首帧通过，但后继工具名空增量被拒，闭环仍失败，见[真实结果](../codebuddy-native-component-live-02/REPORT.md)。尚未部署/重启；不能用这些离线结果称真实对齐交付完成。
