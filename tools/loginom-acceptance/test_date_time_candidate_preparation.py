"""Preparation boundaries; synthetic receipts are not live acceptance."""
import argparse
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import date_time_launch as launch
from date_time_candidate_prepare import archive


class CandidatePreparation(unittest.TestCase):
    def test_prepared_skill_target_and_frontend_are_bound(self):
        import copy
        from date_time_sales_acceptance import prepared_pins_match
        remote=dict(skill=dict(revision='pinned'),frontend=dict(url='http://logi-test-plan.bg.local/app/'))
        prepared=dict(skillRevision='pinned',loginomUrl=remote['frontend']['url']+'?testable=true',workspace=dict(target=dict(profile_id='loginom-7.4.2-macos-chromium-ru',loginom_build='7.4.2',platform='macos',browser='chromium')))
        self.assertTrue(prepared_pins_match(prepared,remote))
        for key in ('skillRevision','loginomUrl','workspace'):
            wrong=copy.deepcopy(prepared);wrong[key]={} if key=='workspace' else 'different'
            self.assertFalse(prepared_pins_match(wrong,remote))

    def test_authorized_wrapper_dispatches_only_existing_runner(self):
        with tempfile.TemporaryDirectory() as tmp:
            path=Path(tmp)/'a.json';path.write_text(json.dumps(dict(loginom_url='url',catalog=dict(manifest_uri='uri',manifest_sha256='sha'),budget=dict(timeout_seconds=100,max_turns=10))))
            with patch('sys.argv',['launcher','--admission',str(path),'--run']),patch.object(launch,'check',return_value={'passed':True}),patch('run.execute',return_value=0) as run:
                self.assertEqual(launch.main(),0)
                args=run.call_args.args[0]
                self.assertEqual(args.goal,'date-time-sales');self.assertEqual(args.model_profile,'chatgpt-sol')
                self.assertEqual(args.loginom_user,'test-3');self.assertEqual(args.date_time_admission,path)

    def test_archive_is_reproducible_and_contains_exact_bytes_only(self):
        files = {'b/file.json': b'{"x":1}\n', 'a.mjs': b'export {};\n'}
        data = archive(files)
        self.assertEqual(data, archive(dict(reversed(list(files.items())))))
        with tarfile.open(fileobj=io.BytesIO(data),mode='r:gz') as tar:
            self.assertEqual({m.name:tar.extractfile(m).read() for m in tar.getmembers()},files)
            self.assertTrue(all(m.uid == m.gid == m.mtime == 0 for m in tar.getmembers()))

    def test_changed_environment_stops_before_catalog_network_or_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp)/'admission.json'
            value = dict(catalog=dict(manifest_uri='uri',manifest_sha256='sha'), loginom_url='url',
                budget=dict(timeout_seconds=100,max_turns=10),environment_pin={})
            path.write_text(json.dumps(value))
            args=argparse.Namespace(date_time_admission=path,model_profile='chatgpt-sol',fault='none',
                loginom_user='test-3',storage_directory='/test-3',manifest_uri='uri',manifest_sha256='sha',
                loginom_url='url',timeout=100,max_turns=10,runs_root=launch.ROOT/'.dock/run',dock_config=launch.ROOT/'.dock/config')
            with patch.object(launch,'check',return_value={'passed':True}), patch.object(launch,'receipt',return_value={'pin':'old'}), \
                    patch('date_time_environment.snapshot',return_value={'pin':'new'}),patch.object(launch.subprocess,'check_output') as catalog:
                with self.assertRaisesRegex(ValueError,'environment differs'):
                    launch.guard(args)
                catalog.assert_not_called()

    def test_current_pin_receipts_are_mandatory(self):
        from date_time_admission import check
        with tempfile.TemporaryDirectory() as tmp:
            result=check({},Path(tmp))
            self.assertFalse(result['checks']['local_environment_pin']['passed'])
            self.assertFalse(result['checks']['remote_skill_frontend_pin']['passed'])
            self.assertFalse(result['model_started'])


if __name__ == '__main__':
    unittest.main()
