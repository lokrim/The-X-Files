"""Record only the development service's aggregate native state."""
import json, pathlib, re, subprocess, sys

path = pathlib.Path(sys.argv[1])
label = sys.argv[2]
def adb(*args):
    return subprocess.run(['adb', *args], capture_output=True, text=True, timeout=20, check=True).stdout

try:
    adb('shell', 'am', 'broadcast', '-a', 'com.xfiles.P01B_STATUS', '-n', 'com.xfiles.app/expo.modules.p01b.P01bStatusReceiver')
    raw = adb('logcat', '-d', '-s', 'P01B_NATIVE')
    records = []
    for line in raw.splitlines():
        m = re.search(r'P01B_NATIVE: (\{.*\})', line)
        if m:
            records.append(json.loads(m[1]))
    item = {'label': label, **records[-1]}
    previous = json.loads(path.read_text()) if path.exists() else []
    path.write_text(json.dumps([*previous, item], indent=2) + '\n')
    print(json.dumps(item))
except (subprocess.SubprocessError, ValueError, IndexError) as error:
    print(json.dumps({'reason': 'SERVICE_STATE_FAILED', 'kind': type(error).__name__}))
    raise SystemExit(1)
