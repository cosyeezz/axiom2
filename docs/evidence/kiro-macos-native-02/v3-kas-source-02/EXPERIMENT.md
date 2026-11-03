# 精确server entry源码提取02

01真实file-cap失败保留：[FAILURE](../v3-kas-source-01/FAILURE.md)，不修改/重跑该case。其decoder与安全边界19个自有合成测试已通过，不等官方提取成功。

本项新增假设：真正server JS可在64MiB单文件预算内取得；只选择`node_modules/@kiro/agent/dist/server/acp-server.js`、同目录`acp-server.externals.json`及`@kiro/agent/package.json`，而不是整个dist（不取source map或其他大bundle）。总选中<=128MiB/4096文件，单file<=64MiB；source01的解码/路径/link/duplicate/PAX逻辑不变，仅selector和main显式budget变化，自有tests先核后执行。

其余边界不变：同FD官方完整chat SHA先匹配；仅asset fullfileoff290729622/22001675B，zstd window16MiB/总解压512MiB/tar成员40000；CPU120s/内deadline170s/工具180s；新CreateNew gate。只写自有TEMP无x只读public文件，frame EOF/checksum/精确slice完整校验后记录hash，源文件stat稳定。禁止执行成员/CLI/JS、安装依赖、网络、HOME/登录DB/凭据、用户配置或应用源码改动。若再失败保留并根据新事实换方法，不无限放宽预算。
