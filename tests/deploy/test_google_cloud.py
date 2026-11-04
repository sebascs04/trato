import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
import yaml

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('prepare_deploy',ROOT/'deploy/google-cloud/prepare.py')
prepare=importlib.util.module_from_spec(spec);spec.loader.exec_module(prepare)


class DeploymentContracts(unittest.TestCase):
    def test_private_files_are_preserved_and_special_characters_are_not_expanded(self):
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary);key=base/'source-key.json';key.write_text('{"type":"service_account"}')
            values={'api':{'FILE_PROCESSOR_TOKEN':'literal$token#value'},'processor':{},'worker':{}}
            target=base/'private'
            prepare.write_inputs(target,'https://trato-example.run.app',values,key)
            self.assertEqual(target.stat().st_mode&0o777,0o700)
            self.assertEqual((target/'api.env').stat().st_mode&0o777,0o600)
            self.assertIn('FILE_PROCESSOR_TOKEN=literal$token#value\n',(target/'api.env').read_text())
            self.assertEqual(values['api']['PAYPAL_TEST_CANCEL_URL'],'https://trato-example.run.app/paypal-sandbox-return.html?result=cancel')
            self.assertEqual(key.read_text(),(target/'google-cloud-worker.json').read_text())
            self.assertFalse((target/'rehearsal-sources').exists())
            self.assertEqual(values['api']['TRATO_REHEARSAL_SOURCE_MANIFEST'],'/app/resources/rehearsal-sources/manifest.json')
            with self.assertRaises(ValueError):prepare.write_inputs(target,'https://trato-example.run.app',values,key)

    def test_invalid_public_origins_do_not_write_private_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            for number,origin in enumerate(['http://example.com','https://example.com/','https://user:password@example.com','https://example.com?x=1']):
                target=Path(temporary)/str(number)
                with self.assertRaises(ValueError):prepare.write_inputs(target,origin,{},None)
                self.assertFalse(target.exists())

    def test_only_api_is_published_and_state_and_secret_scopes_remain_separate(self):
        data=yaml.safe_load((ROOT/'deploy/google-cloud/compose.yaml').read_text())
        self.assertEqual(data['name'],'trato')
        services=data['services']
        exposed={name for name,item in services.items() if item.get('ports')}
        self.assertEqual(exposed,{'api'})
        for name,item in services.items():
            self.assertEqual(item['networks'],['trato'])
            self.assertNotIn('network_mode',item)
            self.assertEqual(item['restart'],'unless-stopped')
        self.assertIn('noeviction',services['redis']['command'])
        self.assertIn('everysec',services['redis']['command'])
        self.assertFalse(services['api'].get('secrets'))
        self.assertFalse(services['processor'].get('secrets'))
        for name in ['ingestion-worker','ai-worker','rehearsal-worker']:
            self.assertEqual(services[name]['secrets'][0]['source'],'gemini_credentials')
            self.assertEqual(services[name]['depends_on']['api']['condition'],'service_healthy')
        self.assertEqual(services['processor']['env_file'][0]['path'],'${TRATO_PRIVATE_DIR}/processor.env')
        self.assertEqual(services['api']['env_file'][0]['format'],'raw')


if __name__=='__main__':unittest.main()
