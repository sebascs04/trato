import unittest
from trato_api.errors import ApiError
from trato_api.persistence import Repository

PROJECT='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';REQUEST='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';OWNER='cccccccc-cccc-4ccc-8ccc-cccccccccccc'

class Fake:
    """Only what set_plan_placement/request_status read and write; methods come from the real Repository."""
    set_plan_placement=Repository.set_plan_placement
    request_status=Repository.request_status
    def __init__(self,*,kind='email_request',plan=True,stages=(1,2,3),placed=None,active=None,paid=()):
        self.kind,self.plan,self.stages,self.placed,self.active,self.paid=kind,plan,set(stages),placed,active,set(paid);self.posts=[]
    def document(self,request_id):return {'id':REQUEST,'project_id':PROJECT,'owner_id':OWNER,'kind':self.kind}
    def project(self,project_id):return {'id':PROJECT,'owner_id':OWNER}
    def rpc(self,name,params):
        # Paid state comes from the owner-readable progress RPC, never from the service-only checkouts table.
        if name=='project_plan_progress':return {'stages':[{'position':p,'status':'completed'} for p in self.paid]+[{'position':p,'status':'pending_approval'} for p in self.stages-self.paid]}
        return {'can_register':False,'active_request':self.active}
    def rows(self,table,params):
        if table=='project_start_plans':return [{'project_id':PROJECT}] if self.plan else []
        if table=='project_start_stages':return [{'position':int(params['position'][3:])}] if int(params['position'][3:]) in self.stages else []
        if table=='change_request_plan_placements':return [dict(self.placed)] if self.placed else []
        raise AssertionError(table)
    def call(self,method,path,json=None,**kwargs):
        self.posts.append(json);self.placed={'placement':json['placement'],'stage_position':json['stage_position']}

class PlanPlacementTests(unittest.TestCase):
    def test_request_is_placed_once_under_an_existing_stage_or_as_new_work(self):
        repo=Fake()
        self.assertEqual(repo.set_plan_placement(REQUEST,'stage',2),{'request_document_id':REQUEST,'plan_placement':'stage','plan_stage_position':2})
        self.assertEqual(repo.posts,[{'request_document_id':REQUEST,'project_id':PROJECT,'owner_id':OWNER,'placement':'stage','stage_position':2}])
        # A retry with the same choice is idempotent; another choice is rejected, never overwritten.
        repo.set_plan_placement(REQUEST,'stage',2);self.assertEqual(len(repo.posts),1)
        with self.assertRaisesRegex(ApiError,'PLAN_PLACEMENT_FIXED'):repo.set_plan_placement(REQUEST,'new',None)
        self.assertEqual(Fake().set_plan_placement(REQUEST,'new',None)['plan_placement'],'new')

    def test_invalid_placements_are_rejected_before_writing(self):
        for repo,args,code in [(Fake(kind='reference'),('new',None),'REQUEST_NOT_FOUND'),(Fake(plan=False),('new',None),'PLAN_NOT_FOUND'),
                               (Fake(),('stage',7),'PLAN_STAGE_NOT_FOUND'),(Fake(paid=(1,)),('stage',1),'PLAN_STAGE_CLOSED'),(Fake(),('stage',None),'INVALID_REQUEST'),(Fake(),('new',2),'INVALID_REQUEST')]:
            with self.assertRaisesRegex(ApiError,code):repo.set_plan_placement(REQUEST,*args)
            self.assertEqual(repo.posts,[])

    def test_request_status_exposes_the_open_change_request_and_its_placement(self):
        self.assertEqual(Fake(active={'id':REQUEST,'kind':'change'},placed={'placement':'stage','stage_position':1}).request_status(PROJECT)['open_request'],
                         {'request_document_id':REQUEST,'plan_placement':'stage','plan_stage_position':1})
        self.assertEqual(Fake(active={'id':REQUEST,'kind':'change'}).request_status(PROJECT)['open_request'],
                         {'request_document_id':REQUEST,'plan_placement':None,'plan_stage_position':None})
        self.assertIsNone(Fake(active={'id':REQUEST,'kind':'refund'}).request_status(PROJECT)['open_request'])
        self.assertIsNone(Fake(active=None).request_status(PROJECT)['open_request'])

class HistoryPlacementTests(unittest.TestCase):
    def test_change_groups_show_their_stage_or_new_work_and_others_are_untouched(self):
        class Repo:
            with_plan_placements=Repository.with_plan_placements
            def rows(self,table,params):
                if table=='change_request_plan_placements':return [{'request_document_id':REQUEST,'placement':'stage','stage_position':2}]
                if table=='project_start_stages':return [{'position':2,'title':'Diseño'}]
                raise AssertionError(table)
        groups=Repo().with_plan_placements(PROJECT,[{'group_kind':'change','group_id':REQUEST},{'group_kind':'change','group_id':'other'},{'group_kind':'refund','group_id':'r'}])
        self.assertEqual([(g.get('plan_placement'),g.get('plan_stage_position'),g.get('plan_stage_title')) for g in groups],
                         [('stage',2,'Diseño'),(None,None,None),(None,None,None)])
        self.assertNotIn('plan_placement',groups[2])
