# 后续最小真实验收计划（尚未执行）

前提：用户允许必要重启、修复构建已加载，独立scope、固定目录已有modelId；先文本成功再扩展，不直接执行旧matrix。全程正式Axiom WS。失败保留receipt/input/run/message、安全kiroFailure；不盲重放、不换模型碰运气。

1. **纯文本**：同一 `claude-sonnet-5.5/off`，新隔离会话计算37×19，确认为703且无工具。同时检查生成UUID合法、选择未漂移。请求仍可能携带工具声明，不把“未调用工具”称“无工具schema”。
2. **只读工具闭环**：仅允许read读取 `/Volumes/D_Work/axiom2/docs/evidence/kiro-long-session/fixtures/inventory.csv`，核对真实assistant toolCall、对应toolResult及后续assistant；期望red=14、blue=28、green=9、total=51。不运行shell、不写真实资料。
3. **历史**：不调用工具，回忆同一会话上轮三色和total以及新随机标记；检查user/assistant/tool配对历史、无重复副作用。
4. **思考**：在适配器已声明支持的明确档位中进行off→low/high→off小测试。准确记录发送配置、可见thinking块及最终答案；有thinking输出不证明预算硬上限或内部思考不存在。跨档位历史不得泄露内部wrapper。
5. **图像**：使用既有visual-a.png、visual-b.png真实PNG，先用户图识别，再read工具返回图片，再历史回忆。题目与黄金答案须先人工读取图片确定，不能只确认图片被序列化。
6. **取消恢复**：优先取消纯文本流，不通过昂贵长任务制造取消；记录部分输出、cancelled及新输入后的正常回复，禁止自动重放。必要时另做无副作用工具取消。
7. **用量与失败**：检查原生完整/partial/missing用量标记，下游不把未知数值当免费；本轮物理HTTP次数若没有可信观察，持续记unknown。离线覆盖损坏帧、schema错误、超时和权限错误，不为测错误触发不必要服务请求。
8. **官方CLI对照**：用户登录CLI后，在不含真实文件的专属临时目录用CLI自有登录态执行同一纯文本，`--no-interactive --trust-tools=`，同model/effort且固定engine。再视必要做同一只读fixture。CLI用户代理/机器指纹不复制进Axiom；能观察caller/default/实际请求的才列为相同，历史官方源码证据不冒充当前2.33.1线上wire。

当前阻塞：UUID修复未部署，必要后台重启等待授权；CLI显示未登录，等待用户自行完成。CLI不是Axiom继续真实验收的前提。
