import test from 'node:test';
import assert from 'node:assert/strict';
import {validateCaseSession,installCaseAssistant} from '../case-assistant.mjs';
const context={project:'p',kind:'change',id:'c',revision:'r'};
const session=()=>({id:'session',project_id:'p',case_kind:'change',case_id:'c',revision_id:'r',stale:false,messages:[]});
test('case history rejects other project, request, kind and revision',()=>{
 for(const field of ['project_id','case_kind','case_id','revision_id']){const value=session();value[field]='foreign';assert.throws(()=>validateCaseSession(value,context));}
 assert.equal(validateCaseSession(session(),context).id,'session');
});
test('durable completed answers still require bound evidence',()=>{
 const value=session();value.messages=[{job_id:'job',question:'Scope?',status:'completed',result:{case_context:{session_id:'session',project_id:'p',case_kind:'change',case_id:'c',revision_id:'r'},kind:'project_assistant',project_id:'p',question:'Scope?',status:'answered',answer:'Two revisions.',missing_information:[],citations:[{source_id:'e',quote:'two revisions'}],sources:[]}}];
 assert.throws(()=>validateCaseSession(value,context));
 value.messages[0].result.sources=[{source_id:'e',file_id:'doc',source_kind:'original'}];assert.equal(validateCaseSession(value,context).messages.length,1);
});
function cloud(){const listeners={};const dialog={setAttribute(){},addEventListener(){},remove(){},open:false};return {active:true,navigationOwner:'owner',projectId:'p',document:{createElement:()=>dialog,body:{append(){},classList:{remove(){},add(){}}},addEventListener:(k,fn)=>listeners[k]=fn,removeEventListener(){},querySelector:()=>null},reset(){},notify(){},listeners};}
test('panel starts collapsed without requesting provider and scopes draft by case and revision',()=>{
 const c=cloud();let requests=0;c.request=()=>{requests++;};installCaseAssistant(c);
 let html=c.renderCaseAssistant(context);assert.match(html,/aria-expanded="false"/);assert.equal(requests,0);
 html=c.renderCaseAssistant({...context,id:'other'});assert.match(html,/owner:p:change:other:r/);assert.doesNotMatch(html,/data-case-assistant="owner:p:change:c:r"/);
 c.reset();assert.match(c.renderCaseAssistant({...context,kind:'refund',revision:null}),/data-case-agent-coming-soon/);assert.equal(requests,0);
});
