# 确认操作界面

所有模态确认统一使用 `app/src/client/ConfirmDialog.tsx`，不要在业务页再新建确认专用 `<dialog>` 或使用浏览器 `alert/confirm/prompt`。编辑、登录、选择与详情窗口继续使用各自表单；维护清理的范围预览保留内联展示。

## 统一规范

- 桌面常规宽度 432px，距屏幕边缘至少 16px。双主题沿用应用字体、语义色与缩放设置。
- 标题带语义图标；正文说明操作影响，`subject` 标识对象（支持换行），`warning` 单独显示附加风险。路径与长标识符可以换行。
- 底部按钮右对齐：安全取消在前，主操作在最后。按钮用具体动词（如「删除草稿」「停止并退出认证」），不用模糊的「确认」。危险操作传 `danger`，使用红底白字；普通授权、复制或创建使用主题主色。
- 长内容在正文内滚动，标题与底部操作持续可见；窄屏按钮至少 44px 高。遵循 reduced-motion。
- 初始焦点为取消，原生模态管理焦点约束；退出恢复触发元素。Escape、点击取消或完整的背景点击都只取消，不执行业务命令。从正文按下再拖到背景不误关闭。

## 接入与行为

`description` 与 `children` 接受 ReactNode，可放作用域、清单和凭据选项；需要用户先完成勾选/条件时传 `confirmDisabled`。`cancelLabel` 支持「继续运行」「继续编辑」等上下文文案。分支创建等双操作使用 `secondaryAction`。

`onConfirm`（及次操作）可返回 Promise；组件会防止重复提交、阻止处理中取消，在失败时保留窗口并提示错误，允许重试。不要用 `void somePromise()` 代替 Promise 返回值，除非调用方已经管理进度与错误，并确实需要先关闭复核界面。

原有业务快照、revision/version 校验、清理范围与授权检查仍由调用方负责，不能因样式统一删减。取消后不得提交命令；删除模型草稿只修改本页草稿，不能描述为立即删除服务端模型；保存删除模型不退出供应商授权，供应商删除/主动退出认证才显示相应授权风险。Pi 安装确认应展示已核对快照中的安装位置，并保留冻结的版本/token；后台轮询可以使确认失效，但不能偷偷替换用户已核对的目标。

连续确认须避免旧 `onClose` 清空新的 decision。例如：

```tsx
<ConfirmDialog key={decision.title}
  title={decision.title} description={decision.text}
  confirmLabel={decision.confirmLabel} danger={decision.danger}
  onClose={() => setDecision(current => current === decision ? null : current)}
  onConfirm={() => { setDecision(null); decision.proceed(); }} />
```

不同复核阶段使用不同 key，确保下一阶段重新把焦点置于取消。

## 内联维护确认

OpenCLI、代理内核、REA、RTK 以及桌面清理/卸载保留原有内联确认与范围信息，容器添加 `inline-confirmation`。取消在左、执行在右，危险执行按钮添加 `confirm-danger`。保留共享安装提示、残留路径、手工退出确认、同意勾选和过期快照禁用。

共享样式在 `styles/confirmation-inline.css`，设置页由 `page-overrides.css` 引入，独立桌面入口由 `Connect.tsx` 引入；危险按钮规则须高于浅色主题的普通按钮覆盖。

## 验证

在 `app` 目录执行：

```powershell
npm run build
npx --no-install tsc --noEmit
npx --no-install tsx --test tests/native-dialogs.test.ts
npx --no-install tsx tests/confirmation-design.check.ts
npx --no-install tsx tests/confirm-dialog.check.ts
npx --no-install tsx tests/model-confirmations.check.ts
npx --no-install tsx tests/desktop-confirmations.check.ts
npx --no-install tsx tests/pi-updates.check.ts
```

专项设计测试使用隔离 React fixture，不操作用户配置或文件，覆盖深浅主题、320/390/1440px、窄高长正文、焦点、取消/背景、拖出保护、异步防重、失败重试、双操作和连续确认。产物默认写入 `app/test-results/confirmation-design`；`AXIOM_TEST_ARTIFACTS` 可覆盖。若 Playwright 默认浏览器未安装，可通过 `AXIOM_TEST_BROWSER` 指定现有兼容 Chromium 可执行文件。

`tests/model-confirmations.check.ts` 在真实模型页面验证已保存/未发布模型的删除文案、保存前磁盘不变，以及供应商删除的异步连续复核；数据根和认证文件均隔离。

实际桌面页面另由 `tests/desktop-confirmations.check.ts` 与 `tests/pi-updates.check.ts` 通过严格合成 IPC 验证，未知操作应报错，不得调用真实安装/卸载 helper。并行 Vite 实例除随机端口外，还须使用独立 `cacheDir`。桌面 fixture 禁用 HMR 与文件监听，避免共享工作区写入导致页面自动重载、重置测试状态；回归前后仍应核对源码快照，有相关变更时需重跑。资源回归的确认框截图应等待 `getAnimations().finished`，并断言不透明度与视口边界；仅等 `visible` 会误拍入场动画的透明首帧。
