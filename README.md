# Axiom2

基于 pi 的多工作空间 Agent 工作台。当前已保存原始设计基线，并建立逐字节一致的开发副本；尚未接入真实 Agent 服务。

## 目录

- `ui/`：用户维护的设计源，开发时只读。
- `app/`：设计的完整开发副本，后续在这里实现真实功能。
- `docs/ui-sync.md`：已采用的设计版本与增量同步流程。
- 根目录 ZIP：保留的原始交付包。

工作台入口：`app/coding-agent-v2-before-subagent-modal-v2.html`。
配置页面：`app/settings.html`、`app/model-config.html`。
其他 HTML、检查脚本和图片完整保留，是否使用以设计交付说明与实际页面引用为准。

## 本地预览（原型）

在项目目录执行：

```sh
python -m http.server 5173 --bind 127.0.0.1 --directory app
```

打开 http://127.0.0.1:5173/coding-agent-v2-before-subagent-modal-v2.html 。
这是原型预览，模拟输出和浏览器存储不代表已接入 pi。后续开发需保持设计外观和交互，并隔离各区域的状态订阅。

## 设计变更

用户更新 `ui/` 后先单独提交设计，再根据 Git 差异更新实现。禁止使用新版设计直接覆盖整个 `app/`。详见 `docs/ui-sync.md`。

Git 项目名称为 Axiom2；当前仅初始化本地仓库，未配置远端。
