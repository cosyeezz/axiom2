# Kiro提交与Mac迁移：验证边界

本目录记录从Windows调查转向macOS原生Kiro CLI的**工程提交检查点**，不是Mac实测或最终服务器等价验收。入口：[Mac接手](../../kiro-macos-handoff.md)。

## 继承的历史证据

Windows完整交接的76/76文档检查、Pi1.1.0解析，以及去品牌190分批覆盖、IPC189/JS74/controller38均是各自产物和运行环境上的历史记录。其来源与范围见[Windows证据摘要](../../../.agents/skills/kiro-native-parity-evidence/references/windows-evidence.md)。本次没有重跑Windows夹具或真实CLI/模型。

## 本次新验证

具体命令、退出码、待提交tree/源SHA和结果写入本目录`verification.json`（提交前生成）。验证的是选择性暂存后的工程树，特别是从混合compression文件中分离的Kiro marker及用例、新Skill与Mac文档；不使用未提交的其它工作“垫过”检查。

新旧测试不合并累计，不将纯静态/类型/模拟测试称真实出站。待提交快照使用当前Windows安装的依赖；Mac依赖安装、工具兼容与实际CLI基线仍待目标环境验证。没有部署、服务重启、真实认证、模型调用、抓包或Windows失败尝试复演。

## 可携带内容和保全

本次Git保存应用Kiro增量、匹配测试、方法Skill、迁移路线和来源指纹。原Windows `kiro-parity-handoff-01`（30文件只读）继续保留；其原manifest与验证记录不因Skill新版而改写。原私有绝对路径、凭据、未知正文和大pcap/二进制不复制到本目录。需要原始报告时按文件名/SHA另行受控转移，不能把摘要当原件。
