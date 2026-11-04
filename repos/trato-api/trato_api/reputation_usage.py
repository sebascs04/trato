"""Confirmed plan usage is written only by the server, never a browser counter."""
from .thread_store import ThreadStore
from .errors import ApiError


def record_plan_usage(settings,owner,project_id,job_id,context):
    if not context.get('reviews'):
        return
    value=ThreadStore(settings).repo.rpc('record_reputation_plan_usage',{
        'p_owner':owner,'p_project':project_id,'p_job':job_id})
    if value!={'recorded':True}:
        raise ApiError('AI_PLAN_USAGE_NOT_RECORDED',502)
