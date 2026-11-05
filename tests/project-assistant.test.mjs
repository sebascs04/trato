import test from 'node:test';
import assert from 'node:assert/strict';
import {validateProjectAnswer,documentFailurePresentation,documentReviewPresentation,currentDocumentJob,documentSelection,documentScopeMarkup,documentReadingPresentation} from '../project-assistant.mjs';
const answer=()=>({kind:'project_assistant',project_id:'project-a',question:'Scope?',status:'answered',answer:'Two revisions.',missing_information:[],citations:[{source_id:'source-a',quote:'two revisions'}],sources:[{source_id:'source-a',file_id:'file-a',source_kind:'original'}]});
test('answers cannot cross project boundaries',()=>assert.throws(()=>validateProjectAnswer(answer(),'project-b')));
test('every displayed citation requires a recognized bound source',()=>{
 const value=answer();value.sources=[];assert.throws(()=>validateProjectAnswer(value,'project-a'));
 value.sources=[{source_id:'source-a',file_id:'file-a',source_kind:'invented'}];assert.throws(()=>validateProjectAnswer(value,'project-a'));
});
test('summary and original evidence retain distinct source kinds',()=>{
 for(const kind of ['summary','original']){const value=answer();value.sources[0].source_kind=kind;assert.equal(validateProjectAnswer(value,'project-a').sources[0].source_kind,kind);}
});
test('a conversational response can recall statements without inventing documentary citations',()=>{
 const value={...answer(),answer_basis:'conversation',citations:[],sources:[]};assert.equal(validateProjectAnswer(value,'project-a'),value);
 assert.throws(()=>validateProjectAnswer({...value,answer_basis:'documents'},'project-a'));
});
test('a fresh browser restores conversation from the server without local history IDs',async()=>{
 const {installProjectAssistant}=await import('../project-assistant.mjs');
 const panel={innerHTML:'',querySelector:()=>null};const calls=[];
 const cloud={active:true,tab:'asistente',navigationOwner:'owner-a',projectId:'project-a',session:{key:'session'},storage:{getItem:()=>null,setItem(){}},document:{addEventListener(){},removeEventListener(){}},syncChrome(){},notify(){this.renderProjectAssistant(panel);},async request(path){calls.push(path);return {entries:[{id:'turn-1',position:1,result:answer()}],next_before:null};}};
 const dispose=installProjectAssistant(cloud);cloud.renderProjectAssistant(panel);
 await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['/api/v1/projects/project-a/assistant/conversation']);assert.match(panel.innerHTML,/Two revisions\./);assert.doesNotMatch(panel.innerHTML,/data-assistant-action="clear"/);dispose();
});

test('document preparation errors are distinct from inventory and conversation failures',()=>{
 assert.deepEqual(documentFailurePresentation('',{status:'failed',error:'FILE_PIPELINE_FAILED'}),{inventory:null,preparation:'prepareFailed'});
 assert.deepEqual(documentFailurePresentation('PERSISTENCE_UNAVAILABLE',null),{inventory:'documentsInventoryFailure',preparation:null});
 assert.deepEqual(documentFailurePresentation('PERSISTENCE_UNAVAILABLE',{status:'failed',error:'FILE_PIPELINE_FAILED'}),{inventory:'documentsInventoryFailure',preparation:'prepareFailed'});
});
test('same known underlying document failure is presented once',()=>{
 assert.deepEqual(documentFailurePresentation('FILE_PIPELINE_FAILED',{status:'failed',error:'FILE_PIPELINE_FAILED'}),{inventory:'documentsSharedFailure',preparation:null});
 assert.deepEqual(documentFailurePresentation('AI_REQUEST_FAILED',{status:'failed',error:'AI_REQUEST_FAILED'}),{inventory:'documentsInventoryFailure',preparation:'prepareFailed'});
});
test('uncertain preparation never claims a confirmed failure or readiness',()=>{
 assert.equal(documentFailurePresentation('',{status:'unavailable',error:'AI_REQUEST_FAILED'}).preparation,'prepareUnconfirmed');
 for(const status of ['queued','running','completed'])assert.equal(documentFailurePresentation('',{status,error:'FILE_PIPELINE_FAILED'}).preparation,null);
});

test('document review shows actual natural reason only for completed review outcomes',()=>{
 for(const status of ['needs_clarification','rejected']){
  const value=documentReviewPresentation({status:'completed',result:{status,treatment:{reason:'Falta especificar el alcance.'}}});assert.equal(value.reason,'Falta especificar el alcance.');assert.ok(value.label);
 }
 for(const reason of ['PURPOSE_BINDING_REQUIRED','',null,undefined])assert.equal(documentReviewPresentation({status:'completed',result:{status:'needs_clarification',treatment:{reason}}}).reason,'');
 for(const status of ['queued','running','failed','unavailable'])assert.equal(documentReviewPresentation({status,result:{status:'needs_clarification',treatment:{reason:'Pending'}}}),null);
 assert.equal(documentReviewPresentation({status:'completed',result:{status:'processed'}}),null);
});

test('document preparation snapshots never migrate to a changed source generation',()=>{
 const job={status:'completed',result:{status:'processed'}};
 assert.equal(currentDocumentJob({generation:'one'},{generation:'one',job}),job);
 assert.equal(currentDocumentJob({generation:'two'},{generation:'one',job}),null);
 assert.equal(currentDocumentJob({generation:'one'},null),null);
});

test('ready source selection is explicit and lists every excluded document',()=>{
 const files=[{id:'a',title:'Agreement',summary_status:'ready'},{id:'b',title:'Pending acceptance',summary_status:'pending'}];
 const choice=documentSelection(files);assert.deepEqual(choice.ready.map(file=>file.id),['a']);assert.deepEqual(choice.excluded.map(file=>file.id),['b']);
 const selected=documentScopeMarkup(files,choice.ready,'data-scope');assert.match(selected,/Agreement/);assert.match(selected,/Pending acceptance/);assert.doesNotMatch(selected,/data-scope="use-ready"/);
 assert.throws(()=>documentSelection([...files,files[0]]));
});

test('reading state distinguishes an unqueued source from a real thread and an extraction error',()=>{
 const file={status:'source_pending',extraction_status:'queued',extraction_job_id:null};
 assert.equal(documentReadingPresentation(file).action,'startReading');assert.equal(documentReadingPresentation(file).busy,false);
 assert.equal(documentReadingPresentation({...file,extraction_job_id:'job'}).busy,true);
 assert.equal(documentReadingPresentation({...file,extraction_status:'error'}).action,'retryReading');
 assert.equal(documentReadingPresentation(file,{status:'failed'}).error,'readingUnconfirmed');
 assert.equal(documentReadingPresentation({status:'index_pending'}),null);
 assert.deepEqual(documentReadingPresentation({...file,extraction_status:'error',extraction_error_code:'EXTRACTION_TEXT_MISSING'}),{label:'documentReviewRequired',action:null,error:'readingTextMissing',busy:false});
});
