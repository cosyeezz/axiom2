#!/usr/bin/env python3
"""Build an isolated, self-instrumenting Android test app; never install the production package."""
import argparse
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = 'com.axiom2.android.tailnettest'

def run(args, **kwargs):
    result = subprocess.run([str(x) for x in args], check=True, text=True, **kwargs)
    return result.stdout if kwargs.get('capture_output') else None

def archive(source, destination):
    with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as out:
        for file in source.rglob('*'):
            if file.is_file():
                out.write(file, file.relative_to(source).as_posix())

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sdk', default=os.environ.get('ANDROID_SDK_ROOT', os.environ.get('ANDROID_HOME', 'F:/Tools/Android')))
    parser.add_argument('--java-home', default=os.environ.get('JAVA_HOME', 'C:/Program Files/JetBrains/IntelliJ IDEA 2026.1.1/jbr'))
    parser.add_argument('--build-tools')
    parser.add_argument('--output', default=str(ROOT / 'artifacts/android-tailnet/instrumentation'))
    parser.add_argument('--serial')
    parser.add_argument('--build-only', action='store_true')
    args = parser.parse_args()
    if not args.build_only and (not args.serial or not args.serial.startswith('emulator-')):
        parser.error('Use --build-only or explicitly select an isolated emulator with --serial emulator-NNNN')
    sdk = Path(args.sdk)
    tools = Path(args.build_tools) if args.build_tools else next((sdk / 'build-tools' / v for v in ['35.0.0', 'android-15', '35.0.1'] if (sdk / 'build-tools' / v).exists()), None)
    if tools is None:
        raise RuntimeError('Android build-tools 35 required; this script does not install dependencies')
    suffix = '.exe' if os.name == 'nt' else ''
    java = Path(args.java_home) / 'bin' / ('java' + suffix)
    javac = Path(args.java_home) / 'bin' / ('javac' + suffix)
    keytool = Path(args.java_home) / 'bin' / ('keytool' + suffix)
    platform = sdk / 'platforms/android-35/android.jar'
    aapt = tools / ('aapt2' + suffix)
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    for name in ['classes', 'generated', 'dex', 'history-check']:
        target = out / name
        if target.exists():
            shutil.rmtree(target)
        target.mkdir()
    android = ROOT / 'app/android'
    qr_jar = android / 'libs/core-3.5.3.jar'
    if hashlib.sha256(qr_jar.read_bytes()).hexdigest() != '8d8064c1636fdaef7189dd9055c7d59950a8940a12f2293956446ec3c109fd82':
        raise RuntimeError('ZXing dependency checksum mismatch')
    run([javac, '--release', '8', '-encoding', 'UTF-8', '-d', out / 'history-check', android / 'app/src/main/java/com/axiom2/android/ConnectionHistory.java', android / 'app/src/main/java/com/axiom2/android/ConnectionSwipeGesture.java', android / 'tests-jvm/ConnectionHistoryCheck.java'])
    run([java, '-cp', out / 'history-check', 'com.axiom2.android.ConnectionHistoryCheck'])
    namespace = 'http://schemas.android.com/apk/res/android'
    ET.register_namespace('android', namespace)
    manifest = ET.parse(android / 'app/src/main/AndroidManifest.xml')
    manifest.getroot().set('package', PACKAGE)
    application = manifest.getroot().find('application')
    application.set(f'{{{namespace}}}label', 'Axiom Tailnet Tests')
    application.set(f'{{{namespace}}}debuggable', 'true')
    application.find('activity').set(f'{{{namespace}}}name', 'com.axiom2.android.MainActivity')
    ET.SubElement(manifest.getroot(), 'instrumentation', {f'{{{namespace}}}name': 'com.axiom2.android.TailnetInstrumentation', f'{{{namespace}}}targetPackage': PACKAGE})
    manifest.write(out / 'AndroidManifest.xml', encoding='utf-8', xml_declaration=True)
    run([aapt, 'compile', '--dir', android / 'app/src/main/res', '-o', out / 'resources.zip'])
    unsigned = out / 'unsigned.apk'
    run([aapt, 'link', '-o', unsigned, '-I', platform, '--manifest', out / 'AndroidManifest.xml', '--version-name', 'tailnet-test', '--version-code', '1', '--custom-package', 'com.axiom2.android', '--java', out / 'generated', '-A', android / 'app/src/main/assets', out / 'resources.zip'])
    generated = out / 'generated/com/axiom2/android/BuildConfig.java'
    generated.parent.mkdir(parents=True, exist_ok=True)
    generated.write_text('package com.axiom2.android; public final class BuildConfig { public static final boolean DEBUG = true; }', encoding='utf-8')
    sources = [file for base in [android / 'app/src/main/java', android / 'sdk/src/main/java', android / 'tests', out / 'generated'] for file in base.rglob('*.java')]
    run([javac, '--release', '8', '-encoding', 'UTF-8', '-classpath', os.pathsep.join([str(platform), str(qr_jar)]), '-d', out / 'classes', *sources])
    archive(out / 'classes', out / 'tests.jar')
    run([java, '-cp', tools / 'lib/d8.jar', 'com.android.tools.r8.D8', '--min-api', '26', '--lib', platform, '--output', out / 'dex', out / 'tests.jar', qr_jar])
    with zipfile.ZipFile(unsigned, 'a', zipfile.ZIP_DEFLATED) as apk:
        for dex in (out / 'dex').glob('*.dex'):
            apk.write(dex, dex.name)
    run([tools / ('zipalign' + suffix), '-f', '-p', '4', unsigned, out / 'aligned.apk'])
    key = out / 'test-only.p12'
    if not key.exists():
        run([keytool, '-genkeypair', '-keystore', key, '-storetype', 'PKCS12', '-storepass', 'android', '-keypass', 'android', '-alias', 'test-only', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '30', '-dname', 'CN=Axiom isolated test only'])
    apk = out / 'Axiom-Tailnet-TestOnly.apk'
    run([java, '-jar', tools / 'lib/apksigner.jar', 'sign', '--ks', key, '--ks-pass', 'pass:android', '--out', apk, out / 'aligned.apk'])
    run([java, '-jar', tools / 'lib/apksigner.jar', 'verify', '--verbose', apk])
    if args.build_only:
        print(f'Test-only APK compiled: {apk}')
        return
    adb = sdk / 'platform-tools' / ('adb' + suffix)
    if not adb.exists():
        adb = sdk / 'platform-tools-package/platform-tools' / ('adb' + suffix)
    run([adb, '-s', args.serial, 'install', '-r', apk], timeout=60)
    run([adb, '-s', args.serial, 'shell', 'pm', 'clear', PACKAGE], timeout=20)
    # Only the explicitly selected test emulator: dismiss the OS first-use overlay before UI evidence.
    run([adb, '-s', args.serial, 'shell', 'settings', 'put', 'secure', 'immersive_mode_confirmations', 'confirmed'], timeout=20)
    for phase in ['full', 'restart']:
        result = run([adb, '-s', args.serial, 'shell', 'am', 'instrument', '-w', '-r', '-e', 'phase', phase, f'{PACKAGE}/com.axiom2.android.TailnetInstrumentation'], capture_output=True, timeout=180)
        (out / f'{phase}.log').write_text(result, encoding='utf-8')
        print(result)
        if 'AXIOM_TAILNET_PASS=true' not in result or 'INSTRUMENTATION_CODE: -1' not in result:
            subprocess.run([str(adb), '-s', args.serial, 'pull', f'/sdcard/Android/data/{PACKAGE}/files/tailnet-tests', str(out / 'screenshots')], check=False, timeout=30)
            run([adb, '-s', args.serial, 'shell', 'am', 'force-stop', PACKAGE], timeout=20)
            raise RuntimeError(f'Instrumentation {phase} did not explicitly pass')
        run([adb, '-s', args.serial, 'shell', 'am', 'force-stop', PACKAGE])
    run([adb, '-s', args.serial, 'pull', f'/sdcard/Android/data/{PACKAGE}/files/tailnet-tests', out / 'screenshots'])
    print('Android Tailnet instrumentation and process-restart checks passed')

if __name__ == '__main__':
    main()
