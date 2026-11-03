# 现代工具后继空name增量修复

[SDK02真实证据](../codebuddy-native-component-live-02/PROJECTION.json)确认：首工具片段完整且匹配声明，后续片段function.name为空串，id/type缺省、arguments有新增。旧core误把空name视为改名，产生stream/partialtrue/tool错误。

[client.ts](../../../app/src/native-providers/codebuddy/client.ts)仅修改既有工具的name一致性条件：空串视为无新增，不替换初始名字。首次name仍必须为已声明工具；非空改名、nullname、变id/空id/坏type、JSON/schema/完整终态检查保持。新增2测试覆盖正例与这些负例。

- [before.log](before.log)：修前定向1FAIL/1PASS，exit1。
- [core-after.log](core-after.log)：client18+HTTP6+stream17，41/41，exit0。
- [sdk-after.log](sdk-after.log)：Pi/component/nativeSDK/continuation，14/14，exit0。
- [build-01.log](build-01.log)：tsc/Vite2649/server全部exit0，仅chunk大小警告。

共55项本轮测试，未跑不存在的session-retry.test.ts，不把旧14项加进来。没有公共API/依赖变化。

随后[SDK03](../codebuddy-native-component-live-03/REPORT.md)真实2轮/3模型/1工具通过，VERIFY exit0，验证了此空name后继及严格完整终态。0部署/重启，不等整个官方协议或UI对齐。
