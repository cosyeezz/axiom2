# 新KAS候选03：旧长度假设失败

唯一一次main **exit1 / 0.54s**；完整新冻结chat同FD SHA符合预期。`verification.json`记录`RuntimeError: trailing-compressed-data`。不更改代码、offset、长度、oracle或此case结果取绿。

失败点为自写ZReader._pump：libzstd返回frame结束0，但该次输入buffer仍有未消费字节或声明compressed范围还有remaining，于是严格拒绝。说明当前候选声明范围不能被接受为一个无trailing的单frame；**不足以反推出准确新长度、checksum完成的持久证据或native当前使用关系**。异常路径未保存reader计数，不能补猜余字节数。

TEMP `/private/var/folders/gn/pzy6cn7s7m96cr9z58tqwzmw0000gn/T/kiro-mac-kas-source03-8esyv04v`有三个选定public成员，但它们只是失败实验的partial输出，不是通过完整frame门禁的成功源码集。未执行/import/require它们或依赖。

[AST检查](ast-check.json)已证相对已过21合成测试的source02仅改snapshot path/完整SHA/TEMPprefix三常量，算法/selector/所有预算未变。source03 SHA `727d3a65b63ec42b81ebd6d817dd6edacdcb38fb320fb87648f58f88f1a841dc`。失败不是重新读取live、凭据或模型引起；各0。

下一实验须先从新冻结native resolver明确pointer/length，再新case验证完整帧与选定public成员；不沿用旧长度，不盲放宽预算。正在独立静态任务t11204，尚未有结果，不猜地址/长度。
