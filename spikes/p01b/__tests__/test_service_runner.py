"""Host-runner cleanup checks with injected helpers, never real adb or phone evidence."""
import contextlib
import io
import json
import pathlib
import runpy
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from test_service_evidence import window


class RunnerCleanup(unittest.TestCase):
    def exercise(self, failure):
        initial, _ = window()
        initial.update(running=True, reactLifecycle='RESUMED', interactive=True)
        calls = []

        def adb(*args):
            calls.append(args)
            if args[:3] == ('shell', 'device_config', 'get'):
                return 'null\n'
            if args[:3] == ('shell', 'input', 'keyevent') and failure == 'home':
                raise OSError('TEST_ONLY')
            return ''

        def stop(owned):
            self.assertEqual(owned['generation'], initial['generation'])
            self.assertEqual(owned['processStartedElapsedMs'], initial['processStartedElapsedMs'])
            calls.append(('stop-owned',))
            return dict(initial, running=False, cleanupComplete=True, activeNotifications=0), True

        fake = types.ModuleType('service_device')
        fake.adb = adb
        snapshots = iter([initial.copy(), dict(initial, reactLifecycle='BEFORE_RESUME', hostPauses=1)])
        fake.snapshot = lambda: next(snapshots)
        fake.stop_and_confirm = stop
        fake.physical_device = lambda: {'model': 'UNIT_TEST_ONLY'}
        script = pathlib.Path(__file__).resolve().parents[1] / 'service-watch.py'
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'unit-only.json'
            with patch.dict(sys.modules, {'service_device': fake}), patch.object(sys, 'argv', [str(script), 'timeout', str(output)]), contextlib.redirect_stdout(io.StringIO()):
                with patch('time.sleep', side_effect=KeyboardInterrupt if failure == 'interrupt' else None):
                    with self.assertRaises((SystemExit, KeyboardInterrupt)):
                        runpy.run_path(str(script), run_name='__main__')
            data = json.loads(output.read_text())
        self.assertTrue(data['stopAttempted'])
        self.assertTrue(data['cleanupConfirmed'])
        self.assertTrue(data['timeoutSettingRestored'])
        self.assertNotEqual(data['verdict']['result'], 'PASS')
        self.assertIn(('stop-owned',), calls)
        self.assertIn(('shell', 'device_config', 'delete', 'activity_manager', 'data_sync_fgs_timeout_duration'), calls)

    def test_adb_failure_after_timeout_change_stops_and_restores(self):
        self.exercise('home')

    def test_keyboard_interrupt_also_stops_and_restores(self):
        self.exercise('interrupt')

    def locked_transition(self, resumed, delayed=False, awake_after_sleep=False):
        initial, _ = window()
        initial.update(running=True, reactLifecycle='RESUMED', interactive=True)
        transition = dict(initial, reactLifecycle='RESUMED' if resumed else 'BEFORE_RESUME',
                          interactive=False, keyguardLocked=True)
        samples = [initial, transition]
        if delayed:
            samples = [initial, dict(transition, keyguardLocked=False), transition]
        if awake_after_sleep:
            samples = [initial, dict(transition, interactive=True, keyguardLocked=False), transition]
        snapshots = iter(samples)
        calls = []
        fake = types.ModuleType('service_device')
        fake.adb = lambda *args: calls.append(args) or ''
        fake.snapshot = lambda: next(snapshots)
        fake.physical_device = lambda: {'model': 'UNIT_TEST_ONLY'}
        fake.stop_and_confirm = lambda owned: (dict(owned, running=False), True)
        script = pathlib.Path(__file__).resolve().parents[1] / 'service-watch.py'
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'unit-only.json'
            with patch.dict(sys.modules, {'service_device': fake}), patch.object(sys, 'argv', [str(script), 'locked', str(output)]), contextlib.redirect_stdout(io.StringIO()):
                def sleep_effect(seconds):
                    if seconds == 330:
                        raise KeyboardInterrupt
                with patch('time.sleep', side_effect=sleep_effect) as sleep:
                    with self.assertRaises((SystemExit, KeyboardInterrupt)):
                        runpy.run_path(str(script), run_name='__main__')
            data = json.loads(output.read_text())
        self.assertTrue(data['cleanupConfirmed'])
        self.assertIn(('shell', 'input', 'keyevent', '223'), calls)
        if awake_after_sleep:
            self.assertEqual(calls.count(('shell', 'input', 'keyevent', '26')), 1)
        else:
            self.assertNotIn(('shell', 'input', 'keyevent', '26'), calls)
        return data, sleep

    def test_unconfirmed_background_never_starts_quiet_window(self):
        data, sleep = self.locked_transition(True)
        self.assertEqual(data['verdict']['reason'], 'BACKGROUND_NOT_CONFIRMED')
        sleep.assert_not_called()

    def test_confirmed_lock_starts_full_quiet_window_and_finally_cleans(self):
        data, sleep = self.locked_transition(False)
        self.assertTrue(data['transition']['keyguardLocked'])
        sleep.assert_called_once_with(330)

    def test_delayed_keyguard_is_confirmed_before_full_quiet_window(self):
        data, sleep = self.locked_transition(False, delayed=True)
        self.assertTrue(data['transition']['keyguardLocked'])
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [1, 330])

    def test_power_fallback_only_after_confirmed_awake_display(self):
        data, sleep = self.locked_transition(False, awake_after_sleep=True)
        self.assertFalse(data['transition']['interactive'])
        sleep.assert_called_once_with(330)


if __name__ == '__main__':
    unittest.main()
