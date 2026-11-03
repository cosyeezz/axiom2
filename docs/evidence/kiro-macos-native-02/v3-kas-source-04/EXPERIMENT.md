# 新native长度绑定后的KAS public源码04

source03唯一一次实际失败`trailing-compressed-data`，保留原source/results/partial，不重跑刷绿。新独立t11204/r11205已精确消费并主读完整report、核实际mov/movk ASM：新resolver新表定界`[0x101631f3c,0x101634f40)`12292B，3073条连续指令；PC0x101632fe8/fec构ptr0x104832e96，0x101632ff4/ff8构**len0x14fb3a1=22000545**，比旧候选短1130B。这是新机器码结果，不是试探EOF猜长度。

新版嵌入KAS slice offset75706006、全fileoff290729622、exact len22000545、SHA `a5e411f1eb7fb0924e441b5076f3dde33137aaa226b8ec6399de34b84db923aa`。新native state+0x280/+0x288→对象+0x150/+0x158→PC0x1016342d0 BL0x101635798，callee语义/自然Command/实际使用未证，不冒称完整解压调用。该resolver的`node_modules/@kiro/agent/dist/server/acp-server.js` join链已核；native Node资源另指ptr0x105d2e7cb len26506302，不能混为JS。

输入仍同一新冻结chat：full SHA `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`、413051920B，不读live。相对source03自写工具**只改len常量和TEMPprefix**，先AST核；解码/selector/全部资源预算不变，复用source02已21过的合成算法验证，不重复同环境未变算法测试。单file64MiB/总128MiB/window16MiB/decoded512MiB/tar40000/CPU120s/内170s/工具180s；3个精确public成员。

唯一一次`/usr/bin/python3 -I -B docs/evidence/kiro-macos-native-02/v3-kas-source-04/extract_source.py`；同FD完整hash后严格frame EOF/checksum、无压缩trailing、tar三文件及最终stat稳定。实际结果读回后比较新旧成员SHA。0官方/JS执行、0安装/import/require成员、0模型/真实HOME/settings/auth读取。成功仅静态源码交付，不是当前session/effective/AB分支/服务器parity。
