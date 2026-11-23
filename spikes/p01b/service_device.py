"""Host-only adb helpers. No raw log, exception, or unrelated UI output."""
import json
import re
import subprocess
import time


def adb(*args):
    return subprocess.run(['adb', *args], capture_output=True, text=True, timeout=20, check=True).stdout


def physical_device():
    lines = adb('devices', '-l').splitlines()[1:]
    devices = [line.split() for line in lines if len(line.split()) >= 2]
    if len(devices) != 1 or devices[0][1] != 'device' or devices[0][0].startswith('emulator-'):
        raise ValueError('PHYSICAL_PHONE_REQUIRED')
    if adb('shell', 'getprop', 'ro.kernel.qemu').strip() == '1':
        raise ValueError('PHYSICAL_PHONE_REQUIRED')
    package = adb('shell', 'dumpsys', 'package', 'com.xfiles.app')
    if not re.search(r'(?:pkgFlags|flags)=\[[^\]]*\bDEBUGGABLE\b', package):
        raise ValueError('DEVELOPMENT_BUILD_REQUIRED')
    memory = re.search(r'^MemTotal:\s+(\d+)\s+kB', adb('shell', 'cat', '/proc/meminfo'), re.MULTILINE)
    if not memory:
        raise ValueError('PHONE_RAM_UNAVAILABLE')
    return {'model': adb('shell', 'getprop', 'ro.product.model').strip(),
            'android': adb('shell', 'getprop', 'ro.build.version.release').strip(),
            'api': adb('shell', 'getprop', 'ro.build.version.sdk').strip(),
            'osBuild': adb('shell', 'getprop', 'ro.build.type').strip(),
            'ramKiB': int(memory[1]),
            'appVariant': 'debug-development'}


def snapshot(stop=None):
    request = time.monotonic_ns()
    action = 'com.xfiles.P01B_STOP' if stop else 'com.xfiles.P01B_STATUS'
    args = ['shell', 'am', 'broadcast', '-a', action, '-n',
            'com.xfiles.app/expo.modules.p01b.P01bStatusReceiver', '--el', 'requestId', str(request)]
    if stop:
        args += ['--el', 'generation', str(stop['generation']), '--el',
                 'processStartedElapsedMs', str(stop['processStartedElapsedMs'])]
    adb(*args)
    for line in reversed(adb('logcat', '-d', '-s', 'P01B_NATIVE').splitlines()):
        match = re.search(r'P01B_NATIVE: (\{.*\})', line)
        if match:
            item = json.loads(match[1])
            if item.get('requestId') == request:
                del item['requestId']
                return item
    raise ValueError('OWNED_STATE_NOT_FOUND')


def stop_and_confirm(initial):
    state = snapshot(stop=initial)
    for _ in range(4):
        if any(state.get(k) != initial.get(k) for k in ('generation', 'processStartedElapsedMs')):
            return state, False
        if not state.get('running') and state.get('cleanupComplete') and state.get('activeNotifications') == 0:
            return state, True
        time.sleep(0.25)
        state = snapshot()
    return state, False
