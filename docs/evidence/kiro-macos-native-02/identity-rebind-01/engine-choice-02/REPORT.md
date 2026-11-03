# 新冻结 chat：engine 选择静态复核

## 身份与边界
只读 identity-rebind-01 指定新 snapshot，实际全文件 SHA256 7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f，413051920B。ARM64 slice=215023616。新 __text SHA 与 verification.json 一致；LC_FUNCTION_STARTS 194104B SHA b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e 已核。
一次 const/cstring 定位、一次 __text ADRP+ADD 扫描。所有命中新 VA/offset 在 locate.json。warning VA=0x108c34e6b（以 locate.json 数值为权威）。唯一精确 xref 0x1019aabc8/cc。函数表定提示函数 [0x1019a87e8,0x1019ab298)，10928B；选择 callee 是新原字节 BL 解出的 0x1018951d4，函数表再次针对该 callee 核定 [0x1018951d4,0x101895fc8)，3572B。chat.agentEngine 精确字串起点 xref 落另一 58468B 函数，超限未反汇编，不能绑定 key73。

## 新代码独立数据流
0x1019aab6c-78: x0=sp+0x5a0，x1=sp+0x1a0，x2=[sp+0xd0]，BL callee。返回首字节==1走错误处理后仍到 warning；非错误读取 output[1]，==2 跳过 warning，否则显示 warning。这不能简写为“错误一定不提示”。caller 在 0x1019aab5c-68 条件写 input+0x13e=3；上游条件未命名。
callee: input+0x136 bit0 =>2；否则 +0x137 bit0 =>0；否则 +0x13e !=3 =>该值；==3 且先前 w27 bit0 =>2，其余进入后续路径。context+0x10 的数字 key0x73 查询在 0x10189531c-324，未证明该 key 是 chat.agentEngine。
0x101895738-8e8 ASCII 大小写折叠比较重核：v3/kas=>2，v1=>1，v2/rust=>0。正常 output[1]=选择值、output[2]=w24、output[0]=0（0x101895c04-c0c）。这是解析值映射，非源 enum 声明。context 不存在/无效可调 fallback 0x101894f90，未分析第三函数。flags名称、key73身份、default/fallback实现、当前effective均未知。

## 与旧结构比较
只读取旧冻结 ASM 文本作对照，未读取/执行旧二进制。新起止与实际 BL 目标恰好同 VA，但均由新 bytes/table 推出，绝非复用地址。逐指令差异见 verification.json；范围内控制结构未见改变，主要重定位指令差异不能推出整个版本等价。

## 执行与限制
cwd=/Volumes/D_Work/axiom2。所有 acquisition/verification 为 /usr/bin/python3 - heredoc，exit0；首定位 Python CPU 4.32s。LLDB 只装载 TEMP 原字节/原VA合成 Mach-O，HOME 指向本 TEMP 空目录，--no-lldbinit --batch，target create --no-dependents --arch arm64，disassemble --bytes。
首次提示函数命令 start/end 手输 +0x2000，实际只解出函数尾部（LLDB exit0），无外部原始字节可读；随后仅补缺失前8192B，无重叠。合并完整2732条、callee893条均逐条匹配新原字节，无gap；详细命令/退出码 commands.log。0官方执行/launch/attach/模型/网络/真实HOME/凭据，未改repo。此为静态证据，不是运行时测试或有效引擎证明。
