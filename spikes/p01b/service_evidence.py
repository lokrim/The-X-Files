"""Pure aggregate verdicts. These never substitute for physical-phone evidence."""
import math

CHUNK = 1048576
MAX_GAP_MS = 5000  # Harness threshold; keep the value visible in every report.


def number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def background_verdict(initial, after, quiet_seconds, locked):
    gaps = [after.get('lastTickAgeMs'), after.get('maxGapMs')]
    if any(number(gap) and gap > MAX_GAP_MS for gap in gaps):
        return {'result': 'FAIL', 'reason': 'JS_PROGRESS_STALLED', 'maxAllowedGapMs': MAX_GAP_MS}
    numeric = ['generation', 'processStartedElapsedMs', 'elapsedMs', 'uptimeMs', 'sequence',
               'workBytes', 'nativeTicks', 'nativeWaitCalls', 'hostResumes']
    if any(not number(state.get(key)) for state in (initial, after) for key in numeric) or any(not number(g) for g in gaps):
        return {'result': 'INCOMPLETE', 'reason': 'DIAGNOSTICS_MISSING'}
    if any(s.get('diagnosticsVersion') != 2 for s in (initial, after)):
        return {'result': 'INCOMPLETE', 'reason': 'OLD_DIAGNOSTICS_VERSION'}
    modes = ('js-timer', 'native-paced', 'native-steady', 'native-slow')
    if any(s.get('scheduler') not in modes for s in (initial, after)):
        return {'result': 'INCOMPLETE', 'reason': 'SCHEDULER_MISSING'}
    if any(initial[k] != after[k] for k in ('generation', 'processStartedElapsedMs', 'scheduler')):
        return {'result': 'FAIL', 'reason': 'JOB_OR_PROCESS_CHANGED'}
    if not after.get('running') or after.get('reason') != 'RUNNING':
        return {'result': 'FAIL', 'reason': 'SERVICE_ENDED_EARLY'}
    if after['hostResumes'] != initial['hostResumes'] or after.get('reactLifecycle') == 'RESUMED':
        return {'result': 'FAIL', 'reason': 'APP_FOREGROUNDED'}
    if locked and after.get('keyguardLocked') is not True:
        return {'result': 'FAIL', 'reason': 'LOCK_NOT_CONFIRMED'}
    if quiet_seconds < 300 or after['elapsedMs'] - initial['elapsedMs'] < quiet_seconds * 1000 - 1000:
        return {'result': 'INCOMPLETE', 'reason': 'WINDOW_TOO_SHORT'}
    records = after['sequence'] - initial['sequence']
    work = after['workBytes'] - initial['workBytes']
    if records <= 0 or work < CHUNK or abs(work - records * CHUNK) > CHUNK:
        return {'result': 'FAIL', 'reason': 'JS_IO_PROGRESS_MISSING'}
    if after['nativeTicks'] <= initial['nativeTicks']:
        return {'result': 'INCOMPLETE', 'reason': 'NATIVE_HEARTBEAT_MISSING'}
    if after.get('scheduler') != 'js-timer' and after['nativeWaitCalls'] <= initial['nativeWaitCalls']:
        return {'result': 'INCOMPLETE', 'reason': 'NATIVE_WAIT_NOT_EXERCISED'}
    if after.get('headless') and after.get('headlessTaskActive') is not True:
        return {'result': 'FAIL', 'reason': 'HEADLESS_TASK_INACTIVE'}
    if after.get('activeNotifications') != 1 or after.get('visibility') != -1 or after.get('genericText') is not True or after.get('ongoing') is not True:
        return {'result': 'FAIL', 'reason': 'PRIVATE_ONGOING_NOTIFICATION_MISSING'}
    return {'result': 'PASS', 'reason': 'QUIET_JS_IO_WINDOW', 'maxAllowedGapMs': MAX_GAP_MS}


def diagnose(initial, after):
    if after.get('running') is False:
        return 'JOB_ENDED'
    if any(not number(s.get(k)) for s in (initial, after) for k in ('elapsedMs', 'uptimeMs')):
        return 'INCONCLUSIVE'
    elapsed = after.get('elapsedMs', 0) - initial.get('elapsedMs', 0)
    uptime = after.get('uptimeMs', 0) - initial.get('uptimeMs', 0)
    if not all(number(x) for x in (elapsed, uptime)):
        return 'INCONCLUSIVE'
    if elapsed - uptime > MAX_GAP_MS:
        return 'CPU_SUSPEND_OBSERVED'
    if after.get('lastTickAgeMs', 0) > MAX_GAP_MS or after.get('maxGapMs', 0) > MAX_GAP_MS:
        if after.get('nativeLastTickAgeMs', MAX_GAP_MS + 1) <= MAX_GAP_MS and after.get('nativeMaxGapMs', MAX_GAP_MS + 1) <= MAX_GAP_MS:
            return 'JS_SCHEDULING_STALL'
        return 'PROCESS_OR_NATIVE_SCHEDULING_STALL'
    return 'NO_STALL_OBSERVED'


def timeout_verdict(initial, after):
    if any(s.get('diagnosticsVersion') != 2 for s in (initial, after)):
        return {'result': 'INCOMPLETE', 'reason': 'OLD_DIAGNOSTICS_VERSION'}
    if any(initial.get(k) != after.get(k) for k in ('generation', 'processStartedElapsedMs')):
        return {'result': 'FAIL', 'reason': 'JOB_OR_PROCESS_CHANGED'}
    if after.get('reason') != 'SERVICE_TIMEOUT' or after.get('running') is not False:
        return {'result': 'FAIL', 'reason': 'OS_TIMEOUT_NOT_OBSERVED'}
    if after.get('timeoutCount', 0) <= initial.get('timeoutCount', 0):
        return {'result': 'INCOMPLETE', 'reason': 'FRESH_TIMEOUT_CALLBACK_MISSING'}
    stop = after.get('timeoutStopMs')
    if not number(stop) or not 0 <= stop <= 1000:
        return {'result': 'FAIL', 'reason': 'NATIVE_STOP_TOO_SLOW'}
    if after.get('activeNotifications') != 0 or after.get('cleanupAttempted') is not True:
        return {'result': 'FAIL', 'reason': 'TIMEOUT_STOP_OR_CLEANUP_MISSING'}
    return {'result': 'PASS', 'reason': 'OS_TIMEOUT_NATIVE_STOP', 'maxAllowedStopMs': 1000}
