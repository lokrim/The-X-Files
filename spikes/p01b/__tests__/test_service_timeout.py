"""Timeout setup rollback tests; all phone helpers are replaced with unit fakes."""
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


class TimeoutSetup(unittest.TestCase):
    def exercise(self, failure):
        state = {'setting': 'null', 'stopped': False, 'childCalled': False}

        def adb(*args):
            if args[:3] == ('shell', 'dumpsys', 'activity'):
                return 'data_sync_fgs_timeout_duration=' + ('21600000' if state['setting'] == 'null' else state['setting'])
            if args[2] == 'get':
                return state['setting']
            state['setting'] = 'null' if args[2] == 'delete' else args[-1]
            return ''

        fake = types.ModuleType('service_device')
        fake.adb = adb
        fake.physical_device = lambda: {'model': 'UNIT_TEST_ONLY'}
        snapshots = iter([{'running': False}, {'running': True, 'generation': 2, 'processStartedElapsedMs': 1}])
        fake.snapshot = lambda: next(snapshots)

        def stop(owned):
            self.assertEqual(owned['generation'], 2)
            state['stopped'] = True
            return {}, True
        fake.stop_and_confirm = stop

        def subprocess_run(args, **kwargs):
            self.assertEqual(state['setting'], '10000')
            if args[1].endswith('device.py'):
                if failure == 'ui':
                    raise OSError('UNIT_ONLY')
                return types.SimpleNamespace(stdout='{"tapped":true}', returncode=0)
            state['childCalled'] = True
            raise OSError('UNIT_ONLY')

        script = pathlib.Path(__file__).resolve().parents[1] / 'service-timeout.py'
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'unit-only.json'
            with patch.dict(sys.modules, {'service_device': fake}), patch.object(sys, 'argv', [str(script), str(output)]), patch('subprocess.run', side_effect=subprocess_run), contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(SystemExit):
                    runpy.run_path(str(script), run_name='__main__')
            result = json.loads(output.with_suffix('.restore.json').read_text())
        self.assertEqual(state['setting'], 'null')
        self.assertTrue(result['outerSettingRestored'])
        self.assertEqual(result['effectiveTimeoutRestoredMs'], 21600000)
        self.assertNotEqual(result['result'], 'PASS')
        return state, result

    def test_failed_ui_start_restores_setting_and_keeps_cleanup_unconfirmed(self):
        state, result = self.exercise('ui')
        self.assertFalse(state['childCalled'])
        self.assertFalse(result['ownedCleanupConfirmed'])

    def test_failed_child_stops_owned_generation_and_restores_setting(self):
        state, result = self.exercise('child')
        self.assertTrue(state['stopped'])
        self.assertTrue(result['ownedCleanupConfirmed'])


if __name__ == '__main__':
    unittest.main()
