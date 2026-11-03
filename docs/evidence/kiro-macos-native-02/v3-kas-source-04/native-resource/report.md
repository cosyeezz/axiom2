# 新冻结 KAS 静态定界（仅版本绑定静态证据）

结论：取得本冻结中明确的原生资源 ptr/len。KAS bundle 是 slice offset 75706006、len **22000545 (0x14fb3a1)**，不是旧候选 len 22001675；旧范围多含 1130 bytes。本轮未解压，不能声称修复后的解压成功，也不能声称自然 Command、当前模式执行或实际使用。

## 身份与定位
- 源：`/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-identity-rebind01-vni48j5_/kiro-cli-chat.macho`，413051920B。
- 完整 SHA256 `7f684ad558ea35de830086a6d44f3eff4835ce381b70c861f365c8842729b94f`。版本 2.35.2/签名绑定为委托背景，本轮未重新做签名验证或独立提取版本号。
- ARM slice offset 215023616；实际 Mach-O 节表 __text 4352/69216304B、__TEXT,__const 73916416/112409560B。
- 本轮 LC_FUNCTION_STARTS 197396912/194104B，实际 SHA256 `b501bc1a04fe6296a2d418b4c2b7d558d393d1e5954180a6d31c12cb63d5a82e`。
- 新 const 中精确 NODE anchor VA 0x105d2e237 / slice 97706551；SERVER anchor VA 0x105d2e249 / slice 97706569。const 另各有一次文本命中，均记录。
- 仅一次 __text ADRP+邻近 ADD 扫描；新表重新定界为 [0x101631f3c,0x101634f40)，12292B（与旧线索碰巧相同，不是沿用旧地址）。xref NODE 0x101631fe8/fec，SERVER 0x10163214c/150；`acp-server.js` 0x101634928/92c。
- 只离线反汇编该函数：合成 Mach-O 原 VA；LLDB --no-lldbinit --batch，disassemble --bytes。无 launch/attach，无其他函数反汇编。3073 条连续4B指令，完整12292B，无未知解码标记。

## 原生构造、传递与角色
### KAS bundle（与 native Node 不同）
- PC 0x101632fe8 ADRP x8，0x101632fec ADD #0xe96 -> **VA 0x104832e96**；0x101632ff0 str x8,[x19,#0x280]。
- 0x101632ff4 mov w8,#0xb3a1；0x101632ff8 movk w8,#0x14f,lsl#16 -> **0x14fb3a1**；0x101632ffc str x8,[x19,#0x288]。
- 对应全文件 offset **290729622**；exclusive slice end **97706551**（恰在 NODE anchor 前，不把字符串算进压缩资源）。
- 原生 state 传递：0x1016332d8/2dc 取 len/ptr；0x1016332f4 存 ptr/len 至 state+0x90；0x101633318 完成至 state+0xc8；经 0x1016342b4–2c0 拷贝到 state+0x130 的对象（ptr/len 位于+0x150/+0x158），**0x1016342d0 BL 0x101635798**，x1=state+0x130。另有异步对象流向 0x101633428 BL 0x101bf9b94。仅说明调用接收含该资源的状态，未分析被调函数，不命名为已证实 decompressor。
- 附近直接 referent 文本为 “KAS bundle already extracted”、“KAS extraction lock timed out”、“failed to acquire KAS extraction lock”，与 resolver 后续 JS 路径吻合。可认定为此 resolver 的嵌入 KAS bundle；“public”若指包内公开资源目录/发行分类，本轮未检视解压内容，不能独立证明其内部布局。
- 以同一新只读 FD 核完整源 hash、stat稳定，再 hash 此明确范围：**a5e411f1eb7fb0924e441b5076f3dde33137aaa226b8ec6399de34b84db923aa**。

### native Node resource
- 0x1016324cc/4d0 -> **VA 0x105d2e7cb / slice 97707979**。
- 0x1016324d4 mov w10,#0x743e；0x1016324d8 movk w10,#0x194,lsl#16 -> **26506302 (0x194743e)**。
- 0x1016324e4 stp x9,x10,[x19,#0x110]；**0x101632504 BL 0x101636c74**，x1=state+0x90（对象+0x80含ptr/len）。旁有 node/node.sha256 路径及 “extracted KAS node runtime” 文本。
- 同 FD 范围 hash **349490442c0197b7a94cf30e8f0e2cf6523bb5461e19540d36ce58ad9e313552**；exclusive slice end 124214281，其后恰为64字符ASCII hash referent。

### server 路径 join
- 同一 BL 0x102d631e8 链：0x10163489c `node_modules` len12；0x1016348bc `@kiro` len5；0x1016348dc `agent` len5；0x1016348fc `dist` len4；0x10163491c `server` len6；**0x10163493c `acp-server.js` len13**。
- 由基目录得到 `node_modules/@kiro/agent/dist/server/acp-server.js`；随后 0x1016349a0 BL 0x102d59270，结合错误文本是 canonicalize 候选。未展开 callee，类型命名保持静态推断。

## 范围、未验证与建议
- referents.json 共126个64B定点窗，累计8064B <=8192B（部分重复重叠也计入）；没有扩大函数。只做资源范围 SHA，未导出/解包/执行资源。
- 旧 source03 trailing-compressed-data 失败保持失败。新 len 比旧短1130是 native 指令的结果，不是试探EOF或猜测。下一轮若另获授权，可仅针对新范围做有严格EOF/remaining判据的离线验证；本轮不做。
- 无官方/JS执行、网络、模型、live、HOME/auth访问、依赖安装或仓库修改。
- 工作目录 `/Volumes/D_Work/axiom2`；所有产物独立位于本 TEMP。
