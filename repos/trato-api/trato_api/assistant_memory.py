"""Durable conversation state; only the backend can select owner and project."""
from .thread_store import ThreadStore

class AssistantMemory:
 def __init__(self,settings,repo=None):self.settings=settings;self.repo=repo
 def call(self,owner,project,action,data=None):
  repo=self.repo if self.repo is not None else ThreadStore(self.settings).repo
  return repo.rpc('project_assistant_memory_backend',{'p_owner':owner,'p_project':project,'p_action':action,'p_data':data or {}})
