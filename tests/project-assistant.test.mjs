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
 const cloud={active:true,tab:'asistente',navigationOwner:'owner-a',projectId:'project-a',profile:{textContent:'SE'},session:{key:'session'},storage:{getItem:()=>null,setItem(){}},document:{addEventListener(){},removeEventListener(){}},syncChrome(){},notify(){this.renderProjectAssistant(panel);},async request(path){calls.push(path);return {entries:[{id:'turn-1',position:1,result:answer()}],next_before:null};}};
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

for(const status of ['queued','failed'])test(`a ${status} question replaces welcome and stays inside the scrolling conversation`,async()=>{
 const {installProjectAssistant}=await import('../project-assistant.mjs');
 const events=new Map(),scroll={scrollTop:0,scrollHeight:960};
 const panel={innerHTML:'',querySelector:()=>scroll};
 const job={id:'job-pending',status,result:null,error:status==='failed'?'VECTOR_INDEX_INCOMPLETE':null,uncertain:false,path:'/api/v1/ai/project-questions',payload:{project_id:'project-a',question:'¿Qué acordamos entregar?',output_language:'es'}};
 const cloud={active:true,tab:'asistente',navigationOwner:'owner-a',projectId:'project-a',profile:{textContent:'SE'},session:{key:'session'},storage:{getItem:key=>key.includes(':ai-job:')?JSON.stringify({version:1,owner:'owner-a',state:job}):null,setItem(){}},document:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener(){}},syncChrome(){},notify(){this.renderProjectAssistant(panel);},async request(path){if(path.endsWith('/conversation'))return {entries:[],next_before:null};return {id:job.id,status:'queued'};}};
 const dispose=installProjectAssistant(cloud);cloud.renderProjectAssistant(panel);await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(panel.innerHTML,/project-assistant-empty|data-assistant-action="open-sources"|data-agent-document-choice/);
 assert.match(panel.innerHTML,/data-pending-question/);assert.match(panel.innerHTML,/¿Qué acordamos entregar\?/);
 assert.match(panel.innerHTML,/project-assistant-user-avatar[^>]*>SE<\/span>/);
 if(status==='failed'){assert.match(panel.innerHTML,/project-assistant-retry/);assert.doesNotMatch(panel.innerHTML,/cloud-error|Revisa su procesamiento|VECTOR_INDEX_INCOMPLETE/);}
 const logEnd=panel.innerHTML.indexOf('</div><form data-project-question>');assert.ok(logEnd>0);
 const marker=status==='queued'?'aria-busy="true"':'role="alert"';assert.ok(panel.innerHTML.indexOf(marker)<logEnd);
 assert.equal(scroll.scrollTop,scroll.scrollHeight);
 events.get('scroll')({target:{matches:()=>true,scrollTop:100,scrollHeight:1000,clientHeight:200}});cloud.renderProjectAssistant(panel);assert.equal(scroll.scrollTop,100);
 dispose();
});

test('a completed reply replaces the pending question without duplication and follows the newest answer',async()=>{
 const {installProjectAssistant}=await import('../project-assistant.mjs');
 const scroll={scrollTop:0,scrollHeight:1200},panel={innerHTML:'',querySelector:()=>scroll};
 const job={id:'job-pending',status:'running',result:null,error:null,uncertain:false,path:'/api/v1/ai/project-questions',payload:{project_id:'project-a',question:'Scope?',output_language:'en'}};
 const cloud={active:true,tab:'asistente',navigationOwner:'owner-a',projectId:'project-a',profile:{textContent:'SE'},session:{key:'session'},storage:{getItem:key=>key.includes(':ai-job:')?JSON.stringify({version:1,owner:'owner-a',state:job}):null,setItem(){}},document:{addEventListener(){},removeEventListener(){}},syncChrome(){},notify(){this.renderProjectAssistant(panel);},async request(path){return path.endsWith('/conversation')?{entries:[],next_before:null}:{id:job.id,status:'completed',result:answer()};}};
 const dispose=installProjectAssistant(cloud);cloud.renderProjectAssistant(panel);await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel.innerHTML,/Two revisions\./);assert.equal((panel.innerHTML.match(/Scope\?/g)||[]).length,1);
 assert.doesNotMatch(panel.innerHTML,/data-pending-question|project-assistant-empty|aria-busy="true"/);assert.equal(scroll.scrollTop,1200);dispose();
});

