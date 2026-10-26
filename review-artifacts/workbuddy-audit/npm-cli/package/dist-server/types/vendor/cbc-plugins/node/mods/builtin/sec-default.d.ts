import type { Register } from '../types';
/**
 * 内置 `sec-default` mod —— 给 mod 能力面加一条**最小**的安全底线。
 *
 * ## 为什么要有，又为什么要克制
 *
 * `--plugin-dir` 加载的是第三方代码，`$.fs.*` 让它能读写任意路径。宿主给一条
 * 默认底线是合理的；但内置策略过严会**悄悄弄坏**合法 mod，而且用户很难猜到是
 * 被内置规则拦的。所以这里只拦「几乎不可能有正当理由」的那一类：
 *
 * - SSH 私钥、云厂商凭据、`.env`、浏览器/钥匙串数据库；
 * - 写操作额外拦住 shell 启动文件（`.bashrc`/`.zshrc` 之类）—— 往里写一行就是
 *   持久化的任意代码执行，而一个 mod 有正当理由改它的情形基本不存在。
 *
 * 其余一律放行：真正的收紧应当由用户自己装 policy mod 来做，而不是宿主替他决定。
 *
 * ## 坐在 builtin tier，因此可被用户覆盖
 *
 * tier 顺序 `prepend → user → append → builtin → core`：用户装的 mod 在**外层**，
 * 可以先于本 mod 应答、也可以把调用拦在到达这里之前。这是刻意的 —— 内置底线是
 * 缺省值，不是不可绕过的沙箱。真正不可绕过的边界在宿主自己的权限系统里
 * （PreToolUse hook、permission 检查），那一层 mod 动不了。
 *
 * ## 拒绝必须说清楚是谁拦的
 *
 * 否则用户看到的是「mod 读文件失败」，会去查文件权限、查路径拼写，唯独想不到是
 * 一条内置规则。每条拒绝都带上本 mod 的名字和命中的类别。
 */
/** 内置 sec-default mod 的名字。 */
export declare const BUILTIN_SEC_NAME = "cbc-sec-default";
/** 内置 sec-default 的 register。 */
export declare const registerBuiltinSecDefault: Register;
//# sourceMappingURL=sec-default.d.ts.map