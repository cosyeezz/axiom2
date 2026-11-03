# 自然入口观察设计：首候选窗口，不伪造owner终态

本文件是设计，不是可执行的official runner或实发门禁通过。当前正式配对0；不补prompt恢复runtime01，不执行提取bundle，不改官方/auth/全局网络配置。

## 当前源码证据

[current-kas-member-01](../current-kas-member-01/SUMMARY.md)已证明当前2.36产物内三public成员与旧归档逐byte相同。acp-server.js SHA bf79b2b0fa7ae68653abdf117b4a4dbf064fec6fa7ca49500115f3f2f67581b1，主新读其完整第17677行：

- `sgd()`把真实stdin/stdout转Web stream，传入`new $Ze(...)`；默认transport stdio，auth默认user，合法mode包括acp-callback。实际CLI选择仍未知。
- 尾部注册SIGINT/SIGTERM，`lLs`尝试`c0r.terminate()`与4000ms timer竞争，随后显式`process.exit(0)`；第二signal调用`IKt`，callee未在本轮定位。WS graceful_shutdown另有显式process.exit。
- 因而不能把“自然退出总会走beforeExit”作为所有分支收尾保证。以上仅静态分支；没有触发信号/启动官方或WS端点。

当前[private_sender](private_sender.cjs)在await ready后才暴露installObservers；open socket及deadline timer保持事件循环。普通CJS --require只启动async createSender并不阻止应用先发HTTP；直接beforeExit等待收尾还可能被自身socket/timer挡住。这是实现结构，不是runtime01失败原因的推断。

## 选择的最小设计方向

定义**首个候选请求构造观察窗口**，不试图接管整个official生命周期：

1. 新的独立组件同步安装两个已测adapter，立刻记录初始active状态；不修改已通过的private_sender/adapters。连接私有socket可异步，但连接ready之前的固定status与原候选只入有界私有RAM队列，保持顺序。queue合同不得接受任意应用hook/thenable；必须保持原HTTP调用一次/this/args/return/throw。
2. 第一个候选交付时只安排一个microtask；等当前adapter回调返回，再close两observer，记录其closed瞬时状态、随后flush队列并finish通道。任何reentry/第二candidate/closed冲突/cap/sink/socket错误为sticky failure，不把第一次快照洗绿。
3. 这不等待beforeExit、不改process.exit或信号handler、不阻断/重放HTTP、不消费response/body iterator、不以整个app退出作为协议前提。自己的socket可以延迟进程自然退出直到通道finish/故障；必须明确这是观察器的生命周期扰动，不能声称全应用透明。
4. 通道仍只给candidate-pair有限比较；仍没有peer身份/自然安装/完整请求/wire receipt/authscope/owner终态证明。首窗口之后的HTTP、重试、fallback、tool-loop不在覆盖内，**不能称一次总推理/总网络或无后续请求**。broker结果后latefault可能传不出，旧结果非权威终态。
5. 仅作用于明确入选的Node进程。可复用runtime01有限primitive argv角色判据作为候选filter，但role不是来源；需要另外的当前代码身份/自然launcher关联证据。不得输出runtime rawargv/path/env/headers/body/token/claims/hash。

## 正式门禁仍缺什么

上述方向如实现，只减少“IPC ready之前漏掉首请求”和“依赖不可靠退出回调”的组件缺口。不能凭它直接实发：

- 官方自然launcher实际继承/消费preload未证。新真实case只能直接服务请求对照，不能以prompt找hook；原无INPUTprobe继续Failed。
- 精确deepseek-3.2模型选择、是否fallback/额外title等模型调用、完整输入和工具循环的范围必须明确。已读旧entry-model证据可按相同JS内容复用：provider保留显式selectedModelId，但session还有refusal/availability fallback声明、title LLM路径；未证明当前flag/触发或native CLI如何传model。
- 正常Axiom完整context与账号/代理执行路径仍需当前source复核（相关文件有外部改动）。不能裸user-only或手塞token，不能将provider-level冒称normalapp。
- 两头观察边界不同，authScope未知、实际发送/接收还需独立证据；有限窗口不是整体验收替代品。

## 下一实现前的有限own验证需求

只为上述新行为定义新case，不重跑旧codec/adapter矩阵：同步首HTTP在socketready之前仍入队；普通异步ready后first候选；同一turn两个候选拒绝；连接失败时原HTTP仍执行且raw引用释放；close/microtask重入及晚fault的固定失败。至少一组不同进程的实际ownHTTP证明新调度与已测协议能组合。具体case数/预算/外部deadline与CreateNew须在执行前另存。现已有[first_request_window.cjs](first_request_window.cjs)初版：同步install、最多5帧/原mux.bytes上限的RAM队列、first candidate后一个microtask close、flush/finish；ready/done/snapshot/abort显式API，无自动preload或角色证明。[语法检查](WINDOW-SYNTAX-TOOL.json)actual0仅Node --check，没有require/功能测试。随后[window-main01验证](WINDOW-OWN-VALIDATION.md)已唯一完成6case/3功能Node/2ownHTTP，actual工具0，原件/源码快照32文件已保全；仅新调度/IPC整合有限PASS，不产生真实运行许可。包含Node-before-ready/Undici-after-ready、同turn双candidate、连接失败原调用继续、owner abort、done后saved wrapper晚fault，以及最后执行的close冲突。测试时本文的5341B版本已完整保存在归档source-snapshot；原WINDOW-SOURCE-BINDING仍绑定该旧文档版本，功能代码未改。
