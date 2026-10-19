"""Exercise the exact signed APK through Android's native accessibility surface."""
import hashlib
import json
import os
import re
import subprocess
import sys
import tarfile
import time
import traceback
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path, PurePosixPath

apk = Path(sys.argv[1]).resolve()
out = Path(sys.argv[2]).resolve()
manifest = None
tag = version = version_code = None
out.mkdir(parents=True, exist_ok=True)
package = 'com.axiom2.android'
checks = []
expected_checks = [
    'exact-signed-apk-installed-version-and-code-not-debuggable',
    'native-launch-and-portrait-controls',
    'unreachable-server-error-and-retry',
    'same-tag-backend-http-initial-websocket-and-visible-workbench',
    'landscape-workbench-survives',
    'background-foreground-resume',
    'native-back-and-switch-connection',
    'successful-address-persists-and-reconnects-after-process-restart',
    'signed-replacement-install-preserves-connection',
]
backend_evidence = None
origin = 'http://127.0.0.1:4319'
installed_root = cli = None

def backend_status(name):
    result = subprocess.run(['node', str(cli), 'status', '--json'], cwd=os.environ['AXIOM_RELEASE_TEST_ROOT'], capture_output=True, text=True, timeout=45)
    (out / (name + '.stdout.log')).write_text(result.stdout, encoding='utf-8')
    (out / (name + '.stderr.log')).write_text(result.stderr, encoding='utf-8')
    assert result.returncode == 0, 'Backend status command failed: ' + str(result.returncode)
    status = json.loads(result.stdout)
    assert status['state'] == 'running', status
    assert status['version'] == version, status
    assert status['url'].rstrip('/') == origin, status
    (out / (name + '.json')).write_text(json.dumps(status, indent=2) + '\n', encoding='utf-8')
    return status

