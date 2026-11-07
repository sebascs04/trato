import unittest
from trato_api.document_progress import processing_progress

OWNER='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';PROJECT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
NEW,MID,DONE,RETRY='c'*8+'-cccc-4ccc-8ccc-cccccccccccc','d'*8+'-dddd-4ddd-8ddd-dddddddddddd','e'*8+'-eeee-4eee-8eee-eeeeeeeeeeee','f'*8+'-ffff-4fff-8fff-ffffffffffff'

class Repo:
    def __init__(self,rows):self.rows_data=rows;self.calls=[]
    def rows(self,table,params):
        self.calls.append((table,params));assert table=='file_processing_artifacts'
        assert params['owner_id']=='eq.'+OWNER and params['project_id']=='eq.'+PROJECT
        return sorted(self.rows_data,key=lambda r:r['created_at'])

class DocumentProgressTests(unittest.TestCase):
    def test_step_follows_the_last_finished_stage_of_the_run_in_progress(self):
        rows=[{'document_id':MID,'stage':'extraction','created_at':'1'},{'document_id':MID,'stage':'treatment','created_at':'2'},
              {'document_id':DONE,'stage':'extraction','created_at':'1'},{'document_id':DONE,'stage':'summary','created_at':'2'},{'document_id':DONE,'stage':'outcome','created_at':'3'},
              # A failed run, then a new run that only reached extraction again: old stages do not count.
              {'document_id':RETRY,'stage':'extraction','created_at':'1'},{'document_id':RETRY,'stage':'treatment','created_at':'2'},
              {'document_id':RETRY,'stage':'outcome','created_at':'3'},{'document_id':RETRY,'stage':'extraction','created_at':'4'}]
        progress=processing_progress(Repo(rows),OWNER,PROJECT,[NEW,MID,DONE,RETRY])
        self.assertEqual(progress[NEW],{'processing_stage':'extracting','processing_step':1,'processing_steps':5})
        self.assertEqual(progress[MID]['processing_stage'],'chunking');self.assertEqual(progress[MID]['processing_step'],3)
        self.assertNotIn(DONE,progress)
        self.assertEqual(progress[RETRY]['processing_stage'],'analyzing')

    def test_summary_finished_means_indexing_and_no_ids_means_no_query(self):
        rows=[{'document_id':MID,'stage':s,'created_at':str(i)} for i,s in enumerate(('extraction','treatment','chunks','summary'))]
        self.assertEqual(processing_progress(Repo(rows),OWNER,PROJECT,[MID])[MID],{'processing_stage':'indexing','processing_step':5,'processing_steps':5})
        repo=Repo([]);self.assertEqual(processing_progress(repo,OWNER,PROJECT,[]),{});self.assertEqual(repo.calls,[])
