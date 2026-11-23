"""Configure and verify the OS limit BEFORE the foreground test-button start."""
import argparse
import json
import pathlib
import re
import subprocess
import sys
import time
from service_device import adb, physical_device, snapshot, stop_and_confirm

parser = argparse.ArgumentParser()
parser.add_argument('output', type=pathlib.Path)
args = parser.parse_args()
restore_file = args.output.with_suffix('.restore.json')
if args.output.exists() or restore_file.exists():
    print(json.dumps({'reason': 'EVIDENCE_ALREADY_EXISTS'}))
    raise SystemExit(2)


def effective_timeout():
    match = re.search(r'data_sync_fgs_timeout_duration=(\d+)',
                      adb('shell', 'dumpsys', 'activity', 'settings'))
    return int(match[1]) if match else None


result = {'result': 'INCOMPLETE'}
original = None
owned = None
start_attempted = False
try:
    result['device'] = physical_device()
    if snapshot().get('running'):
        raise ValueError('EXISTING_SERVICE_MUST_BE_STOPPED')
    original = adb('shell', 'device_config', 'get', 'activity_manager', 'data_sync_fgs_timeout_duration').strip()
    if original != 'null' and not re.fullmatch(r'[0-9]{1,12}', original):
        original = None
        raise ValueError('UNSUPPORTED_TIMEOUT_SETTING')
    result.update(timeoutSettingBeforeServiceStart=original,
                  effectiveTimeoutBeforeMs=effective_timeout())
    if result['effectiveTimeoutBeforeMs'] is None:
        raise ValueError('EFFECTIVE_TIMEOUT_UNAVAILABLE')
    restore_file.parent.mkdir(parents=True, exist_ok=True)
    restore_file.write_text(json.dumps(result, indent=2) + '\n')
    adb('shell', 'device_config', 'put', 'activity_manager', 'data_sync_fgs_timeout_duration', '10000')
    deadline = time.monotonic() + 30
    while effective_timeout() != 10000 and time.monotonic() < deadline:
        time.sleep(0.25)
    result['effectiveTimeoutBeforeStartMs'] = effective_timeout()
    if result['effectiveTimeoutBeforeStartMs'] != 10000:
        raise ValueError('EFFECTIVE_TIMEOUT_NOT_UPDATED')
    start_attempted = True
    button = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('device.py')),
                             'tap', 'Start dataSync service'], capture_output=True,
                            text=True, timeout=45, check=True)
    if json.loads(button.stdout).get('tapped') is not True:
        raise ValueError('FOREGROUND_START_NOT_CONFIRMED')
    owned = snapshot()
    if not owned.get('running'):
        raise ValueError('SERVICE_NOT_READY')
    # The child owns the entire quiet interval. No extra adb/debugger traffic.
    child = subprocess.run([sys.executable, str(pathlib.Path(__file__).with_name('service-watch.py')),
                            'timeout', str(args.output), '--scheduler', 'native-paced'],
                           capture_output=True, text=True, timeout=180)
    result['runnerExitCode'] = child.returncode
except (subprocess.SubprocessError, OSError, ValueError) as error:
    codes = {'EXISTING_SERVICE_MUST_BE_STOPPED', 'UNSUPPORTED_TIMEOUT_SETTING',
             'EFFECTIVE_TIMEOUT_UNAVAILABLE', 'EFFECTIVE_TIMEOUT_NOT_UPDATED',
             'FOREGROUND_START_NOT_CONFIRMED', 'SERVICE_NOT_READY',
             'PHYSICAL_PHONE_REQUIRED', 'DEVELOPMENT_BUILD_REQUIRED', 'PHONE_RAM_UNAVAILABLE'}
    result['reason'] = str(error) if type(error) is ValueError and str(error) in codes else 'TIMEOUT_SETUP_OR_RUN_FAILED'
finally:
    result['ownedCleanupConfirmed'] = not start_attempted
    if owned is not None:
        try:
            _, result['ownedCleanupConfirmed'] = stop_and_confirm(owned)
        except (subprocess.SubprocessError, OSError, ValueError):
            result['ownedCleanupConfirmed'] = False
    if original is not None:
        result['outerSettingRestored'] = False
        try:
            if original == 'null':
                adb('shell', 'device_config', 'delete', 'activity_manager', 'data_sync_fgs_timeout_duration')
            else:
                adb('shell', 'device_config', 'put', 'activity_manager', 'data_sync_fgs_timeout_duration', original)
            result['outerSettingRestored'] = adb('shell', 'device_config', 'get', 'activity_manager', 'data_sync_fgs_timeout_duration').strip() == original
            deadline = time.monotonic() + 10
            while effective_timeout() != result.get('effectiveTimeoutBeforeMs') and time.monotonic() < deadline:
                time.sleep(0.25)
            result['effectiveTimeoutRestoredMs'] = effective_timeout()
        except (subprocess.SubprocessError, OSError, ValueError):
            result['reason'] = 'TIMEOUT_SETTING_RESTORE_UNCONFIRMED'
    if (result.get('runnerExitCode') == 0 and result.get('outerSettingRestored')
            and result['ownedCleanupConfirmed']
            and result.get('effectiveTimeoutRestoredMs') == result.get('effectiveTimeoutBeforeMs')):
        result['result'] = 'PASS'
    restore_file.parent.mkdir(parents=True, exist_ok=True)
    restore_file.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))
raise SystemExit(0 if result['result'] == 'PASS' else 1)
