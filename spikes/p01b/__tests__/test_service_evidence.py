import pathlib
import sys
import unittest
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from service_evidence import background_verdict, diagnose, timeout_verdict


def window():
    before = dict(diagnosticsVersion=2, generation=1, processStartedElapsedMs=1,
                  elapsedMs=100, uptimeMs=100, sequence=1, workBytes=1048576,
                  scheduler='native-paced', nativeTicks=1, nativeWaitCalls=1, hostResumes=1)
    after = dict(before, elapsedMs=330100, uptimeMs=330100, sequence=1001,
                 workBytes=1001 * 1048576, nativeTicks=330, nativeWaitCalls=1001,
                 lastTickAgeMs=100, maxGapMs=500, running=True, reason='RUNNING',
                 reactLifecycle='BEFORE_RESUME', keyguardLocked=True, headless=True,
                 headlessTaskActive=True, activeNotifications=1, visibility=-1,
                 genericText=True, ongoing=True, nativeLastTickAgeMs=100, nativeMaxGapMs=1100)
    return before, after


class EvidenceRegression(unittest.TestCase):
    def test_prior_terminal_stall_cannot_pass_despite_small_recorded_gap(self):
        before, after = window()
        after.update(lastTickAgeMs=325885, maxGapMs=366, sequence=55)
        self.assertEqual(background_verdict(before, after, 330, True)['reason'], 'JS_PROGRESS_STALLED')

    def test_waking_phone_and_resuming_js_does_not_hide_prior_gap(self):
        before, after = window()
        after.update(lastTickAgeMs=10, maxGapMs=326000)
        self.assertEqual(background_verdict(before, after, 330, True)['result'], 'FAIL')

    def test_native_counter_alone_is_not_js_progress(self):
        before, after = window()
        after['sequence'] = before['sequence']
        self.assertEqual(background_verdict(before, after, 330, True)['reason'], 'JS_IO_PROGRESS_MISSING')

    def test_restart_or_foreground_interaction_invalidates_window(self):
        before, after = window()
        after['processStartedElapsedMs'] = 2
        self.assertEqual(background_verdict(before, after, 330, True)['reason'], 'JOB_OR_PROCESS_CHANGED')
        after['processStartedElapsedMs'] = 1
        after['hostResumes'] = 2
        self.assertEqual(background_verdict(before, after, 330, True)['reason'], 'APP_FOREGROUNDED')

    def test_healthy_aggregate_is_only_a_verdict_unit_test_not_device_evidence(self):
        before, after = window()
        self.assertEqual(background_verdict(before, after, 330, True)['result'], 'PASS')
        self.assertEqual(background_verdict(before, after, 35, True)['result'], 'INCOMPLETE')

    def test_sleep_inference_requires_both_native_clocks(self):
        before, after = window()
        after['uptimeMs'] = 10100
        self.assertEqual(diagnose(before, after), 'CPU_SUSPEND_OBSERVED')
        del before['uptimeMs']
        self.assertEqual(diagnose(before, after), 'INCONCLUSIVE')

    def test_old_timeout_callback_does_not_count_as_a_new_test(self):
        before, after = window()
        before['timeoutCount'] = 1
        after.update(reason='SERVICE_TIMEOUT', running=False, timeoutCount=1,
                     timeoutStopMs=5, activeNotifications=0, cleanupAttempted=True)
        self.assertEqual(timeout_verdict(before, after)['result'], 'INCOMPLETE')

    def test_stopped_timeout_heartbeat_ages_are_not_a_scheduling_stall(self):
        before, after = window()
        after.update(running=False, reason='SERVICE_TIMEOUT', lastTickAgeMs=18000,
                     nativeLastTickAgeMs=18000)
        self.assertEqual(diagnose(before, after), 'JOB_ENDED')


if __name__ == '__main__':
    unittest.main()
