# 本地路径选择 UI

运行时页面填写电脑上的文件或目录路径时，统一使用 `app/src/client/FilePicker.tsx`：

- `PathInput`：受控文本输入＋系统选择按钮。`request.kind` 指定 `file`、`folder` 或 `mixed`，取消选择保留原值。
- `FilePickerButton`：工作空间、附件等已有业务生命周期的共用按钮。支持忙碌状态、图标按钮及取消操作；业务仍负责草稿归属、授权和提交。
- `useFilePicker`：需要自定义回填的入口使用此 hook；统一阻止重复请求、处理错误、卸载时中止请求并忽略迟到结果。
- `JsonPathInput`：JSON 配置使用的路径编辑器。将光标放在字符串值内，再选文件或目录，整体替换该值并通过 `JSON.stringify` 转义；不替换属性名，也不改动其他配置及其敏感值占位符。

```tsx
<PathInput
  id="project-directory"
  value={directory}
  onChange={setDirectory}
  request={{ purpose: "path", kind: "folder", multiple: false }}
  onError={setError}
/>
```

`PathInput` 继续支持手输，适用于路径与 npm 来源共用的输入。URL、包名、npm 入口名称、Chrome profile ID 不属于文件系统路径。只读路径的复制／打开由 `LocalPath.tsx` 处理。

所有选择通过 `OpenFileDialog.ts` 路由：本机使用系统选择窗口，远程设备使用 `mobile/remote-files.ts` 浏览运行服务的电脑。远程浏览器的目录地址栏就是选择器内部导航，不再嵌套另一个选择器。

普通配置使用 `purpose: "path"`，不需要会话 scope，也不会注册附件。工作空间、技能来源与附件分别保留专用 purpose。服务端所有原生选择入口共享 `OpenDialog`，统一文件／目录校验、单选限制、并发互斥、超时和取消。

技能安装及托管技能更新允许目录或 Markdown 文件；外部技能更新必须选择包含 `SKILL.md` 的目录。MCP 配置中的 `command`、`cwd`、`args` 和 `env` 路径均可通过 JSON 编辑器填写。

相关验证（在 `app` 目录执行）：

```sh
npm run build
./node_modules/.bin/tsx --test tests/path-picker.test.ts
./node_modules/.bin/tsx tests/path-picker.check.ts
./node_modules/.bin/tsx tests/resources.check.ts
./node_modules/.bin/tsx tests/workspace-picker.check.ts
./node_modules/.bin/tsx tests/attachment-paths.check.ts
./node_modules/.bin/tsx tests/upload-icons.check.ts
```

浏览器检查可通过 `AXIOM_TEST_BROWSER` 指定已安装的 Chrome。`path-picker.check.ts` 复用构建后的客户端，并使用本机可绑定的非回环 IPv4 地址检查远程模式。macOS 上设置测试 `TMPDIR` 时应使用规范化后的真实路径，避免 `/tmp` 与 `/private/tmp` 的路径比较差异。
