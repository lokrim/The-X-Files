"""Host-only quiet background window; no polling/Metro traffic during the interval."""
import json, pathlib, re, subprocess, sys, time

mode = sys.argv[1]
seconds = {'plain': 35, 'locked': 330, 'timeout': 25}[mode]
path = pathlib.Path(sys.argv[2])

def adb(*args):
    return subprocess.run(['adb', *args], capture_output=True, text=True, timeout=20, check=True).stdout

def snapshot():
    adb('shell', 'am', 'broadcast', '-a', 'com.xfiles.P01B_STATUS', '-n', 'com.xfiles.app/expo.modules.p01b.P01bStatusReceiver')
    raw = adb('logcat', '-d', '-s', 'P01B_NATIVE')
    records = []
    for line in raw.splitlines():
        match = re.search(r'P01B_NATIVE: (\{.*\})', line)
        if match:
            records.append(json.loads(match[1]))
    if not records:
        raise ValueError('NO_OWNED_STATE')
    return records[-1]

try:
    initial = snapshot()
    if not initial['running']:
        raise ValueError('SERVICE_NOT_RUNNING')
    before = time.monotonic()
    adb('shell', 'input', 'keyevent', '3')
    if mode == 'locked':
        adb('shell', 'input', 'keyevent', '26')
    # Deliberately no adb, broadcasts, debugger, logs, or app interaction here.
    time.sleep(seconds)
    power = adb('shell', 'dumpsys', 'power')
    policy = adb('shell', 'dumpsys', 'window', 'policy')
    after = snapshot()
    elapsed = time.monotonic() - before
    adb('shell', 'am', 'broadcast', '-a', 'com.xfiles.P01B_STOP', '-n', 'com.xfiles.app/expo.modules.p01b.P01bStatusReceiver')
    time.sleep(1)
    stopped = snapshot()
    result = {'mode': mode, 'quietSeconds': seconds, 'elapsedSeconds': elapsed,
              'initial': initial, 'after': after, 'stopped': stopped,
              'powerAsleep': 'mWakefulness=Asleep' in power,
              'keyguardShowing': bool(re.search(r'\bshowing=true\b', policy)),
              'keyguardInputRestricted': bool(re.search(r'\binputRestricted=true\b', policy)),
              'progressDelta': after['sequence'] - initial['sequence'],
              'workBytesDelta': after.get('workBytes', 0) - initial.get('workBytes', 0)}
    path.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
except (subprocess.SubprocessError, ValueError, KeyError) as error:
    print(json.dumps({'reason': 'SERVICE_WINDOW_FAILED', 'kind': type(error).__name__}))
    raise SystemExit(1)
