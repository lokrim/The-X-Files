"""Quiet device window. New results never overwrite previous phone evidence."""
import argparse
import json
import pathlib
import re
import subprocess
import time
from service_device import adb, snapshot, stop_and_confirm, physical_device
from service_evidence import background_verdict, diagnose, timeout_verdict

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['plain', 'background', 'locked', 'timeout', 'steady-control'])
parser.add_argument('output', type=pathlib.Path)
parser.add_argument('--scheduler', choices=['js-timer', 'native-paced', 'native-slow', 'native-steady'])
args = parser.parse_args()
seconds = {'plain': 35, 'background': 330, 'locked': 330, 'timeout': 25, 'steady-control': 20}[args.mode]
if args.output.exists():
    print(json.dumps({'reason': 'EVIDENCE_ALREADY_EXISTS'}))
    raise SystemExit(2)

initial = None
original_timeout = None
result = {'mode': args.mode, 'quietSeconds': seconds, 'physicalPhoneEvidence': False,
          'verdict': {'result': 'INCOMPLETE', 'reason': 'WINDOW_NOT_COMPLETED'}}
try:
    result['device'] = physical_device()
    result['physicalPhoneEvidence'] = True
    initial = snapshot()
    result['initial'] = initial
    if not initial.get('running') or not initial.get('generation') or not initial.get('processStartedElapsedMs'):
        raise ValueError('SERVICE_NOT_READY')
    if args.scheduler and initial.get('scheduler') != args.scheduler:
        raise ValueError('WRONG_SCHEDULER')
    if initial.get('scheduler') == 'native-steady' and args.mode != 'steady-control':
        raise ValueError('STEADY_IS_A_SHORT_CONTROL_ONLY')
    if initial.get('reactLifecycle') != 'RESUMED':
        raise ValueError('START_FROM_FOREGROUND_REQUIRED')
    if args.mode == 'timeout':
        captured = adb('shell', 'device_config', 'get', 'activity_manager', 'data_sync_fgs_timeout_duration').strip()
        if captured != 'null' and not re.fullmatch(r'[0-9]{1,12}', captured):
            raise ValueError('UNSUPPORTED_TIMEOUT_SETTING')
        original_timeout = captured
        result['timeoutSettingBefore'] = original_timeout
        adb('shell', 'device_config', 'put', 'activity_manager', 'data_sync_fgs_timeout_duration', '10000')
    before = time.monotonic()
    if args.mode == 'locked' and initial.get('interactive') is not True:
        raise ValueError('SCREEN_ALREADY_OFF')
    adb('shell', 'input', 'keyevent', '3')
    if args.mode == 'locked':
        adb('shell', 'input', 'keyevent', '26')
    # No adb, debugger, log, or app interaction for the entire interval.
    time.sleep(seconds)
    # Capture app-owned clocks/counters FIRST, before extra commands wake processes.
    after = snapshot()
    result.update(after=after, elapsedSeconds=time.monotonic() - before,
                  diagnosis=diagnose(initial, after),
                  progressDelta=after['sequence'] - initial['sequence'],
                  workBytesDelta=after['workBytes'] - initial['workBytes'])
    if args.mode == 'timeout':
        result['verdict'] = timeout_verdict(initial, after)
    elif args.mode == 'steady-control':
        result['verdict'] = ({'result': 'CONTROL', 'reason': 'NOT_A_FIVE_MINUTE_GATE'}
                             if after.get('reason') in ('RUNNING', 'TEST_LIMIT')
                             else {'result': 'FAIL', 'reason': 'CONTROL_JOB_FAILED'})
    else:
        result['verdict'] = background_verdict(initial, after, seconds, args.mode == 'locked')
    power = adb('shell', 'dumpsys', 'power')
    match = re.search(r'mWakefulness=(Awake|Asleep|Dozing|Dreaming)\b', power)
    result['wakefulness'] = match[1] if match else 'UNKNOWN'
except (subprocess.SubprocessError, OSError, ValueError, KeyError) as error:
    # Only our own allowlisted precondition codes, never raw subprocess/device text.
    codes = {'SERVICE_NOT_READY', 'WRONG_SCHEDULER', 'STEADY_IS_A_SHORT_CONTROL_ONLY',
             'START_FROM_FOREGROUND_REQUIRED', 'SCREEN_ALREADY_OFF', 'OWNED_STATE_NOT_FOUND',
             'PHYSICAL_PHONE_REQUIRED', 'DEVELOPMENT_BUILD_REQUIRED',
             'UNSUPPORTED_TIMEOUT_SETTING', 'PHONE_RAM_UNAVAILABLE'}
    reason = str(error) if type(error) is ValueError and str(error) in codes else 'DEVICE_WINDOW_ERROR'
    result['verdict'] = {'result': 'INCOMPLETE', 'reason': reason}
    if reason == 'PHYSICAL_PHONE_REQUIRED':
        result['gatesNotMeasured'] = [1, 3, 4]
        result['setupInstructions'] = [
            'Enable Developer options (tap Build number seven times), then USB debugging.',
            'Connect a data-capable USB cable and accept USB debugging authorization.',
            'Run adb devices; verify a physical phone shows device, not unauthorized/offline or only an emulator.',
            'Run npx expo run:android and select the physical phone to install/run the development build.',
            'Rerun P01b. It is NOT passed without required phone measurements; emulator pre-checks do not clear gates1/3/4.',
        ]
finally:
    result['stopAttempted'] = initial is not None and bool(initial.get('generation'))
    result['cleanupConfirmed'] = False
    if result['stopAttempted'] and initial.get('processStartedElapsedMs'):
        try:
            result['stopped'], result['cleanupConfirmed'] = stop_and_confirm(initial)
        except (subprocess.SubprocessError, OSError, ValueError):
            result['stopError'] = 'NATIVE_STOP_NOT_CONFIRMED'
    if original_timeout is not None:
        result['timeoutSettingRestored'] = False
        try:
            if original_timeout == 'null':
                adb('shell', 'device_config', 'delete', 'activity_manager', 'data_sync_fgs_timeout_duration')
            else:
                adb('shell', 'device_config', 'put', 'activity_manager', 'data_sync_fgs_timeout_duration', original_timeout)
            result['timeoutSettingRestored'] = adb('shell', 'device_config', 'get', 'activity_manager', 'data_sync_fgs_timeout_duration').strip() == original_timeout
        except (subprocess.SubprocessError, OSError):
            result['settingRestoreError'] = 'TIMEOUT_SETTING_NOT_RESTORED'
    if result['verdict']['result'] in ('PASS', 'CONTROL') and (not result['cleanupConfirmed'] or result.get('timeoutSettingRestored') is False):
        result['verdict'] = {'result': 'INCOMPLETE', 'reason': 'CLEANUP_OR_RESTORE_NOT_CONFIRMED'}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open('x') as file:
        json.dump(result, file, indent=2)
        file.write('\n')
    print(json.dumps(result))
raise SystemExit(0 if result['verdict']['result'] in ('PASS', 'CONTROL') else 1)
