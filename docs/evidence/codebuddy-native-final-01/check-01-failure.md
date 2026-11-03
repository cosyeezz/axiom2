最终文档/文件检查的两次oracle失败：

1. `node docs/evidence/codebuddy-native-final-01/VERIFY.mjs` exit1：`25 !== 13`。脚本把CodeBuddy目录的JS及source map都选入，却误按12个JS+index=13文件计数。
2. 随后错误推测额外文件为`.d.ts`，加入不存在的index.d.ts并断言26，exit1：`25 !== 26`。

`find app/dist/native-providers/codebuddy -maxdepth 1 -type f`及index查询确认实际为12组`.js/.js.map`和公共index.js/index.js.map，没有声明文件。修正为完整26个实际产物并逐一比较SDK03冻结SHA；不修改生产代码或减少覆盖。两次失败均发生在Pi导入之前，只做本地文件检查，无实发。后续新跑完整最终检查，原失败保留。
