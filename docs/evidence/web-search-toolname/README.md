# 搜索工具名 A/B：kiro.rs 清空 web_search 参数

- 环境：kiro.rs（`http://localhost:8990`，commit 8fb3dd69），模型 `claude-sonnet-5.5`，强制 `tool_choice`，同一份 schema（`queries` 为必填数组），同时附带一个 `read` 工具。
- 脚本：[ab-request.mjs](ab-request.mjs)。key 从 `~/.pi/agent/auth.json` 读取，不输出。
- 结果：`web_search` 四次调用都返回 `input: {}`；`google_search`（[ab-google_search.json](ab-google_search.json)）和 `axiom_search`（[ab-axiom_search.json](ab-axiom_search.json)）各两次，都返回 `{"queries":[...]}`。
- kiro.rs 源码只在请求恰好只有一个 `web_search` 工具时才拦截，其他情况下名称和 schema 原样转发。因此参数是在更上游的 Kiro 服务被清空的。
- 处理：工具对模型的注册名改为 `axiom_search`。
- 改名后验证：用源码里的真实工具定义（`axiom_search` 加 `web_read`，[real-definition-request.mts](real-definition-request.mts)），经 kiro.rs 发给 `claude-opus-5.5`，不强制调用。两次请求模型都自行调用了 `axiom_search` 并带上 `queries`（[real-definition-opus.json](real-definition-opus.json)）。
- 定向测试 59/59 通过（[tests.log](tests.log)）；`tsc --noEmit` 和 `tsc -p tsconfig.server.json --noEmit` 退出码均为 0。生产后台未重启，新名字要重启后才生效。
