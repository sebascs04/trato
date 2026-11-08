"""Which step a document's processing is on, from the stages already recorded in Supabase.

Processing always runs extraction → treatment → chunks → summary → indexing, and every finished stage leaves a
file_processing_artifacts row; an 'outcome' row closes a run. Only the stages after the latest outcome belong to the
run in progress, so a reprocessed document never mixes old and new stages. Read-only, one grouped query.
"""
from .persistence import uuid

STEPS=('extracting','analyzing','chunking','summarizing','indexing')
# Last finished stage → the step now running.
NEXT={None:'extracting','extraction':'analyzing','treatment':'chunking','chunks':'summarizing','summary':'indexing'}
ORDER=('extraction','treatment','chunks','summary')


def processing_progress(repo,owner_id,project_id,document_ids):
    """{document_id: {'processing_stage','processing_step','processing_steps'}} for documents with a run in progress.

    A document whose latest run already produced its outcome is left out; its readiness or error is reported as before.
    """
    ids=sorted({uuid(i) for i in document_ids})
    if not ids:return {}
    runs={i:{'stages':set(),'closed':False} for i in ids}
    for start in range(0,len(ids),50):
        rows=repo.rows('file_processing_artifacts',{'select':'document_id,stage,created_at',
            'document_id':'in.('+','.join(ids[start:start+50])+')','project_id':'eq.'+uuid(project_id),'owner_id':'eq.'+uuid(owner_id),
            'stage':'in.(extraction,treatment,chunks,summary,outcome)','order':'created_at.asc,stage.asc','limit':1000})
        for row in rows:
            run=runs.get(row.get('document_id'))
            if run is None:continue
            if row['stage']=='outcome':run['stages']=set();run['closed']=True
            else:run['stages'].add(row['stage']);run['closed']=False
    progress={}
    for doc_id,run in runs.items():
        if run['closed']:continue
        done=[stage for stage in ORDER if stage in run['stages']]
        stage=NEXT[done[-1] if done else None]
        progress[doc_id]={'processing_stage':stage,'processing_step':STEPS.index(stage)+1,'processing_steps':len(STEPS)}
    return progress
