"""Exercise the exact signed APK through Android's native accessibility surface."""
import hashlib
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

apk = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
out.mkdir(parents=True, exist_ok=True)
package = 'com.axiom2.android'
checks = []

def adb(*args, binary=False):
    result = subprocess.run(['adb', *args], capture_output=True, timeout=45, check=True)
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')

def tree():
    adb('shell', 'uiautomator', 'dump', '/sdcard/axiom-window.xml')
    value = adb('shell', 'cat', '/sdcard/axiom-window.xml')
    (out / 'latest-window.xml').write_text(value, encoding='utf-8')
    return ET.fromstring(value)

def wait(predicate, label, seconds=55):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = tree()
        # Android's first immersive launch shows a system tutorial above the app.
        if node(last, text='Viewing full screen') is not None:
            acknowledgement = node(last, text='Got it')
            if acknowledgement is not None:
                tap(acknowledgement)
                continue
        result = predicate(last)
        if result is not None and result is not False:
            return result
        time.sleep(.4)
    raise AssertionError('Timed out: ' + label + '\n' + ET.tostring(last, encoding='unicode'))

def node(root, text=None, cls=None):
    return next((n for n in root.iter('node') if (text is None or n.get('text') == text) and (cls is None or n.get('class') == cls)), None)

def tap(n):
    x1, y1, x2, y2 = map(int, re.findall(r'\d+', n.get('bounds')))
    adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))

def click(text):
    tap(wait(lambda root: node(root, text=text), text))

def address(value):
    field = wait(lambda root: node(root, cls='android.widget.AutoCompleteTextView'), 'address input')
    tap(field)
    adb('shell', 'input', 'keyevent', 'KEYCODE_MOVE_END')
    for _ in range(len(field.get('text', '')) + 2):
        adb('shell', 'input', 'keyevent', 'KEYCODE_DEL')
    adb('shell', 'input', 'text', value)
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')

def screenshot(name):
    (out / (name + '.xml')).write_text(ET.tostring(tree(), encoding='unicode'), encoding='utf-8')
    png = adb('exec-out', 'screencap', '-p', binary=True)
    (out / (name + '.png')).write_bytes(png)
    return int.from_bytes(png[16:20], 'big'), int.from_bytes(png[20:24], 'big')

def ready(root):
    web = node(root, cls='android.webkit.WebView')
    # Wait for actual rendered workbench controls, not the initially empty WebView.
    return web if (web is not None and node(root, text='连接工作台') is None
                   and node(root, text='新对话') is not None
                   and node(root, text='已连接本地服务') is not None) else None

def launch():
    adb('shell', 'am', 'start', '-W', '-n', package + '/.MainActivity')

success = False
try:
    adb('wait-for-device')
    adb('logcat', '-c')
    adb('reverse', 'tcp:4319', 'tcp:4319')
    installed = adb('install', '-r', str(apk))
    assert 'Success' in installed, installed
    details = adb('shell', 'dumpsys', 'package', package)
    (out / 'package.txt').write_text(details, encoding='utf-8')
    assert 'versionName=0.4.8' in details and 'versionCode=4008' in details
    assert not re.search(r'(?:pkgFlags|flags)=\[[^\]]*DEBUGGABLE', details)
    checks.append('exact-signed-apk-installed-version-0.4.8-code-4008-not-debuggable')
    launch()
    wait(lambda root: node(root, text='连接工作台'), 'native connection page')
    screenshot('01-native-portrait')
    checks.append('native-launch-and-portrait-controls')
    address('127.0.0.1:4320')
    click('连接工作台')
    wait(lambda root: node(root, text='暂时无法到达电脑。请连接 Tailscale，并核对电脑显示的内网地址。'), 'connection failure and retry')
    screenshot('02-failed-retry')
    checks.append('unreachable-server-error-and-retry')
    address('127.0.0.1:4319')
    click('连接工作台')
    wait(ready, 'real released backend HTTP and WebSocket ready', seconds=80)
    width, height = screenshot('03-workbench-portrait')
    assert height > width, (width, height)
    checks.append('released-0.4.7-backend-http-websocket-ready')
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    time.sleep(2)
    wait(ready, 'landscape workbench')
    width, height = screenshot('04-workbench-landscape')
    assert width > height, (width, height)
    checks.append('landscape-workbench-survives')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    time.sleep(2)
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    launch()
    wait(ready, 'foreground resume')
    checks.append('background-foreground-resume')
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK')
    click('切换连接')
    saved = wait(lambda root: node(root, cls='android.widget.AutoCompleteTextView'), 'switch connection')
    # Switching keeps the current input; normalized history is loaded on restart.
    assert saved.get('text') == '127.0.0.1:4319', saved.attrib
    screenshot('05-switch-connection')
    checks.append('native-back-and-switch-connection')
    adb('shell', 'am', 'force-stop', package)
    launch()
    saved = wait(lambda root: node(root, cls='android.widget.AutoCompleteTextView'), 'persisted connection')
    assert saved.get('text') == 'http://127.0.0.1:4319', saved.attrib
    click('连接工作台')
    wait(ready, 'persisted address reconnect')
    screenshot('06-reopened-connected')
    checks.append('successful-address-persists-and-reconnects-after-process-restart')
    # Install the same signed APK over the existing application; user data must remain.
    adb('shell', 'am', 'force-stop', package)
    assert 'Success' in adb('install', '-r', str(apk))
    launch()
    saved = wait(lambda root: node(root, cls='android.widget.AutoCompleteTextView'), 'replacement installation preserved history')
    assert saved.get('text') == 'http://127.0.0.1:4319', saved.attrib
    checks.append('signed-replacement-install-preserves-connection')
    success = True
finally:
    try:
        if not success:
            try:
                screenshot('failure')
            except Exception as error:
                print('Failure screenshot unavailable:', error)
        (out / 'logcat.txt').write_text(adb('logcat', '-d', '-v', 'threadtime'), encoding='utf-8')
        adb('shell', 'am', 'force-stop', package)
    finally:
        report = {'success': success, 'apk_sha256': hashlib.sha256(apk.read_bytes()).hexdigest(), 'checks': checks, 'scope': 'Android API35 emulator, production signed APK, released backend v0.4.7 over adb reverse; no physical device or cross-device Tailscale claim'}
        (out / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(report, ensure_ascii=False))
