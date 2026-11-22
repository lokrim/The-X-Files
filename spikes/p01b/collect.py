"""Collect only owned aggregate P01B events; never raw device exceptions/UI."""
import json, pathlib, re, subprocess, sys
path = pathlib.Path(sys.argv[1])
pid = subprocess.check_output(['adb','shell','pidof','com.xfiles.app'], text=True).strip().split()[0]
raw = subprocess.check_output(['adb','logcat','--pid='+pid,'-d','-s','ReactNativeJS'], text=True)
events = []
for line in raw.splitlines():
    match = re.search(r"'P01B', '(\{.*\})'", line)
    if not match: continue
    try:
        event = json.loads(match[1])
        if not isinstance(event.get('event'), str): continue
        event['deviceLogTime'] = line[:18]
        events.append(event)
    except (ValueError, TypeError): pass
previous = json.loads(path.read_text()) if path.exists() else []
combined = {json.dumps(item, sort_keys=True): item for item in previous + events}
path.write_text(json.dumps(list(combined.values()), indent=2)+'\n')
for event in events[-12:]: print(json.dumps(event))
