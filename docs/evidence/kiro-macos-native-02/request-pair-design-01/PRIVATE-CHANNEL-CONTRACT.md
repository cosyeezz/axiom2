# 私有双端Unix通道（实现未测）

新增[private_pair.cjs](private_pair.cjs)与[private_sender.cjs](private_sender.cjs)，显式创建/连接，无import自动安装或模型调用。复用冻结codec/mux/adapters/body_pair，不重跑旧矩阵。

## 范围及安全边界

- broker只在新建`/private/tmp/kiro-pair-XXXXXX` own0700目录创建left/right.sock，0600，各允许一次连接；角色是调用方指定槽位，**不是官方或Axiom来源证明**。第二次连接使该观察失败。socket可见性不防同UID恶意进程、lstat与connect不是原子绑定，没有SO_PEERCRED/审计身份保证；不宣称IPC已鉴权。
- 仅原candidate值在有界私有RAM、socket及内核缓冲；无raw文件、token/请求hash/任意key/exception输出。目录和socket是唯一组件文件系统创建物；不读取账号配置/秘密。正常官方/应用如何继承endpoint、自然安装、控制退出及完整context尚无runner。
- 每端mux最多1311296 accepted bytes，应用每次read≤65536B、1024push；Node/内核可以预先缓冲更多，**不是精确内核receive cap**。每端只接受一个candidate且来源必须有先前active status；两adapter均须active→closed，pending0、计数非递减、closed candidates=submitted=该来源实际交付数。故障、截断、缺status、重复candidate、提前关闭都不能形成candidate-pair。
- 默认15秒、可显式100–60000ms；是事件循环timer，不是防阻塞的硬墙钟。真实case必须另有独立owner deadline。sender终身write总量≤1311296B/candidate≤4/control≤32，write(false)保留排队含义，不重放；大frame一次write也不等服务端单chunk。
- broker只发FIN无data，sender拒绝任何回复数据；candidate按UTF16LE帧跨进程保留原JS字符串，正常HTTP编码不改。
- 结果固定状态/计数+body_pair固定字段、原header文本相等bool及边界labels；不同边界不能把文本差异当wire差异，也不以相同文本证明认证scope。没有raw候选getter。header授权scope仍unknown，不用同REDACTED制造相等。
- `candidate-pair`只说明私有通道收到两个有status的candidate并完成纯比较，**所有完整请求/自然安装/peer身份/认证一致/owner终态/wire证明均false**。EOF后的晚调用可能无法通过已关闭socket传到broker；sender自身stickyfault仍可变，旧result不是权威终态。不能以sender/broker关闭+随后exit0拼成无late证明。
- sender先await connected再显式installObservers，两adapter初始status入流；caller在不再请求时closeObservers→finish→await done。通道失败不改变原request API参数/return或重放请求，socket close会尽力关闭own adapters。它不是取消模型或工具循环的控制器。
- dispose只等待own server关闭、比对own目录dev/ino再rmdir，不递归删/清理未知文件。失败保留固定fault，无异常原文；sameUID替换不受完整防护。

## 新验证方案（未执行）

排除“纯codec通过但跨进程socket收发/adapter整合不通”的假设。唯一新0700TEMP，预存manifest/controller/harness；一个hostNode supervisor+harness及最多两个own子Node（合计≤3），整个harness硬owner timeout≤10秒，task180秒预算单列。最多6个named integration cases：

1. 一次真实跨进程配对：两own子sender、各一次own loopback HTTP（Node HTTP与安装库undici.fetch），受控非ASCII完整JSON/body含system/history/tools/unknown字段。正常自有本地HTTP，不接公网/模型/官方/auth。核传入body与serverbody在RAM相等、broker逐UTF8相等、各1candidate和closed statuses、子wait与socket/channel清理；它只是own整合，不冒称normal app。
2. 新socket负面边界：fixed remote fault sticky；缺closed status/无candidate拒收；分片截断或非法流拒收；第二连接拒收；不发送数据的deadline/cleanup。至多6namedcases，可合并断言，不拆成更多请求。

主代码冻结后子仅ownTEMP写测试，不改源码/合同。只保存固定投影，不落raw网络内容/异常stack。fixture与case失败保留，不自行重试；未覆盖项直接写unknown。原codec/adapters已过矩阵不复跑。主读取原件及实际命令/退出，actual工具exit不可得保持unknown。所有模型/官方实际调用仍0；此合同不是正式模型执行许可。
