# 当前Axiom请求入口只读复核

现有多个入口有其他工作改动，主重新核完整context与normalruntime/账号路由/网络。只读公开源码及Pi文档；不import应用/auth/provider，不读取账号/模型配置内容、不网络/模型/测试/构建/重启、不改生产或他人改动。只调用公开SDK文档locator取得当前版本/路径；它import SDK非应用，不调用auth/runtime。旧SDK1.4.0的README/custom-provider/sdk已有完整阅读记录，当前版本变动则补读；实施新runner前核必要SDK交叉引用。

已主fresh全文读model-runtime.ts；model-service.ts只1–270（快照按bytes.splitlines为710行；早期由工具剩余行提示推算711不准确），只核constructor/runtime/prepareAuth必要段；脚本documentation-paths.mjs全文。新runtime有kiro getModels/getAllModels组合隔离、getAuth API断言、每物理请求去除一次性handoff option再由正常SDK取OAuth等逻辑，不能沿用旧简化描述或绕过正常stream包装。后续worker/context/account/proxy/native provider/observer必要窗已核，11公开文件快照已保全；限定结果和未读范围见FINDINGS.md。以读取范围/SHA和当前证据为准，不把静态路线当真实账号/模型可用证明。

委派t12094/r12095已失败（openai无APIkey），matched消费，无可靠原件/执行数，主继续独立研究，不重启任务/改登录。正式pair0。
