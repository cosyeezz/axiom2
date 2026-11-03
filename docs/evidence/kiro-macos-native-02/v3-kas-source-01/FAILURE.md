# 官方slice提取01：保留file-cap失败

自有合成夹具`t11095/r11099`19项通过；主侧已读回脚本/results/log并核冻结sourceSHA `cb215d185e1387fb25b9da69e7270e8bc767df56d54e628e300944893452dd4c`。可重用原件已保存[synthetic-01](synthetic-01/results.json)，不把合成通过当官方成功。

随后唯一一次`/usr/bin/python3 -I -B .../extract_source.py`官方只读资源提取实际 **exit1 / 0.211s**。完整chat同FD实际SHA匹配`d238aa4ffd52f127b692edc6e4cdbe9198610c67c8af819e82b81bdd2fe47dd1`；[verification](verification.json)记`RuntimeError/file-cap`（成员size<0或>8MiB的guard，未保存具体offending path/size，不能猜测为某个文件）。未到frame EOF/checksum，不能称完整资源验证。

自有输出`/private/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-kas-source01-sl31xz8v`只盘点得3个partial public文件：server/acp-callback-auth-provider.d.ts、acp-server.d.ts、acp-server.externals.json。尚无acp-server.js；不要执行或当最终源码集。原RUN_STARTED/source/verification及失败全部冻结，**不重跑或修改本case取绿**。

下一项独立问题：只选择已证server entry/package manifest/externals metadata，不再选择整个dist；为public bundle将单文件上限显式设64MiB、总128MiB，其余解压512MiB/成员40000/window16MiB/CPU120s不放宽。新namespace02先核未变解码器及新精确selector自有tests，再新的一次流式提取。不是无限调预算/全包落盘，仍0模型/CLI或JS执行/凭据/HOME读/应用源码改。
