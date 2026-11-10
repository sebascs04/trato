import unittest

from trato_worker.source_tools import normalize_reply_type


class ReplyAliasTests(unittest.TestCase):
    """Only the reply label is forgiven; a reply of the wrong shape is still rejected."""

    def test_synonyms_with_the_exact_shape_are_mapped(self):
        self.assertEqual(normalize_reply_type({'type': 'result', 'result': {'status': 'ready'}}), {'type': 'final', 'result': {'status': 'ready'}})
        self.assertEqual(normalize_reply_type({'type': 'call', 'tool': 'search', 'params': {}}), {'type': 'tool_call', 'tool': 'search', 'params': {}})

    def test_correct_and_malformed_replies_are_left_alone(self):
        for reply in ({'type': 'final', 'result': {}}, {'type': 'result', 'answer': 'x'}, {'type': 'call', 'tool': 'search'},
                      {'type': 'other', 'result': {}}, {'result': {}}):
            self.assertEqual(normalize_reply_type(reply), reply)


if __name__ == '__main__':
    unittest.main()
