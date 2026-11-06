import unittest
from trato_api.errors import ApiError
from trato_api.project_assistant import focus_context

PROJECT={'id':'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}
REQUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
class Repo:
    def __init__(self,docs):self.docs=docs;self.calls=[]
    def rows(self,table,params):
        self.calls.append((table,params))
        if table=='documents':
            assert params['project_id']=='eq.'+PROJECT['id'] and params['owner_id']=='eq.owner' and params['kind']=='eq.email_request' and params['deleted_at']=='is.null'
            return self.docs
        if table=='change_proposals':return [{'current_revision_id':'rev'}]
        if table=='proposal_revisions':return [{'revision_no':2}]
        raise AssertionError(table)

class AssistantFocusTests(unittest.TestCase):
    def test_focus_is_the_owned_change_request_with_its_current_version(self):
        value=focus_context(Repo([{'id':REQUEST,'title':'Pequeña tienda'}]),'owner',PROJECT,REQUEST)
        self.assertEqual(value,{'kind':'change_request','request_document_id':REQUEST,'title':'Pequeña tienda','addendum_version':2})
    def test_foreign_or_missing_request_is_rejected_and_no_focus_is_optional(self):
        with self.assertRaisesRegex(ApiError,'DOCUMENT_NOT_FOUND'):focus_context(Repo([]),'owner',PROJECT,REQUEST)
        self.assertIsNone(focus_context(Repo([]),'owner',PROJECT,None))
