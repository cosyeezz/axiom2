# 已定址KAS归档的限额public源码提取

前置：ASM资源slice `fileoff290729622/22001675B`，头及有界prefix已证Zstd→tar，server相对路径为`node_modules/@kiro/agent/dist/server/acp-server.js`；不再查此前native/doc资源。此项新问题是只取得真正KAS包的public实现，以便定位原生请求构造/发送和Mac观察边界；**绝不执行归档代码/安装依赖/走CLI或ACP桥接**。

一次已定位slice流式解码/归档遍历（不是模型请求或目标启动）；先从同一file descriptor全量hash当前官方chat，与已绑定SHA一致才取资源，结束再核inode/size/mtime稳定。预算CPU120秒/墙钟180秒；压缩input精确不超过22001675B；zstd window<=16MiB；解压总量<=512MiB；tar成员<=40000；只选择`node_modules/@kiro/agent/package.json`与`.../dist/`下public文件，<=4096文件/合计64MiB/每文件8MiB。算法流式64KiB块，不宣称macOS AS硬限。

Python标准tarfile只r|解析PAX，禁止extract/extractall；只对精确前缀下regular member使用extractfile读取。拒绝绝对/穿越/反斜线/NUL路径、过长路径、重复选中path与选中链接；输出进入新自有TEMP，保存为非可执行只读文件，不应用archive权限/owner/mtime。其余成员仅越过不保存正文。最后继续drain decoder，要求真实frame EOF、没有超slice/trailing压缩数据，记录完整压缩与解压SHA；不把tar header/checksum代frame完整校验。

冻结脚本先用自有小归档非模型夹具核路径/预算和解码，再只执行一次官方slice提取；若失败保留本case输出/原因，不冷重试。只报告所选public源码路径/size/SHA、结果与边界，不读取HOME/登录DB/Keychain/凭据，不联网、不更改应用源码或用户设置。提取成功也不等effective runtime或最终parity。
