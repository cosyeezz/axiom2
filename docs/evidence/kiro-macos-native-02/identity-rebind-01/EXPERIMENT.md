# 重新绑定发生漂移的官方产物（静态，零目标执行）

## 触发与假设

t11026/r11170在旧函数表SHA断言处真实失败：实时chat由413051984B变为413051920B，旧offset处表hash不符，两个待查helper均未读。禁止套旧VA/fileoff，失败原件保留。随后只读bundle公开metadata自述2.35.2，不能猜更新原因，也不把metadata当CLI `--version`实测。

本case仅建立当前文件同FD全SHA、fat/slice/UUID/section/function-table身份及只读快照，比较旧版是后续独立问题。不运行官方CLI/JS、不读设置/auth/Keychain/TLS keys，不回滚/重签/改系统、用户配置或app源码。

## 范围与预算

- 一次主脚本；两个指定Mach-O各一次原文件顺序复制+SHA；冻结后解析/hash可复用，不二次读实时旧offset。公开Info.plist/Resources/manifest.json前后各一次只读，不含secret。
- 文件cap：launcher80MiB、chat450MiB；总源数据512MiB。1MiB流式buffer，无RLIMIT_AS承诺。输出只读快照在CreateNew TEMP；不执行。
- CPU最多120s、主脚本monotonic170s、外层180s；输出metadata/JSON<256KiB。预查TEMP剩余>=2GiB，RLIMIT_FSIZE512MiB。copy失败/源FD或路径stat漂移/metadata漂移/越界立即失败，保留partial和事实，不重新执行本case。
- Mach-O解析只支持实际fat magic、little-endian64 slices；nfat<=8、loadcommands<=4096、sizeofcmds<=4MiB、总sections<=1024；逐范围检查。hash每slice和__text/__const/LC_FUNCTION_STARTS/LC_CODE_SIGNATURE，记录LC_UUID；不是函数分析或执行可达证明。
- 签名显示/验证另列子命令和exit，签名未知不伪造通过。快照第一阶段不执行任何子进程。随后signatures-01仅四条codesign（两文件verify strict、ARM64 display），每条CPU10s/墙钟15s、两日志各64KiB、外层90s；sandbox禁网/真实HOME读/securityd/其余文件写，仅白名单各自stdout/stderr文件写。目标仍不执行，不改保护/签名。

## 自有测试前置

首轮65项真实62pass/3fail，暴露open_regular拒绝时泄FD；原source/results已冻结在synthetic-01。主侧仅补异常close(fd)，新独立回归t11178/r11186：AST唯一cleanup改变，原65重执行+受控stat-race1项=66pass/0fail/exit0，source SHA `9e6f4935cc44c2ff5d1afd5828445df8d63ed96ff4b3feaff85fee7ed7ffa232`，证据synthetic-02。原测试使用PATH Python3.14.7；正式主脚本拟用/usr/bin/python3，因此只再新case运行同66项核解释器兼容（CPU30s/工具45s/生成<=256KiB，仍不调用main/官方文件），不重复相同环境的已过检查。通过后才执行唯一一次真实快照main。

## 接受与不接受

成功仅限静态快照一致性、重新解析身份。必须前后原FD及当前path stat稳定、两个metadata bytes稳定、复制readback hash等于原FD SHA。CLI自报版本、loaded image、当前引擎/feature/sender和Mac观察门禁仍未知。旧2.35.1冻结证据不失效，但不得冒称新版。下一步按新metadata坐标核差异，而不是原VA冷重试。
