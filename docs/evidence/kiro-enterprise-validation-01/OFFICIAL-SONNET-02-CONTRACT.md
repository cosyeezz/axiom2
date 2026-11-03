# official-sonnet-02

范围、安全、60秒chat/128KiB预算、一次启动、现有Google登录而非企业IdC、物理请求unknown及清理要求同OFFICIAL-SONNET-01-CONTRACT.md。01在settings只读preflight退出1，chatLaunches=0，旧claim耗尽，不重跑。

新信息：实际settings list --help确认--format属于list子命令；只读settings list --format json已独立验证exit0/JSON dict/清理通过。02仅修正该子命令参数顺序，独立case/claim/agent名；监督器与ACP投影直接复用未改变的official-sonnet-01.py函数及七项已过离线夹具。不复用01 main或claim，不追加第二个prompt。CLI正常配置内容保持RAM前后比较。
