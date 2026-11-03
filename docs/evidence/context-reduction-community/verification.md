# 调研证据核验

日期：2026-10-29。交付：[研究报告](../../community-context-reduction-research.md)、[来源清单](sources.json)。

本次是来源与静态兼容性核验，**不是安装、运行兼容性、安全审计或节省率实测**。没有执行候选第三方代码，没有修改产品实现、配置或后台进程。

## 来源一致性

- 报告与来源清单共有 31 个不重复的外部 URL，全部 HTTP 200。GitHub `blob` 文件以对应 raw URL 获取，行号片段不参与 HTTP 请求。
- 6 个 npm 制品的 SHA-1 全部与清单及 npm registry `dist.shasum` 一致：optimizer、Context Mode、Chisle、DCP、Condense、pi-context。
- RTK 指定的 3 份源码在 v1.0.1／v1.1.0 两套缓存中全部满足清单 SHA-256；两个 tag 通过 GitHub API 核对 commit。
- 13 份 RTK／Context Mode／Chisle／Headroom 线上源码与所审查缓存逐字节一致；Context Mode／Chisle 的 tree commit 和所选 Git blob SHA 另行核对。
- optimizer 的 4 个已审查发布文件与 tarball 内容逐字节一致。
- Chisle 初始缓存没有保留原始 tarball；本次从官方 registry 重新获取 3.8.1 制品，SHA-1 与清单一致，其中 5 个已保留的 npm-static 文件与制品逐字节一致。没有把 main 与同版本 npm 包当成同一制品。

来源复核实际命令：

```bash
# cwd: /Volumes/D_Work/axiom2
python3 /tmp/axiom-research-verify-sources/verify.py
python3 /tmp/axiom-research-verify-sources/supplement.py
```

两条命令退出码均为 0。原始研究缓存为 `/tmp/axiom-context-research`；复核脚本、逐 URL 响应记录及日志位于 `/tmp/axiom-research-verify-sources`。这些是临时工作区，不承诺永久保留；可重复获取的固定 commit、版本、URL 和摘要已保存到来源清单。

## 兼容性与事实复核

只读审查当前 Axiom 的 `agent-worker.ts`、`capability-resources.ts`，当前安装 Pi 1.4.0 的 Code Mode 文档与 extension runner，并对照候选发布源码。确认以下边界：

- 子代理不自动加载用户 packages／extensions；新增 MCP／Code Mode 不是默认子代理能力。
- Axiom 当前仅在有选中 MCP 时注册 Code Mode。
- Pi 替换文本而不提供 `structuredContent` 时会删除旧结构化值；多个候选有此风险。
- Context Mode 不是可靠的 OS 隔离层，其 Read 提示统计不能直接证明模型入口节省。

复核纠正并再次确认了两处重要表述：

1. **Condense 有独立 eager spill 路径**：启用后，未受保护结果达到 65,536 字符，可以在首次模型请求前落盘／返回回执，不需要摘要模型或预算触发；语义摘要的触发和费用另算。依据发布包 `index.ts:932–951`、`src/spill.ts:81–113`、`src/pruner.ts:128–147`。
2. **pi-context 会丢失混合内容中的非文本块**：`dist/lifecycle.js:22–41` 抽取文本后把整个 content 数组替换成文本回执，图片等未被保存。不能将它称为通用完整原文归档。

主代理读回上述源码确认后修改了报告，并通过独立只读复核确认两处修订准确。主代理又将 Condense 5 份、pi-context 2 份相关文件与各自发布 tarball 逐字节比较，全部一致。

报告的本地文件链接、来源 JSON 解析和本次新增文档的空白检查通过；没有运行产品回归，因为未修改产品代码。

## 仍未验证

- 候选在 Axiom RPC 中的实际安装、加载、恢复 UI、取消与费用接线。
- 各模型／provider 的结构化结果、缓存、流式和权限路径运行表现。
- 真实任务正确性、最终模型入口 token、总费用、延迟及跨平台效果。

HTTP 200、近期维护、peer semver 范围和静态源码一致性都不构成上述能力已经通过验证的证明。
