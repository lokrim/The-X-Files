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
        fake.snapshot = lambda: initial.copy()
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


if __name__ == '__main__':
    unittest.main()
