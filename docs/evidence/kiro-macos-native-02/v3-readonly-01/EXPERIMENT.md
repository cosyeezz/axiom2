# V3 精确设置只读契约

新增假设：官方CLI的`settings --help`能明确区分单key读取与写入。静态产物已明确存在`chat.agentEngine`和写入命令文案，但**不执行写入命令**。本case最多1次help，只有单独实验通过读取契约后才考虑精确key getter；不执行chat、--v3、配置迁移、settings --all/--list或任何模型命令。

执行选择已绑定`/Applications/Kiro CLI.app/Contents/MacOS/kiro-cli` ARM64，在自有空TEMP cwd/HOME/XDG目录；最小环境，不继承credentials相关环境变量；sandbox deny network、deny文件写入、deny真实HOME文件读取、deny securityd lookup，确保无真实用户设置/登录存储读取。只在内存捕获有限帮助文本，不保存未知输出。

预算：1次目标help，15秒墙钟，64KiB输出总cap，child session由Popen持有并在超时/输出溢出时仅对自有process group终止；不扫描其他PID。此帮助调用不是观察fixture，不宣称Job等价、整树终态或官方模型sender能力。成功需exit0/非截断/帮助确认为settings用法；否则保留失败，不自动冷重试。

即使help成功，也不证明getter的实际数据来源、有效engine、用户所见客户端或模型能力。读取真实用户状态前必须另定精确key白名单/存储来源，不读取或输出登录凭据。
