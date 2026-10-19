# Axiom2 安卓客户端与 SDK

安卓客户端连接电脑上的 Axiom 工作台；模型、项目和任务仍在电脑执行。此目录同时提供原生连接应用和可供其他 Android 应用集成的 WebView SDK。启动图标与原生连接页统一使用透明底金色展翼标志，由 [共享 SVG](../assets/axiom-icon.svg) 生成矢量资源；重新生成命令与各端资源位置见 [品牌资源说明](../assets/README.md)。

## 安装与连接

要求 Android 8.0（API 26）或更新版本、更新的 Android System WebView，以及官方 [Tailscale Android](https://tailscale.com/download/android)。电脑也需安装并登录 Tailscale，手机与电脑处于同一 tailnet，ACL 允许手机访问电脑的 TCP 4317。

将构建产物 `Axiom2-Android.apk` 传到手机并安装。启动后输入电脑的 Tailscale 地址，例如 `100.106.9.14`，省略端口时使用 `4317`；也可输入完整 `http://IP:端口`。下拉保留最多8条最近成功连接记录，选择后连接，无访问密钥或登录步骤。版本为 `0.4.1-connect`（404），可覆盖此前同签名版本。工作台根页面按返回键可选择“切换连接”；连接中可取消。Android 不读取其他应用的私有数据，当前不提供 Tailscale 在线设备发现。

电脑当前已有服务通过 `scripts/dev-tailnet.mjs` 接入，保持原服务和任务运行；新版后台默认开启 Tailnet 监听。若电脑重启后继续使用旧开发进程，可在仓库根目录运行 `node scripts/dev-tailnet.mjs`；其目标默认是 `http://127.0.0.1:4317`，检测到新版后台后自动交回监听。

连接失败可点「重新连接」，返回前台也会再次尝试。系统返回键优先关闭工作台弹层／侧栏，再处理页面历史或退出；连接期间按返回可取消。没有设备数、模型或任务的移动端专属限额，工作台原有约束仍适用。

安卓启动默认全屏阅读，会话填满可用屏幕，移除右侧最上／最下等滚动按钮及其空白槽；状态栏与系统导航栏隐藏，可通过边缘滑动临时唤出。右下角「展开」恢复输入与会话操作，收起／展开保留草稿。展开后的输入框固定单行高度、14px文字，长行横向滚动而不自动折行；下方统计与工具图标为连续单排，图标16px，窄屏可横向滑动访问。文件入口支持浏览电脑项目目录、选择电脑文件／文件夹，或使用「手机文件」上传。任务不会因关闭手机应用而停止。

手机浏览器也可直接打开同一地址。内网直连随电脑后台自动运行，无需配置或启停操作。旧开发服务尚未加载新增业务接口时，相关功能需在下一次正常重启后台后生效。

## 连接检查

- Tailscale 未就绪：确认电脑 Tailscale 已登录并在线；后台每 5 秒重新发现接口，恢复后自动监听。
- 连接超时：确认手机的系统 Tailscale VPN 已开启，电脑没有休眠，tailnet ACL 和电脑防火墙允许访问业务服务的 TCP 端口（默认 4317）。只需允许 Tailscale 网络，不需要公网映射。
- 页面或 WebSocket 未就绪：确认电脑运行的是包含本功能的新版后台，更新 Android System WebView 后重试。旧版 Release 的后台不一定包含此功能。
- 网络切换／从后台恢复：工作台会重连并恢复订阅，不重复发送先前命令；电脑关闭时需先在电脑启动服务。

地址默认使用 HTTP，链路由 Tailscale VPN 加密。网关只监听 Tailscale 接口，端口与业务服务一致，回环工作台继续独立运行。连接不使用独立配置文件。

## 构建 APK 与 AAR

从仓库根目录运行 Windows PowerShell：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-android.ps1 `
  -JavaHome 'C:\path\to\jdk' `
  -AndroidPlatform 'C:\Android\Sdk\platforms\android-35' `
  -BuildTools 'C:\Android\Sdk\build-tools\35.0.0' `
  -DevServerUrl 'http://100.106.9.14:4317'
```

脚本使用现有 JDK、Android SDK 35 的 `aapt2`、D8、zipalign、apksigner，不下载或安装依赖。APK 不再内置开发服务地址，首次使用由用户输入，只有连接成功才保存历史。`-OutputDirectory` 可指定独立输出目录，默认是仓库 `artifacts/android`。Java 支持 `--release 8`，本机验证环境为 JetBrains JBR 25；Android 编译／目标 API 为 35，最低 API 为 26。

输出：

| 文件 | 用途 |
| --- | --- |
| `Axiom2-Android.apk` | 可安装应用，applicationId 为 `com.axiom2.android` |
| `axiom2-android-sdk.aar` | WebView 客户端 SDK，无 Tailscale VPN 实现 |
| `SHA256SUMS.txt` | APK 与 AAR 的 SHA-256 校验值 |

脚本创建并复用 `%LOCALAPPDATA%\Axiom2\android-signing\release.p12`，密码通过当前 Windows 用户的 DPAPI 保存。后续安装升级必须保留原签名；迁移构建电脑需单独、安全地迁移签名材料，不能只复制 DPAPI 密文到其他账户。密钥不进入 APK、仓库或发布目录。

该目录也提供 Gradle 工程，可在 Android Studio 中打开 `app/android`，或使用现有 Gradle 执行 `:app:assembleDebug`／`:sdk:assembleRelease`。没有内置 Gradle wrapper；Gradle 方式需要能获取工程声明的 Android Gradle Plugin。正式 APK 的固定签名由上述 PowerShell 脚本负责。

电脑 Web／服务端须另外构建并重启，安卓 APK 不包含它们。本次配套后台包为仓库 `artifacts/cosyeezz-axiom2-0.4.1.tgz`；已有 npm 方式安装的电脑可先通过原服务管理入口停止后台，再在仓库根目录执行：

```powershell
npm install -g .\artifacts\cosyeezz-axiom2-0.4.1.tgz
axiom2 start
```

此包是当前工作区的本地构建，安装依赖仍需能访问 npm 仓库。源码方式运行则使用：

```powershell
cd app
npm run build
npm start
```

如果已有后台占用端口，先用原来的服务管理入口停止，再启动新版。源码运行和 npm 安装运行不要同时占用同一端口／数据目录。

## 集成 AAR

将 `axiom2-android-sdk.aar` 放入应用 `libs/`，添加依赖：

```groovy
dependencies {
    implementation files('libs/axiom2-android-sdk.aar')
}
android {
    compileSdk 35
    defaultConfig { minSdk 26 }
    compileOptions {
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }
}
```

宿主 Manifest 需有网络权限，并允许 Tailnet HTTP 地址（若宿主使用 networkSecurityConfig，也需允许对应地址的明文 HTTP）：

```xml
<uses-permission android:name="android.permission.INTERNET" />
<application android:usesCleartextTraffic="true" ... />
```

在主线程创建并操作 SDK，提供监听器：

```java
import com.axiom.sdk.AxiomWebView;

AxiomWebView web = new AxiomWebView(activity);
container.addView(web);
web.setListener(new AxiomWebView.Listener() {
    public void onReady() {
        // 页面与业务 WebSocket 已就绪，可隐藏连接状态。
    }
    public void onError(String message) {
        // 显示错误并允许调用 connect() 重试。
    }
    public void onExternalLink(android.net.Uri uri) {
        // 按宿主策略在外部浏览器打开 HTTP(S) 链接。
    }
    public void onRendererGone() {
        // 从容器移除并 destroy() 该 WebView，再创建新实例。
    }
});
web.connect("http://100.106.9.14:4317");
```

宿主须转发 `Activity.onResume()`／`onPause()` 到 `web.onResume()`／`web.onPause()`，销毁时先从容器移除再调用 `web.destroy()`。`cancelConnect()` 使当前连接回调失效并释放请求；后续可再次 `connect()`。SDK 直接检查后台并加载页面，不进行应用认证或保存连接凭据。

文件上传需宿主设置 `WebChromeClient.onShowFileChooser`，调用系统文件选择器并将结果传回 `ValueCallback<Uri[]>`；取消或销毁时必须回传 `null`。示例见 `app/src/main/java/com/axiom2/android/MainActivity.java`。宿主还负责系统返回、窗口安全区和键盘避让。SDK 与应用共享系统 WebView Cookie 存储；不要在运行中全局清空其他 WebView 的 Cookie。

## 验证范围

网关专项覆盖无凭据 HTTP／WS、Host／Origin 拒绝、路径规范化、接口恢复及旧配置迁移；浏览器专项访问本机实际 Tailscale 地址，检查 7 个手机视口和桌面、免登录进入、阅读模式、草稿、文件选择、断网恢复。APK 已经 Java 编译、D8 转换、资源打包、对齐及 v2／v3 签名验证。

当前没有连接实体安卓设备，尚未验证真机安装、跨设备 Tailnet、真实软键盘及系统文件选择器。浏览器自动化中的模型为测试夹具，不代表真实供应商调用验收。
