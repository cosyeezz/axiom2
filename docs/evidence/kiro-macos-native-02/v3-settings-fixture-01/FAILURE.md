# 空HOME getter未完成：受限运行返回EPERM

`read_empty.py`实际exit1，子CLI exit1、0.318秒、stdout0B、stderr44B，无timeout；空HOME目录起止一致。未保存未知stderr，只存hash `b1104d6114ce4410914c16e513b566026db57000c428464112eefd18edeb5b73`。

随后只在离线内存中对固定公开错误候选计算hash，精确匹配 **`error: Operation not permitted (os error 1)\n`** 的44B。没有重新执行目标。该错误未指出被拒绝的调用，不能断言是getter语法、隐式设置写入或某个文件路径问题。

原profile拒所有文件写入、真实HOME读、network/securityd。此case保留不重跑，不把EPERM当用户未配置/默认v2/已启用v3。

独立t11002/r11005随后在当前launcher ARM64产物定位了`settings`/`cli.json`/`_KIRO_HOME`/`.kiro`常量，支持非secret JSON设置候选`$HOME/.kiro/settings/cli.json`，但拼接尚未证。替代新case将**只在自有TEMP写入已知v2/v3 fixture，允许自有目录初始化、同时保护已知settings文件与真实HOME**，是改变前提排除EPERM/路径/常量返回假设，不是冷重试本case。不得读真实配置直到自有路径/值敏感性得到验证。
