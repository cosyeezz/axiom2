# 官方headless封外网启动观察

当前未实发/未claim。**offline14已通过：官方headless完整读取合成SSE、返回marker并自然exit0，外部网络0。** 仅合成JWT，整个外部网络Socket/TLS/fetch/http2禁止；远程请求现映射到父进程自有loopback原生HTTP fixture（OFFLINE-NATIVE-PRELOAD.cjs），保留真实ClientRequest/IncomingMessage语义。私有HOME/cwd/config/TMP，应用文件写入抑制或重定向/dev/null，不存raw stdout/stderr/body。raw stdout白名单新增仅用于全合成离线fixture，绝不能沿用到真实模式。

- offline01/02/03：CLI exit0但未完成模型目标，外网0。真实headless加载。全HTTP mock把本进程`/internal/agent`请求也截走，CLI只是输出mock JSON，不是模型链通过。03唯一child调用是ioreg读取机器元数据，已阻断。
- 独立新增路由静态窗2×4000B：headless [5421700,5425700)、[5425700,5429700)，保存于`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/codebuddy-print-route-static-gphaiy78/`，manifest有SHA。DefaultModeStrategy使用kernel-assigned端口/endpointProvider/cliExecutor调`/internal/agent`，无需追daemon绕行参数。
- offline04：加`--host 127.0.0.1`，只允许当前进程实际监听的loopback端口及`/internal/agent`透传；45秒SIGKILL，未留final report。随后加5秒白名单心跳及父进程取最后完整JSON，缩短watchdog20秒。
- offline05：20秒SIGKILL；外网尝试0，当前进程ownedListener1/localConnection1；真正handler到达GET `/v3/config`与POST `/v2/chat/completions`。还出现GET `/v2/geoblock`、POST `/v1/traces`与`/v2/report`（全部mock，无外部发送）。不能将辅助流量视为0，真实前须明确禁用或精确门禁。
- 四个child调用被拒绝：ioreg、scutil --proxy、git config user.name、/bin/sh shell-snapshot。没有执行这些子进程。真实模式若需设备/代理不能伪造，要单独核只读调用允许范围；shell-snapshot不应放行。
- offline06确认真正请求使用gzip压缩；有界解压后model/none/stream/prompt全匹配，tools0，max_tokens128000，UA `CLI/2.179.0 CodeBuddy/2.179.0`。字段含extra_vars/cache_retention，官方系统上下文保留，不强行删成Axiom模板。早先false来自未解压，不是官方选错模型。
- offline07–09排查SSE时序，延迟25ms无效；独立审查t12454/r12456+r12457建议用原生HTTP fixture，offline10已替换。但仍挂起；offline11允许仅合成私有写入也未解决（随后恢复抑制），offline12按API语义返回child拒绝结果也未解决。
- offline13定位关键证据：本地/internal/agent响应complete=true、buffer16256B，但无data/readable消费者。原因是夹具将`http.request(options, callback)`规范化后错误地调用`originalHttpRequest(input, undefined, callback)`；对object重载Node丢弃第三参数callback。改为`originalHttpRequest(config, callback)`，不是官方或模型缺陷。
- offline14通过：externalNetworkAttempts0、ownedListeners1、local/native fixture connections5；官方请求model/none/stream/prompt匹配、tools0、gzip、maxTokens128000；模型合成响应811B消费完成、本地结果16256B返回，stdout包含marker，自然exit0，未超时。写抑制34次，无token出现在捕获输出。该结果仍是离线合成，不是外部模型真实成功。

OFFLINE-PRELOAD明确AXIOM_CB_OFFLINE=1才执行，远程永不forward，因此不是可以直接切换的live harness。父进程只注入明显合成JWT，无真实auth读取；退出后删除owned目录。仍需独立审查跨通道/直接ClientRequest/本地资源归属/写入抑制覆盖，不能称OS沙箱。SDK端真实失败另见../codebuddy-native-component-live-01/REPORT.md。
