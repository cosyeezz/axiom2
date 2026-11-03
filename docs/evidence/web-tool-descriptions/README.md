# 联网工具调用说明精简

只告诉模型何时调用、参数如何填写及工具选择限制，不预告结果展示。未改变输入结构、返回JSON或执行逻辑。

- [compiled-tools.json](compiled-tools.json)：plain Node从最新server编译产物读取的description/parameters；search仍为三字段，reader仍为三个分支。
- [tests.log](tests.log)：web-search、web-read、session-environment共31/31通过，含模型content JSON、details及isError原样保留断言。
- `npx --no-install tsc --noEmit`、`npx --no-install tsc -p tsconfig.server.json`均exit0；原日志 `/tmp/axiom-web-tool-description-{types,compile}.log`。
- `git diff --check`通过。未重跑真实联网或全量发布包检查，因为运行逻辑未改变；未执行生产重启。