test('opening sources of an earlier reply preserves its reading position and never jumps to the composer',async()=>{
 const {installProjectAssistant}=await import('../project-assistant.mjs');
 const events=new Map(),calls=[];
 const chat={scrollTop:0,scrollHeight:1400,clientHeight:400};
 const form={scrollIntoView:()=>{throw Error('Source reading must not reveal the composer');}};
 const summary={scrollIntoView:options=>calls.push(options)};
 const panel={innerHTML:'',querySelector:()=>chat};
 const cloud={active:true,tab:'asistente',navigationOwner:'owner-a',projectId:'project-a',session:{key:'session'},storage:{getItem:()=>null,setItem(){}},document:{addEventListener:(name,fn)=>events.set(name,fn),removeEventListener(){},defaultView:{scrollY:500}},syncChrome(){},notify(){this.renderProjectAssistant(panel);},async request(){return {entries:[{id:'turn-1',position:1,result:answer()}],next_before:null};}};
 const dispose=installProjectAssistant(cloud);cloud.renderProjectAssistant(panel);await new Promise(resolve=>setImmediate(resolve));
 const details={open:true,isConnected:true,matches:()=>true,querySelector:()=>summary,closest:selector=>selector==='.project-assistant-log'?chat:{querySelector:()=>form}};
 chat.scrollTop=180;events.get('toggle')({target:details});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(chat.scrollTop,180);assert.deepEqual(calls,[{block:'nearest',behavior:'instant'}]);
 cloud.renderProjectAssistant(panel);assert.equal(chat.scrollTop,180);
 details.open=false;chat.scrollTop=150;events.get('toggle')({target:details});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(calls.length,1);cloud.renderProjectAssistant(panel);assert.equal(chat.scrollTop,150);dispose();
});

test('restored last question stays hidden until history and the current job have both loaded',async()=>{
 const {installProjectAssistant}=await import('../project-assistant.mjs');
 const frames=[],scrolls=[];
 let resolveHistory,resolveJob;const panel={innerHTML:'',querySelector:()=>null};
 const saved={id:'job-restored',status:'running',payload:{question:'Most recent question'}};
 const cloud={active:true,tab:'asistente',navigationOwner:'owner-a',projectId:'project-a',session:{key:'session'},storage:{getItem:key=>key.includes(':ai-job:')?JSON.stringify({version:1,owner:'owner-a',state:saved}):null,setItem(){}},document:{addEventListener(){},removeEventListener(){},defaultView:{scrollY:0,requestAnimationFrame:callback=>frames.push(callback)},querySelector:()=>({scrollIntoView:options=>scrolls.push(options)})},syncChrome(){},notify(){this.renderProjectAssistant(panel);},request(path){return new Promise(resolve=>{if(path.endsWith('/conversation'))resolveHistory=resolve;else resolveJob=resolve;});}};
 const dispose=installProjectAssistant(cloud);cloud.renderProjectAssistant(panel);
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel.innerHTML,/aria-busy="true"/);assert.doesNotMatch(panel.innerHTML,/Most recent question|project-assistant-empty/);
 resolveHistory({entries:[{id:'turn-1',position:1,result:answer()}],next_before:null});
 await new Promise(resolve=>setImmediate(resolve));
 assert.doesNotMatch(panel.innerHTML,/Two revisions\.|Most recent question/);
 resolveJob({id:saved.id,status:'running'});await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel.innerHTML,/Two revisions\./);assert.match(panel.innerHTML,/Most recent question/);
 assert.equal(scrolls.length,0);assert.equal(frames.length,1);frames.shift()();
 assert.deepEqual(scrolls,[{block:'end',behavior:'instant'}]);dispose();
});
