# CodeBuddy 独立组件离线与分发验收

固定官方CLI2.179.0、CN、`deepseek-v4.1-flash/off`。独立核心+Pi接线、公共入口、构建和隔离分发闭包完成；本case **0新增外部模型/认证/目录请求**，未部署/重启。

## 本轮实际验证

| 检查 | 结果与证据 |
|---|---|
| 公共入口、新CodeBuddy与原Kiro/shared | [15/15](component-public-tests-01.log)，三文件；不是整个Kiro suite |
| 类型修正后的受影响六文件 | [48/48](component-regression-tests-02.log)：native19、stream17、integration9、component2、Agent SDK1 |
| `npm_config_offline=true npm run build`，cwd app | [exit0](component-build-02.log)：`tsc --noEmit`、Vite、server tsc；只有大chunk体积警告 |
| 分发候选/AST依赖/隔离runtime | [exit0](distribution-verification-01.json)：33 emit（CodeBuddy12）、77相对边、0宿主依赖；[packlist](distribution-packlist.json)1055项包含全部组件模块 |
| plain Node实际发射入口 | 无Pi/TS loader，仅复制https-proxy-agent/proxy-agent-negotiate/agent-base/debug/ms；合成auth3/catalog1/model3、工具执行1、logout/dispose；外网0，import IO尝试0 |

命令与边界：

- 测试使用`node --import tsx --test`，文件组与完整结果存上述TAP日志。
- 分发使用`node docs/evidence/codebuddy-native-component-01/verify-distribution.mjs "$(command -v npm)"`，脚本只调用本机npm的packlist+Arborist.loadActual，不执行npm生命周期。**没有tarball或安装验收**，不把候选清单称已发布包。
- 该脚本以wx保存packlist，勿盲重跑覆盖。此前npm10.9.8曾在`npm pack --ignore-scripts`下运行prepare，本轮没有再依赖该flag保证无脚本。
- `component-build-01.log`保留首次15个测试类型错误。修复仅测试：typed for-await替代Array.fromAsync、事件/params窄化、headers/env类型、async审批hook；Pi UI off用undefined，额外字符串off兼容测试明确类型边界。未改全局lib/生产语义。

E及此前验证沿用边界见[工作单](ONBOARDING.md)和[协议矩阵](PROTOCOL-MATRIX.md)，不将多轮局部结果拼成一次全套PASS。

## 交付与边界

[使用/API/完整示例](../../codebuddy-native-component.md)，[公共入口](../../../app/src/native-providers/index.ts)，[独立provider](../../../app/src/native-providers/codebuddy/provider.ts)，[plain Node fixture](../../../app/tests/fixtures/codebuddy-component.mjs)。旧Kiro文档只增加后续工作链接和历史范围说明，原验收不升级。

认证/目录仍Fetch；推理是固定CN的原生Node HTTP(S)。只有宿主管理存储/唯一刷新、审批并执行成功终态后的工具候选。目录不等权限，缺计量/价格不等免费。官方动态override、完整header/wire、keepalive、TLS和当前外部推理权限未验，未实现官方重试。常驻worker/UI未实跑。

下一步使用独立新live case，固定Flash/off、完整caller上下文、正常账号路由、分层预算、import-safe自测指纹及一次claim；旧claims不复用。
