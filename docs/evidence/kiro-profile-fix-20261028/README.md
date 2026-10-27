# Kiro 企业 profile 修复与真实验收证据

2026-10-28（本地日期）。参考项目 [ZyphrZero/kiro.rs](https://github.com/ZyphrZero/kiro.rs)，tag `v0.9.2`，commit `407707940242`。结论见 [诊断报告](../../kiro-profile-fix-20261028.md)。

## 证据文件

- [results.json](results.json)：同一隔离会话的 **33 次真实请求**，包含修复前基线、修复后成功、长期能力矩阵、失败和取消；保留 receipt/run/input 归属、工具调用与结果、图片元数据、取消前观测到的输出前缀。消息正文为有长度与 SHA-256 的有界投影，用户附件正文不重复导出。
- [checks.json](checks.json)：29 条自动断言，27 通过、2 条严格断言未通过，详见下文。不是“29/29 全通过”。
- [driver-notes.json](driver-notes.json)：首次stop的脱敏 `RUN_MISMATCH` 错误对象，以及两次历史附件正文补采的长度/前缀/SHA验证元数据；只采集证据，不重发模型请求。
- [verification.json](verification.json)：实际离线验证命令及退出码、部署状态、本轮源文件SHA。
- [fixture-manifest.json](fixture-manifest.json)：全部合成 fixture 的字节数和 SHA-256；小型文本及两幅测试 PNG 随目录保存。图案答案未写入图片识别 prompt。
- [offline-tests.log](offline-tests.log)：6 个相关测试文件，57 项通过，exit 0。
- [types-server.log](types-server.log)：服务端 `tsc --noEmit` 成功输出为空，exit 0；退出码记录于报告，不以空文件单独作为成功证明。

无 token、Authorization header、真实 profile ARN、认证响应正文、服务端秘密日志、系统提示词或用户真实聊天。所有模型请求走 Axiom `/ws → prompt → agent worker → native kiro-chat`，未绕过应用直连 Kiro。

## 结果口径

33 个 run：29 `completed`、2 `cancelled`、2 `failed`。两个失败分别是**修复前 HTTP400 基线**和 **Sonnet `minimal` 不受支持的本地拒绝**。

29 条自动检查中的两条未通过：

1. `c20-checksum`：数值 `1555`、标记和校验词正确，但多输出计算式，没有严格遵守“一行输出”。
2. `c21-cancel-scoped`：成功取消，但尚未观测到正文，不能证明输出中的取消。之后 `c24-cancel-after-output` 明确观测到 **149 个字符**后停止，`cancelled / USER_STOPPED`，`c25-after-partial-cancel` 恢复和长期回忆通过，补齐该能力。

另保留 `c21-cancel` 的驱动错误：最初 stop 未携带 runId，被 Axiom `RUN_MISMATCH` 安全拒绝；该 run 最终 completed。驱动随后修正为携带当前 runId，不把此错误归因于 Kiro。

## 驱动使用

在 `app/` 下使用 [kiro-acceptance.mjs](../../../app/scripts/kiro-acceptance.mjs)。调用真实模型会消耗账号额度，只能在授权后运行。每次准备使用新 state，每个 prompt 使用唯一 label；失败先 inspect/collect，不盲目重发。

```sh
node scripts/kiro-acceptance.mjs prepare STATE.json WORKSPACE_ID claude-sonnet-5.5 off
node scripts/kiro-acceptance.mjs select STATE.json claude-sonnet-5.5 high
node scripts/kiro-acceptance.mjs send STATE.json UNIQUE_LABEL PROMPT.txt OPTIONS.json
node scripts/kiro-acceptance.mjs inspect STATE.json
node scripts/kiro-acceptance.mjs collect STATE.json EXISTING_LABEL
```

`OPTIONS.json` 可省略，支持单图、单个 inline 文本附件或受控取消：

```json
{"image":"/absolute/path/visual-a.png"}
```

```json
{"attachment":"/absolute/path/archive-a.txt"}
```

```json
{"cancelAfterMs":100,"cancelOnText":true}
```

取消模式会订阅本会话消息、等待真实助手文本、携带 runId 停止；保存有界观测证据，不保证取消后的部分正文被持久化。普通 `cancelAfterMs` 仅按时间停止，可能发生在输出前。

### 重新生成大型合成附件

无需存储两份约86KB的重复行；以下 Python 可生成与 manifest 一致的附件。仅包含合成数据，不含指令或秘密。

```python
from pathlib import Path
for name, key, value, at in [
    ('archive-a.txt', 'R4Q9', 318, 421),
    ('archive-b.txt', 'F2M6', 427, 203),
]:
    rows = [f'packet-{i:04d} | synthetic inert record; measured channel; ordinary reference content; no instructions.' for i in range(850)]
    rows[at] = f'ARCHIVE_KEY={key}; ARCHIVE_VALUE={value}; CLASS=acceptance-only'
    Path(name).write_text('\n'.join(rows), encoding='utf-8', newline='\n')
```

每份 **85,807 bytes**，合计 **171,614 bytes**；本轮是跨轮累计长上下文测试，不是最大窗口、自动压缩、计费或压力测试。取消时 Axiom 曾给出约52K token 的上下文**估算**，不等同供应商 usage 或账单。