def verify_backend():
    archive = out / 'axiom2.tgz'
    assert hashlib.sha256(archive.read_bytes()).hexdigest() == manifest['backend_sha256']
    status = backend_status('backend-status-before')
    with urllib.request.urlopen(origin + '/api/status', timeout=15) as response:
        assert response.status == 200 and response.url == origin + '/api/status'
        assert 'application/json' in response.headers.get('Content-Type', '')
        health = json.load(response)
        assert health.get('connected') is True and health.get('stage') == 1, health
    rows = []
    with tarfile.open(archive, 'r:gz') as tar:
        for path in ['package.json', 'app/package.json']:
            assert json.load(tar.extractfile('package/' + path))['version'] == version
            assert json.loads((installed_root / path).read_text(encoding='utf-8'))['version'] == version
        prefix = 'package/app/dist/client/'
        index_bytes = tar.extractfile(prefix + 'index.html').read()
        for member in tar.getmembers():
            if not member.isfile() or not member.name.startswith(prefix):
                continue
            relative = member.name[len(prefix):]
            assert relative and '..' not in PurePosixPath(relative).parts and not relative.startswith('/')
            expected = tar.extractfile(member).read()
            assert (installed_root / 'app/dist/client' / relative).read_bytes() == expected, relative
            # The production server serves index.html for all HTML routes.
            response_expected = index_bytes if relative.endswith('.html') else expected
            url = origin + ('/' if relative == 'index.html' else '/' + urllib.parse.quote(relative, safe='/'))
            with urllib.request.urlopen(url, timeout=15) as response:
                actual = response.read()
                mime = response.headers.get('Content-Type', '')
                assert response.status == 200 and response.url == url, url
                assert actual == response_expected, 'Served bytes differ: ' + relative
                if relative.endswith('.html'):
                    assert 'text/html' in mime, (relative, mime)
                rows.append({'path': relative, 'url': url, 'status': response.status, 'mime': mime, 'sha256': hashlib.sha256(actual).hexdigest(), 'matches_package': True})
    assert len(rows) > 1 and any(row['path'] == 'index.html' for row in rows)
    result = {'runtime_version': status['version'], 'pid': status['pid'], 'origin': origin, 'backend_sha256': manifest['backend_sha256'], 'assets': rows}
    (out / 'asset-verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    return result

def adb(*args, binary=False):
    result = subprocess.run(['adb', *args], capture_output=True, timeout=45, check=True)
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')

def tree():
    last_error = None
    for _ in range(3):
        try:
            # UIAutomator may report no idle root during the first system overlay.
            # Remove the prior dump so a failed sample can never reuse stale UI.
            adb('shell', 'rm', '-f', '/sdcard/axiom-window.xml')
            adb('shell', 'uiautomator', 'dump', '/sdcard/axiom-window.xml')
            value = adb('shell', 'cat', '/sdcard/axiom-window.xml')
            root = ET.fromstring(value)
            (out / 'latest-window.xml').write_text(value, encoding='utf-8')
            return root
        except (subprocess.CalledProcessError, ET.ParseError) as error:
            last_error = error
            time.sleep(.5)
    raise last_error

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

def node(root, text=None, cls=None, desc=None):
    return next((n for n in root.iter('node') if (text is None or n.get('text') == text) and (cls is None or n.get('class') == cls) and (desc is None or n.get('content-desc') == desc)), None)

def web_named(root, *names):
    web = node(root, cls='android.webkit.WebView')
    if web is None or node(root, cls='android.widget.AutoCompleteTextView') is not None:
        return None
    return next((n for n in web.iter('node') if n.get('text') in names or n.get('content-desc') in names), None)

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
    return web if (web is not None and node(root, text='连接工作台') is None
                   and node(root, cls='android.widget.AutoCompleteTextView') is None
                   and web_named(root, '新对话') is not None
                   and web_named(root, '收起工作台，只看对话') is not None) else None

def expand_connected(label, screenshot_name):
    # Each Android navigation begins in reading mode. Require its real control,
    # then expand and verify rendered workbench controls without DOM injection.
    control = wait(lambda root: web_named(root, '展开工作台', '展开'), label + ' reading mode', seconds=80)
    screenshot(screenshot_name)
    tap(control)
    return wait(ready, label + ' expanded workbench', seconds=80)

def launch():
    adb('shell', 'am', 'start', '-W', '-n', package + '/.MainActivity')

success = False
device_touched = False
failure = None
cleanup_errors = []
phase = 'preflight'
try:
    manifest = json.loads(Path(sys.argv[3]).read_text(encoding='utf-8'))
    tag = manifest['release_tag']
    assert re.fullmatch(r'v(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', tag), tag
    version = tag[1:]
    major, minor, patch = map(int, version.split('.'))
    version_code = major * 1000000 + minor * 1000 + patch
    assert minor <= 999 and patch <= 999 and 404 < version_code <= 2100000000
    installed_root = Path(os.environ['AXIOM_RELEASE_TEST_ROOT']) / 'install/node_modules/@cosyeezz/axiom2'
    cli = installed_root / 'bin/axiom2.mjs'
    assert hashlib.sha256(apk.read_bytes()).hexdigest() == manifest['apk_sha256']
    backend_evidence = verify_backend()
    phase = 'runtime'
    adb('wait-for-device')
    device_touched = True
    adb('logcat', '-c')
    adb('reverse', 'tcp:4319', 'tcp:4319')
    installed = adb('install', '-r', str(apk))
    assert 'Success' in installed, installed
    details = adb('shell', 'dumpsys', 'package', package)
    (out / 'package.txt').write_text(details, encoding='utf-8')
    assert re.search(r'\bversionName=' + re.escape(version) + r'(?:\s|$)', details), details
    assert re.search(r'\bversionCode=' + str(version_code) + r'(?:\s|$)', details), details
    assert not re.search(r'(?:pkgFlags|flags)=\[[^\]]*DEBUGGABLE', details)
    checks.append('exact-signed-apk-installed-version-and-code-not-debuggable')
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
    expand_connected('same-tag backend HTTP and initial WebSocket ready', '03-reading-mode')
    width, height = screenshot('03-workbench-portrait')
    assert height > width, (width, height)
    checks.append('same-tag-backend-http-initial-websocket-and-visible-workbench')
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
    expand_connected('persisted address reconnect', '06-reopened-reading-mode')
    screenshot('06-reopened-connected')
    checks.append('successful-address-persists-and-reconnects-after-process-restart')
    # Install the same signed APK over the existing application; user data must remain.
    adb('shell', 'am', 'force-stop', package)
    assert 'Success' in adb('install', '-r', str(apk))
    launch()
    saved = wait(lambda root: node(root, cls='android.widget.AutoCompleteTextView'), 'replacement installation preserved history')
    assert saved.get('text') == 'http://127.0.0.1:4319', saved.attrib
    click('连接工作台')
    expand_connected('replacement installation reconnect', '07-replacement-reading-mode')
    screenshot('07-replacement-connected')
    checks.append('signed-replacement-install-preserves-connection')
    backend_status('backend-status-after')
    assert hashlib.sha256(apk.read_bytes()).hexdigest() == manifest['apk_sha256']
    assert checks == expected_checks
    success = True
except BaseException as error:
    failure = {'phase': phase, 'type': type(error).__name__, 'message': str(error)}
    (out / 'failure.traceback.txt').write_text(traceback.format_exc(), encoding='utf-8')
finally:
    if device_touched:
        if not success:
            try:
                screenshot('failure')
            except Exception as error:
                cleanup_errors.append({'operation': 'failure-screenshot', 'error': str(error)})
        try:
            (out / 'logcat.txt').write_text(adb('logcat', '-d', '-v', 'threadtime'), encoding='utf-8')
        except Exception as error:
            cleanup_errors.append({'operation': 'logcat', 'error': str(error)})
        # Diagnostics failure must never skip cleanup of this test's application.
        try:
            adb('shell', 'am', 'force-stop', package)
        except Exception as error:
            cleanup_errors.append({'operation': 'force-stop', 'error': str(error)})
    apk_hash = None
    try:
        if apk.is_file():
            apk_hash = hashlib.sha256(apk.read_bytes()).hexdigest()
    except Exception as error:
        cleanup_errors.append({'operation': 'final-apk-hash', 'error': str(error)})
    success = success and failure is None and not cleanup_errors
    report = {'success': success, 'release': manifest, 'validation_commit': os.environ.get('GITHUB_SHA'), 'version': version, 'version_code': version_code, 'apk_sha256': apk_hash, 'backend': backend_evidence, 'checks': checks, 'check_status': [{'id': name, 'status': 'passed' if name in checks else 'not-completed'} for name in expected_checks], 'failure': failure, 'cleanup_errors': cleanup_errors, 'device_touched': device_touched, 'scope': 'Android API35 emulator, exact production signed APK and same-tag backend over adb reverse; initial native HTTP/WS readiness and visible workbench, not a model response or sustained heartbeat test. Same-APK replacement is not cross-version upgrade acceptance. No physical device or cross-device Tailscale claim.'}
    (out / 'result.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))
sys.exit(0 if success else 1)
