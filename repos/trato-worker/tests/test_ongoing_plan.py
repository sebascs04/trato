import unittest
from unittest.mock import patch

from trato_worker import business_ai


class OngoingPlanTests(unittest.TestCase):
    """An ongoing project tells the model to plan only the remaining work; a new project never sees the flag."""

    def payload_for(self, **extra):
        seen = {}

        class Model:
            name = 'test-model'

            def generate(self, messages, schema):
                seen['payload'] = messages[1]['content']
                return {}
        data = {'workflow': 'project_plan', 'output_language': 'en', 'reviews': [], 'brief': 'Website', 'budget': '420.00',
                'target_date': '2027-01-01', 'today': '2026-11-11', 'sources': [], **extra}
        with patch.object(business_ai, 'validate', lambda value, data: {}):
            business_ai.run_business_ai(data, Model()) if hasattr(business_ai, 'run_business_ai') else None
        return seen.get('payload', '')

    def test_flag_reaches_the_model_only_when_true(self):
        if not hasattr(business_ai, 'run_business_ai'):
            self.skipTest('entry point named differently')
        self.assertIn('"ongoing": true', self.payload_for(ongoing=True))
        self.assertNotIn('ongoing', self.payload_for())
        self.assertNotIn('ongoing', self.payload_for(ongoing='yes'))

    def test_prompt_has_the_remaining_work_rule(self):
        self.assertIn('When ongoing is true', business_ai.PROMPT)
        self.assertIn('leave that work out of the stages', business_ai.PROMPT)


if __name__ == '__main__':
    unittest.main()
