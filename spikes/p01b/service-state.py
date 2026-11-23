"""Record only a fresh, correlated development-service aggregate snapshot."""
import json
import pathlib
import subprocess
import sys
from service_device import snapshot

path = pathlib.Path(sys.argv[1])
label = sys.argv[2]
try:
    item = {'label': label, **snapshot()}
    previous = json.loads(path.read_text()) if path.exists() else []
    path.write_text(json.dumps([*previous, item], indent=2) + '\n')
    print(json.dumps(item))
except (subprocess.SubprocessError, OSError, ValueError) as error:
    print(json.dumps({'reason': 'SERVICE_STATE_FAILED', 'kind': type(error).__name__}))
    raise SystemExit(1)
