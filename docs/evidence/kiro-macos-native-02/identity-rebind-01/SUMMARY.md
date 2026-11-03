# 2.35.2官方产物重新绑定

## 已证范围

研究中实时文件改变，旧函数表SHA断言失败即停止旧偏移研究。新独立case只读两个指定Mach-O，并在同FD顺序hash/复制，重新解析fat/slice/UUID/sections/函数表；原文件和公开metadata前后稳定，冻结副本逐字readback相符。快照main仅一次exit0，0.915897秒/CPU1.019702秒。不是原子loaded-image证明。

公开Info.plist与manifest自述 **2.35.2 / build20261029.011827**；未执行新版`--version`、CLI聊天或JS。快照目录：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/`，两副本mode0400。

| 对象 | 完整大小 | 完整SHA256 | ARM64 slice offset/size | ARM64 SHA256 |
|---|---:|---|---|---|
| launcher | 73432992 | `8e242d795f93a70bc4497907d9aaf2d1552a07ee8a7a86e0276af6cf55672fd2` | 37388288 / 36044704 | `b5a4bd41f4de99c533fa45e6ef06cd3a2e5dec7b635aaf8a4da5338d8afc9e93` |
| chat | 413051920 | `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f` | 215023616 / 198028304 | `10a6269929f3c2ddf235161672c5a131093245b17ce31a67f36878d1d6077545` |

chat ARM64 UUID `850598ce04bb35bc8a877bb30f91bd0e`；新`__text`69216304B，比旧版增加84B。新函数表slice offset **197396912**、194104B、SHA `b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e`。不能从总体仅少64B或某地址恰相同推断可沿用旧VA。

## 本地签名

[独立签名记录](signatures-01/verification.json)：两条`codesign --verify --strict --verbose=2`、两条ARM64`--display --verbose=4`均exit0。每条CPU10s/墙钟15s，两个日志各64KiB；sandbox禁网、真实HOME读取、securityd及其他文件写，仅白名单两个自有输出文件。原快照stat不变。

两者显示AMZN Mobile LLC，Team `94KV3E626L`、Hardened Runtime；identifier分别`kiro-cli`和`kiro-cli-chat`。ARM64 CDHash分别`2083868c808ffef920a6abd0984c3cd463721f47`、`edaa54478c6d71b7ff2a18281cc20b75c03a8129`。这些是本地静态命令证据，非Gatekeeper、notarization、安装来源URL或实际加载映像证明。display也明确`Info.plist=not bound`，不要把公开plist版本声称为签名绑定的CLI自报版本。

## 自有工具测试与保留的真实失败

- [首次测试](synthetic-01/results.json)：65项62pass/3fail，发现拒绝输入后泄FD；原source/results保留，不改oracle。
- 唯一修复为`open_regular`异常时close(fd)。[AST与回归](synthetic-02/post-check.json)：原65重执行+受控stat-path-race1项，Python3.14.7下66pass/0fail。
- [解释器兼容case](synthetic-03-system-python/results.json)：正式SystemPython3.9.6下同66项全部通过，不计为新的132项语义覆盖。
- 测试与正式脚本SHA均`9e6f4935cc44c2ff5d1afd5828445df8d63ed96ff4b3feaff85fee7ed7ffa232`。合成测试不是并发替换、loaded image、完整Mach-O语义、Mac进程监督或服务器行为验证。

## 资源与引擎还需新版证据

候选旧KAS范围虽在新`__const`内，但[新候选hash](resource-candidate-01/verification.json)为`463c215fb7f1d6b75416d6745dd52f69ad98a245863b171b432150d49bbdc997`，不等旧compressed SHA；原实验exit2完整保留。不能凭它复用旧public源码，更不能声称此候选已是当前caller使用的资源。头部是zstd magic不代表完整frame/checksum或tar已核。

[新版engine局部报告](engine-choice-02/REPORT.md)独立用新bytes/table复核warning函数与选择callee；地址恰与旧相同，但893条callee中72个字变化。只证`v3/kas→2`、`v1→1`、`v2/rust→0`，非错误`output[1]==2`跳过warning。错误处理后也可能流入warning，不能把“绕过读取output[1]”简写为“绕过warning”。flags名称、key0x73身份、default与当前session effective仍未知。

## 限制与下一阶段

0真实模型请求、0新版官方CLI/JS执行、0app源码修改、0真实settings/auth读取。旧版storedEngine=v3的单key投影仍是一次历史设置读取，不因本阶段为0而抹去。旧2.35.1证据继续有效但仅限旧冻结产物；不迁移未经新证据绑定的旧VA、实现或KAS结论。

下一阶段继续新KAS候选完整帧/三public成员验证、新engine key/default和自然KAS启动链；Mac观察门禁未通过，不能启动模型基线。原生直连与精确`deepseek-3.2`目标不变。

[完整快照记录](verification.json) · [预算与实验](EXPERIMENT.md) · [快照脚本](rebind_identity.py) · [签名脚本](verify_signatures.py)
