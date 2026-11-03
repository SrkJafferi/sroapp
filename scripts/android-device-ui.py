"""Inspect/test only the SRO app on one authorized physical ADB device.

Uses Android's UIAutomator and screenshot commands. Refuses actions when another
application is foreground. All captures stay in ignored artifacts/android/device.
"""

import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import xml.etree.ElementTree as ET

sys.stdout.reconfigure(encoding='utf-8')

PACKAGE = 'org.sropakistan.clinic'
ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'artifacts/android/device'
SDK = Path(os.environ.get('ANDROID_HOME', Path(os.environ['LOCALAPPDATA']) / 'Android/Sdk'))
ADB = SDK / 'platform-tools/adb.exe'


def adb(*args, binary=False):
    result = subprocess.run(
        [str(ADB), '-d', *args], capture_output=True, timeout=30,
        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0),
    )
    if result.returncode:
        raise RuntimeError(result.stderr.decode('utf-8', errors='replace'))
    return result.stdout if binary else result.stdout.decode('utf-8', errors='replace')


def require_app():
    activities = adb('shell', 'dumpsys', 'activity', 'activities')
    resumed = [line for line in activities.splitlines() if 'mResumedActivity:' in line or 'topResumedActivity=' in line]
    if not any(PACKAGE in line for line in resumed):
        raise RuntimeError('SRO Clinic is not foreground; refusing to interact with another app.')


def hierarchy():
    require_app()
    adb('shell', 'uiautomator', 'dump', '--compressed', '/data/local/tmp/sro-clinic-ui.xml')
    xml = adb('exec-out', 'cat', '/data/local/tmp/sro-clinic-ui.xml')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / 'latest-ui.xml').write_text(xml, encoding='utf-8')
    return ET.fromstring(xml)


def bounds(node):
    values = re.findall(r'-?\d+', node.get('bounds', ''))
    return tuple(map(int, values)) if len(values) == 4 else (0, 0, 0, 0)


def visible_nodes(root):
    size = re.search(r'(\d+)x(\d+)', adb('shell', 'wm', 'size'))
    width, height = map(int, size.groups())
    for node in root.iter('node'):
        x1, y1, x2, y2 = bounds(node)
        if node.get('package') != PACKAGE or x2 <= x1 or y2 <= y1:
            continue
        if 0 <= (x1 + x2) / 2 < width and 0 <= (y1 + y2) / 2 < height:
            yield node


def show(root):
    for node in visible_nodes(root):
        if node.get('text') or node.get('content-desc') or node.get('class') == 'android.widget.EditText':
            print(json.dumps({k: node.get(k, '') for k in ['text', 'content-desc', 'class', 'bounds', 'clickable', 'focused']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['dump', 'tap', 'type', 'back', 'scroll-down', 'scroll-up', 'screenshot'])
    parser.add_argument('value', nargs='?', default='')
    args = parser.parse_args()
    require_app()
    if args.action == 'screenshot':
        name = re.sub(r'[^a-zA-Z0-9_-]', '-', args.value or 'sro-screen')
        OUTPUT.mkdir(parents=True, exist_ok=True)
        path = OUTPUT / f'{name}.png'
        path.write_bytes(adb('exec-out', 'screencap', '-p', binary=True))
        print(path)
        return
    if args.action == 'tap':
        root = hierarchy()
        nodes = list(visible_nodes(root))
        matches = [n for n in nodes if args.value in [n.get('text'), n.get('content-desc')]]
        if not matches:
            matches = [n for n in nodes if args.value in n.get('content-desc', '')]
        actionable = [n for n in matches if n.get('clickable') == 'true']
        if len(actionable) == 1:
            matches = actionable
        if len(matches) != 1:
            show(root)
            raise RuntimeError(f'Expected one visible exact target, found {len(matches)}: {args.value}')
        x1, y1, x2, y2 = bounds(matches[0])
        adb('shell', 'input', 'tap', str((x1 + x2) // 2), str((y1 + y2) // 2))
    elif args.action == 'type':
        # Test inputs are deliberately ASCII. ADB input text has its own escaping.
        if not re.fullmatch(r'[A-Za-z0-9 .,/-]+', args.value):
            raise RuntimeError('Use plain ASCII fictional test input.')
        adb('shell', 'input', 'text', args.value.replace(' ', '%s'))
    elif args.action == 'back':
        adb('shell', 'input', 'keyevent', '4')
    elif args.action.startswith('scroll-'):
        size = re.search(r'(\d+)x(\d+)', adb('shell', 'wm', 'size'))
        width, height = map(int, size.groups())
        upper, lower = int(height * .30), int(height * .77)
        start, end = (lower, upper) if args.action == 'scroll-down' else (upper, lower)
        adb('shell', 'input', 'swipe', str(width // 2), str(start), str(width // 2), str(end), '350')
    show(hierarchy())


if __name__ == '__main__':
    main()
