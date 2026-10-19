# Axiom2 安卓客户端与 SDK

安卓客户端连接电脑上的 Axiom 工作台；模型、项目和任务仍在电脑执行。此目录同时提供原生连接应用和可供其他 Android 应用集成的 WebView SDK。启动图标与原生连接页统一使用透明底金色展翼标志，由 [共享 SVG](../assets/axiom-icon.svg) 生成矢量资源；重新生成命令与各端资源位置见 [品牌资源说明](../assets/README.md)。

## 安装与连接

要求 Android 8.0（API 26）或更新版本、更新的 Android System WebView，以及官方 [Tailscale Android](https://tailscale.com/download/android)。电脑也需安装并登录 Tailscale，手机与电脑处于同一 tailnet，ACL 允许手机访问电脑的 TCP 4317。

将构建产物 `Axiom2-Android.apk` 传到手机并安装。推荐使用「扫码连接」：在电脑本机 Axiom 工作台打开「配置」，页面内的「手机连接」分区会自动生成二维码，无需填写地址或打开弹窗；手机允许摄像头后扫描二维码，即会尝试连接，无需填写 OAuth 凭据。连接成功后，下拉保留最多8条最近成功连接记录；下次点选历史即可连接。

也可点「选择 Tailscale 设备」，或手动输入电脑的 Tailscale 地址，省略端口时使用 `4317`；完整格式为 `http://IP:端口`，IPv6 使用方括号。选中设备仅填入地址，点击「连接工作台」后才开始连接；工作台本身无需访问密钥或登录。版本默认取根 `package.json`，客户端独立构建可显式指定版本；升级需使用更高 versionCode 并保留原签名。工作台根页面按返回键可选择“切换连接”；连接中可取消。

## 扫码连接

- 电脑二维码来自本机 `GET /api/remote` 返回的已监听地址，使用实际端口，优先 IPv4，也可切换 IPv6。后台未就绪或没有 Tailscale 地址时显示原因，不生成占位二维码。进入配置页即读取，每次读取完成后等待5秒刷新，8秒超时后继续重试；离开配置页取消读取。远程工作台不能读取此本机诊断接口。
- 二维码在浏览器本地生成，仅包含 `http://Tailnet字面IP:端口/`，不包含账户、token或密钥。安卓使用固定版本 ZXing 在本地识别，不需要 Google 服务，不拍照存盘、不上传画面，也不启动其他扫码应用。
- 相机权限仅在进入扫码页时申请；拒绝后可重试、打开应用权限设置或返回手动连接。退出扫码、切换后台与旋转时按生命周期释放相机。无后置摄像头的设备仍可使用手动输入。
- 扫码入口拒绝域名、非 Tailnet 地址、额外路径、凭据、查询和片段；扫描结果在返回和连接前各校验一次。仅 HTTP 根地址及显式合法端口被接纳，链路加密由系统 Tailscale VPN 提供。
- 扫到二维码只开始连接，后台状态与 WebSocket 就绪后才保存历史。扫码不能替代 Tailscale 登录、ACL、电脑服务启动或唤醒休眠电脑。旧电脑端页面需更新到包含此功能的构建；仅安装新版 APK 不会更新电脑页面。

## Tailscale 设备发现

设备发现是可选入口，首次需单独配置只读凭据。Android 不读取官方 Tailscale App 的私有状态，也不能继承其登录授权。

1. Tailnet 管理员按 [官方 OAuth client 说明](https://tailscale.com/kb/1215/oauth-clients) 创建 client，只授予 **`devices:core:read`**。不要使用设备注册的 auth key，也不要将普通 API key 当作默认只读凭据。
2. 在安卓连接页点「选择 Tailscale 设备」→「配置设备发现」，填写 Client ID、Client secret。Tailnet 默认 `-`，表示凭据所属 Tailnet；服务端口默认 `4317`，应与电脑实际服务端口一致。
3. 点「保存并加载」。应用直接通过官方 HTTPS API 换取短期 token 并读取设备清单；支持名称／IP 搜索、每页10台、刷新及取消。单次最多读取1000台，超过限制会明确报错。
4. 开启手机系统 Tailscale VPN，并确认手机与凭据属于同一 Tailnet。设备行分别显示云端 Tailscale 状态和该端口的 Axiom HTTP 检查；每台优先检查 IPv4，失败后尝试 IPv6，只检查当前页，不扫描子网或其他端口。
5. 选中设备后点「连接工作台」。管理清单不等于手机 ACL 可达设备；「服务可达」只表示 `/api/status` 检查通过，成功历史仍在工作台 WebSocket 就绪后记录。离线或未通过检查的设备仍可选中后尝试连接。

Client secret 默认隐藏，已保存的 secret 不回填，编辑时留空可保留相同 Client ID 的 secret。配置框禁止截屏和系统自动填充；关闭即清空输入草稿。凭据以 Android Keystore AES-GCM 加密后存于应用私有偏好，短期 token 不持久化，也不传给电脑工作台、WebView 或设备探测请求。应用禁止备份。暂停时取消读取和探测、清空内存清单，返回前台重新读取；已确认保存的操作仍会按顺序完成。

「移除配置」经确认后删除本机加密凭据和密钥，保留手动地址与成功连接历史；它不会撤销 Tailscale 管理端的 OAuth client。若密钥失效或迁移后无法解密，移除配置后重新填写；需要撤销远端授权时在 Tailscale 管理端删除 client。设备发现失败不会阻止手动连接。

电脑当前已有服务通过 `scripts/dev-tailnet.mjs` 接入，保持原服务和任务运行；新版后台默认开启 Tailnet 监听。若电脑重启后继续使用旧开发进程，可在仓库根目录运行 `node scripts/dev-tailnet.mjs`；其目标默认是 `http://127.0.0.1:4317`，检测到新版后台后自动交回监听。

连接失败可点「重新连接」，返回前台也会再次尝试。系统返回键优先关闭工作台弹层／侧栏，再处理页面历史或退出；连接期间按返回可取消。没有设备数、模型或任务的移动端专属限额，工作台原有约束仍适用。

安卓启动默认全屏阅读，会话填满可用屏幕，移除右侧最上／最下等滚动按钮及其空白槽；状态栏与系统导航栏隐藏，可通过边缘滑动临时唤出。右下角「展开」恢复输入与会话操作，收起／展开保留草稿。展开后的输入框固定单行高度、14px文字，长行横向滚动而不自动折行；下方统计与工具图标为连续单排，图标16px，窄屏可横向滑动访问。文件入口支持浏览电脑项目目录、选择电脑文件／文件夹，或使用「手机文件」上传。任务不会因关闭手机应用而停止。

手机浏览器也可直接打开同一地址。内网直连随电脑后台自动运行，无需配置或启停操作。旧开发服务尚未加载新增业务接口时，相关功能需在下一次正常重启后台后生效。

## 连接检查

- 设备列表授权失败：检查 OAuth client 的 ID／secret 和 `devices:core:read` 权限；403 检查权限，429 等待后手动刷新。设备清单需要访问 `api.tailscale.com`，不能仅凭 VPN 已连接判断管理 API 可用。
- 列表已加载但服务未达：检查手机 VPN 所属 Tailnet、ACL、电脑防火墙、休眠和服务端口；云端在线不代表 Axiom 已启动。
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
  -BuildTools 'C:\Android\Sdk\build-tools\35.0.0'
```

脚本使用现有 JDK、Android SDK 35 的 `aapt2`、D8、zipalign、apksigner，不下载或安装依赖。扫码依赖 `libs/core-3.5.3.jar` 随源码固定，PowerShell、Gradle和测试构建均核对SHA-256；上游许可保留在APK的 `assets/ZXING-LICENSE.txt`，不加入WebView SDK AAR。APK 不内置开发服务地址，可扫码、手动输入或从已授权的设备清单选择，只有连接成功才保存历史。`-OutputDirectory` 可指定独立输出目录，默认是仓库 `artifacts/android`。Java 支持 `--release 8`，本机验证环境为 JetBrains JBR 25；Android 编译／目标 API 为 35，最低 API 为 26。

输出前默认从根 `package.json` 读取正式三段版本；仅发布客户端时，PowerShell 可传 `-ClientVersion 0.4.10`，Gradle 可传 `-PclientVersion=0.4.10`，不必修改后台版本。两种构建均按 `major × 1,000,000 + minor × 1,000 + patch` 生成 versionCode，minor／patch不超过999，且编码必须大于旧版404、不超过Android上限。正式交付固定源码提交，显式版本须与客户端发布版本一致并高于已安装版本；构建候选包不等于已发布。

输出：

| 文件 | 用途 |
| --- | --- |
| `Axiom2-Android.apk` | 可安装应用，applicationId 为 `com.axiom2.android` |
| `axiom2-android-sdk.aar` | WebView 客户端 SDK，无 Tailscale VPN 实现 |
| `SHA256SUMS.txt` | APK 与 AAR 的 SHA-256 校验值 |

脚本创建并复用 `%LOCALAPPDATA%\Axiom2\android-signing\release.p12`，密码通过当前 Windows 用户的 DPAPI 保存。后续安装升级必须保留原签名；迁移构建电脑需单独、安全地迁移签名材料，不能只复制 DPAPI 密文到其他账户。密钥不进入 APK、仓库或发布目录。

该目录也提供 Gradle 工程，可在 Android Studio 中打开 `app/android`，或使用现有 Gradle 执行 `:app:assembleDebug`／`:sdk:assembleRelease`。没有内置 Gradle wrapper；Gradle 方式需要能获取工程声明的 Android Gradle Plugin。正式 APK 的固定签名由上述 PowerShell 脚本负责。

电脑 Web／服务端须另外更新，安卓 APK 不包含它们。同一版本的后台包与客户端在 [GitHub Releases](https://github.com/cosyeezz/axiom2/releases) 下载。已有 npm 方式安装的电脑可先通过原服务管理入口停止后台，再安装对应 Release 的 `axiom2.tgz`：

```powershell
npm install -g .\axiom2.tgz
axiom2 start
```

安装依赖仍需能访问 npm 仓库。源码方式运行则使用：

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

## 设备发现与扫码专项验证

使用独立包名 `com.axiom2.android.tailnettest`、独立测试签名及假凭据运行；不覆盖正式 App，不访问真实 Tailnet，也不读取生产签名材料。脚本不安装依赖，要求现有 Python、JDK、SDK 35 和 build-tools 35：

```powershell
# 仅编译测试包
python scripts/check-android-tailnet.py --build-only
# 在明确选定的隔离模拟器执行（包含 force-stop 后的第二进程恢复检查）
python scripts/check-android-tailnet.py --serial emulator-5554
```

可用 `--sdk`、`--java-home`、`--build-tools` 和 `--output` 指定工具及独立产物目录。运行前会清除独立测试包数据以恢复首次权限状态，并在所选隔离模拟器标记系统全屏提示已确认，避免遮挡测试截图。GitHub workflow `Android Tailnet checks` 在带模拟后置摄像头的 API 35 模拟器执行，保存逐项结果和原生页面截图。覆盖地址与解析边界、OAuth scope／编码／错误脱敏、IPv6回退、实际HTTP重定向拒绝／限流／取消、Keystore加密／损坏／移除、原生配置与旧请求隔离、实际触摸选择、搜索分页、前后台恢复及跨进程读取；扫码覆盖严格地址、四方向帧解码、真实权限拒绝、相机暂停释放／恢复、取消、重复结果与成功历史时机。构建成功与模拟器运行通过分别记录，不能替代真实 OAuth client、实体手机及跨设备 Tailnet 验收。

电脑端专项在 `app/` 执行 `node --import tsx tests/phone-connect.check.ts`，使用独立Vite端口与模拟诊断响应；可通过 `AXIOM_TEST_BROWSER` 指定已安装的Chrome、`AXIOM_QR_OUTPUT` 指定输出目录。生成实际页面CSS下的二维码截图后，由 `tests-jvm/QrImageCheck.java` 配合固定ZXing JAR独立解码，核对IPv4／IPv6载荷。

## 验证范围

网关专项覆盖无凭据 HTTP／WS、Host／Origin 拒绝、路径规范化、接口恢复及旧配置迁移；浏览器专项访问本机实际 Tailscale 地址，检查 7 个手机视口和桌面、免登录进入、阅读模式、草稿、文件选择、断网恢复。APK 已经 Java 编译、D8 转换、资源打包、对齐及 v2／v3 签名验证。

当前设备发现与扫码实现已在 API 35 隔离模拟器通过全部10组主进程专项及2组进程重启检查，包含真实 Android Keystore、原生 UI、权限拒绝及相机生命周期；设备列表和扫码页截图已检查。[CI 运行及证据](https://github.com/cosyeezz/axiom2/actions/runs/39268623795) 对应生产源码提交 `985cb49`。浏览器16类检查和3张实际二维码截图的独立解码通过。0.4.10／4010 候选 APK 的对齐、非调试配置、既有证书、v2／v3签名及依赖许可证已核对，未公开发布。

当前没有连接实体安卓设备，尚未验证真机安装升级、真实 OAuth 凭据、跨设备 Tailnet、真实软键盘及系统文件选择器。浏览器自动化中的模型为测试夹具，不代表真实供应商调用验收。
