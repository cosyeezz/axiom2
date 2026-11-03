# CodeBuddy 2.179.0：有限静态结论

目标 SHA 与预期一致；零起始字节偏移见 [manifest.json](manifest.json)。仅检查 bundle 内一处流累计/快照终结分支；未确认官方实发选择此分支，不能外推整个客户端。

## 证据
- [window-1.txt](window-1.txt)，25980000–25983450：choice 解构 `delta:eA,finish_reason:em`；新 choice 使用 `finish_reason:em??null`。更新仅 `if(em)` 写 finish；空串在首块可留在新状态，后续块则不覆盖既有 finish（如 stop）。空串自身不是完成标志。
- 同窗口：delta 的 `function_call:eS` 单独取出，以 `eS&&(...)` 更新；显式 null 不更新、不清除旧 function_call。`tool_calls:ek` 从 rest 移出，以 hasOwn 选择为 eT，仅 `if(eT)` 累计；显式 null 不迭代、不清除旧 tool_calls。null 不进入这两处后续读取/迭代。
- [window-2.txt](window-2.txt)，25986000–25987500：终结时 `e_=eh??(ec.has(eg)&&isCompleteAudio(ev)?"stop":null)`，随后 `if(!e_) throw ... missing finish_reason`。保留的空串不触发音频 nullish fallback，且因 falsy 被拒；若前面已有合法 finish、空串未覆盖它，则不能断言终结失败。

## 未知与执行记录
静态兼容 null 不证明实际响应含 null；实际三个字段值均未知。不确定 Axiom 失败根因，也不证明所有官方流路径相同。未重跑旧 case；未执行 CLI、网络或测试，未读取凭据，未改安装或生产代码。

cwd `/Volumes/D_Work/axiom2`：Python 字节检索/SHA/窗口读取退出码 0；首次写入因目标目录已存在退出码 1，无写入；改为该目录下独立子目录，保留其他任务文件。源导出定位片段 600B + 两窗口 4500B/2800B = 7900B；保存相关子窗口 4950B。未运行测试。
