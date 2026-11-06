# 国内原生修复正式验收合同

授权目标：修复当前 CodeBuddy 国内版（Workbuddy）原生实现，并验证正式 Axiom 多轮文本、工具、图片。仅测试当前已配置两模型：glm-5.3、deepseek-v4.1-flash。CLI2.179.0静态依据见[CLI-STATIC](CLI-STATIC.md)，不执行CLI、不读CLI凭据。

## 门禁与副作用

- 离线新回归与构建先通过；正式服务仅4317仓库实例，不碰4319安装实例。重启使用独立进程脚本，必要短暂断线，不手动先kill。
- UI与正式WS皆走正常认证、worker、原生sender；不直接API代发或mock。使用两个新建专用会话，不对主会话发prompt。
- 当前agent.model/UI选择会改变主会话默认。先新建会话读回原选择；每次测试后新建无prompt探针会话读取当前默认，仅在它仍等于本次测试最后选择时通过正常agent.model恢复原值并再新建读回。若检测并发变化，停止修改并报告未恢复，不写数据库绕过接口。不会修改其他已有会话。
- 模型工具仅限本验收scratch、测试图片以及该测试会话自己的记忆文件；禁止访问凭据/网络/删除文件/修改产品代码。正常系统及历史不裁剪，不伪造账号属性。
- 目录 artifacts/codebuddy-repair-20261106-01/ 保存合成fixture、runner、白名单报告与claim，不保存模型请求响应原文/截图/未知错误/token/敏感hash。正常Axiom会话与记忆记录不属于另存调试证据。

## 有界场景

每模型8个独立case，共最多16个prompt admission：
1. off文本记忆与Unicode短回复（无工具）；
2. high续轮回忆并简单计算；
3. off write→edit→read→bash，断言真实fixture变更及工具配对；
4. 工具错误恢复（只读不存在fixture，再读正常fixture）；
5. 新图UI粘贴上传→read工具图片→正确形状颜色识别；
6. 图片历史回忆+文本记忆，刷新重连后原会话可见（刷新不agent.resume）；
7. Unicode长文本开始后主动取消；
8. 新prompt恢复，并确认原有文本记忆。

glm先跑，失败停当前case并调查，不重用claim。每case最多180秒、最多8个已观察assistant请求候选或12个工具调用，触限立即agent.stop；全套最多40分钟。附图为合成PNG、每模型不同，答案不写prompt和图名，避免固定答案污染。取消case必须已观察真实流式内容才停止。

每次case发送前用wx独占claim；成功、失败、超时均耗尽。失败后修复或额外尝试必须另合同/新case，不自动重跑。授权成本为上述有界正式对话，认证刷新/标题辅助可能由正常应用产生；不伪称每prompt只有一个物理请求。物理推理数从native assistant记录观察，未捕获路径明确未知，不进行TLS抓包。

## 验收与证据

- 每case断言run.selection对应模型/档位、无隐藏native error、工具执行结果与后续回复；图片必须实际命中新tool image路径，不仅附件显示。
- 白名单报告仅case标签、模型、档位、计数、状态、固定诊断stage/protocolCode/businessCode、断言布尔、时间；未知错误不写盘。会话/worker本地识别数据仅写控制文件供续跑，绝不注入上游身份。
- build产物与正式worker启动时刻/产物非敏感SHA检查独立记录。源码、产物、独立SDK（本轮离线Node sender）、正式服务、UI分列，不把旧36轮或SDK03当本轮实发。
- 八准则逐项结论；正式账号图片可用性、refresh、恢复、TLS/连接复用等未知不得推定通过。
