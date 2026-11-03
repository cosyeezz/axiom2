# Pure 02 独立结论：通过（fake-only；非 official/M3）

原17 oracle逐字节复制、未改：core 7 / chunks 3 / caps 4 / audit 3，合计17 PASS、0 FAIL。新增13 cases：13 PASS、0 FAIL。原01未执行，其真实重入失败和独立SAN失败不变。

## 命令与退出
准备工作cwd：/Volumes/D_Work/axiom2；实际测试cwd：/private/tmp/axiom-pure02-independent-wm_fd6td。
主命令：`python3 /private/tmp/axiom-pure02-independent-wm_fd6td/runner.py`，exit0。
令 N=/Users/dane/.local/share/pi-node/node-v22.23.2-darwin-arm64/bin/node；S=/Volumes/D_Work/axiom2/docs/evidence/kiro-macos-native-02/observer-http-fixture-02/fake-http-tap.cjs。
实际子命令：`$N --version`；`$N <TEMP>/suite.cjs $S core|chunks|caps|audit`（四次）；`$N <TEMP>/extra.cjs $S extra`。全部exit0，真实pipe EOF，无timeout/interruption。完整argv/PID见[results.json](results.json)。实际版本v22.23.2，darwin arm64。

源码前/后SHA均为：`f21dbb781ae4d106763ef327defd0c47f7100cc358a1343fd30d6997de2fc77a`。原suite与副本SHA见[before.json](before.json)。repo未修改。

## 证据与边界
新增覆盖write/end四种嵌套return identity、内层throw identity及reservation释放、外层throw保留内层commit/释放剩余quota、超限重入、sink重入、event/log/sink故障sticky、实际base64解码总和与bytes、成功路径event/log计数、所有终态pending=0。采样点检查pending>=0及committed+pending<=cap。详见[extra.cjs](extra.cjs)、[extra.stdout](extra.stdout)；原17见四组.stdout。

重要细节：失败路径可bodyBytes=4、实际已发base64=0，因为外层原函数返回后commit，但sticky fault禁止emit；并非可消费成功。成功路径实际base64总和=bodyBytes；全部实际总和<=cap。

[delta.diff](delta.diff)及[delta-audit.json](delta-audit.json)：精确文本9项变换后整文件匹配02，只含pre-reservation/return与throw释放、available/pending状态、terminal pending拒绝；未做AST审计。

最小env仅own HOME/TMPDIR、Node PATH、C locale，无guard。目标pure require无新增imports；未访问secret、official/model或真实网络。耗时0.188s，子CPU0.168s；stdout共5059B、stderr0B，远低于60s/child10s/CPU30s、各流1MiB/总4MiB。

未验证：自动preload/exit落盘分支（仅文本审计）、真实HTTP/TLS/SAN、wire/server一致性、任意恶意intrinsics/proxy及峰值内存；不声称全链路证明。
