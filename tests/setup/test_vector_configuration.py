"""Fresh-install activation may change its flag, never existing credentials."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('configure_vector', ROOT / 'scripts/configure-vector.py')
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)


class VectorConfiguration(unittest.TestCase):
    def test_template_false_is_explicitly_activated_without_changing_other_settings(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / '.env'
            target.write_text('TRATO_VECTOR_SEARCH_ENABLED=false\nFILE_PROCESSOR_TOKEN=keep-local\n')
            config.update(target, {'WEAVIATE_URL': 'https://example.invalid',
                                  'WEAVIATE_API_KEY': 'test-key', 'TRATO_VECTOR_SEARCH_ENABLED': 'true'},
                          allowed_changes={'TRATO_VECTOR_SEARCH_ENABLED'})
            config.update(target, {'TRATO_VECTOR_SEARCH_ENABLED': 'true'},
                          allowed_changes={'TRATO_VECTOR_SEARCH_ENABLED'})
            self.assertEqual(config.values(target), {'TRATO_VECTOR_SEARCH_ENABLED': 'true',
                'FILE_PROCESSOR_TOKEN': 'keep-local', 'WEAVIATE_URL': 'https://example.invalid',
                'WEAVIATE_API_KEY': 'test-key'})
            self.assertEqual(target.read_text().count('TRATO_VECTOR_SEARCH_ENABLED='), 1)

    def test_different_credentials_fail_before_writing_even_with_explicit_flag_activation(self):
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary) / '.env'
            original = 'WEAVIATE_API_KEY=existing-private-key\nTRATO_VECTOR_SEARCH_ENABLED=false\n'
            target.write_text(original)
            with self.assertRaises(ValueError):
                config.update(target, {'WEAVIATE_API_KEY': 'another-key',
                                      'TRATO_VECTOR_SEARCH_ENABLED': 'true'},
                              allowed_changes={'TRATO_VECTOR_SEARCH_ENABLED'})
            self.assertEqual(target.read_text(), original)


if __name__ == '__main__':
    unittest.main()
