import test from 'node:test';
import assert from 'node:assert/strict';
import {validateDisputes,renderDispute} from '../dispute-workspace.mjs';

const dispute={dispute_id:'PP-R-VHD-10197086',reason:'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED',status:'WAITING_FOR_SELLER_RESPONSE',stage:'INQUIRY',
 amount:{value:'120.00',currency:'USD'},response_due:'2099-11-28T06:09:01.643Z',messages:[{by:'BUYER',at:'2026-11-08T06:09:01Z',text:'Not <b>as</b> described.'}],
 actions:['send_message'],payment:{capture_id:'6YT21169SK952354J',origin:'change',amount_minor:12000,currency:'USD',verified_at:'2026-11-08T04:17:07Z'}};

test('disputes must belong to the project that was asked for',()=>{
 const value={project_id:'p1',payments_checked:2,disputes:[dispute]};
 assert.equal(validateDisputes(value,'p1'),value);
 assert.throws(()=>validateDisputes(value,'p2'));
 assert.throws(()=>validateDisputes({...value,disputes:[{...dispute,payment:null}]},'p1'));
});

test('a dispute card shows reason, amount, deadline and the client message, escaped',()=>{
 const html=renderDispute(dispute);
 assert.match(html,/PP-R-VHD-10197086/);
 assert.match(html,/disputes\.reason|no es lo acordado|not what was agreed/);
 assert.doesNotMatch(html,/<b>as<\/b>/);
});

const defense={kind:'dispute_defense',dispute_id:'PP-R-1',assessment:'partial',summary:'Accepted; delivery unproven.',recommended_action:'send_message',response_message:'What is missing?',gaps:['No proof of <delivery>.'],points:[{claim:'Accepted',kind:'acceptance',at:'2026-11-08T04:12:10Z',quote:'accepted version 1'}],documents:[{id:'d1',title:'Addendum <v1>',kind:'addendum',sendable:true,consulted:true,recommended:true,reason:'Defines the scope.'},{id:'d2',title:'Video',kind:'other',sendable:false,consulted:false,recommended:false,reason:''}]};
test('a prepared response must belong to this dispute and is rendered escaped, marked as not sent',async()=>{
 const {validateDefense,renderDefense}=await import('../dispute-workspace.mjs');
 assert.equal(validateDefense(defense,'PP-R-1'),defense);
 assert.throws(()=>validateDefense(defense,'PP-R-2'));
 assert.throws(()=>validateDefense({...defense,points:[{claim:'x'}]},'PP-R-1'));
 const html=renderDefense(defense,'<edited>',{status:'idle',allowed:true,selected:[]});
 assert.match(html,/&lt;edited&gt;<\/textarea>/);assert.match(html,/No proof of &lt;delivery&gt;\./);assert.match(html,/accepted version 1/);
 
 const open=renderDefense(defense,'x',{status:'idle',allowed:true,selected:['d1']});assert.match(open,/data-defense-action="send"/);assert.match(open,/data-defense-action="documents"/);
 const {renderSendConfirm}=await import('../dispute-workspace.mjs');assert.match(renderSendConfirm({selected:['d1']}),/data-confirm-send/);assert.doesNotMatch(open,/data-confirm-send/);
 const sent=renderDefense(defense,'x',{status:'sent',allowed:true,selected:['d1'],attachment:'sent',documentsSent:1});assert.doesNotMatch(sent,/data-defense-action="send(-confirm)?"/);assert.match(sent,/data-defense-action="send-another"/);assert.doesNotMatch(sent,/<textarea/);assert.match(sent,/dispute-sent-text/);
});
test('the response button only appears when PayPal still allows an answer on an addendum payment',()=>{
 assert.match(renderDispute(dispute),/data-dispute-defense="PP-R-VHD-10197086"/);
 assert.doesNotMatch(renderDispute({...dispute,status:'RESOLVED'}),/data-dispute-defense/);
 assert.doesNotMatch(renderDispute({...dispute,actions:['appeal']}),/data-dispute-defense/);
 assert.doesNotMatch(renderDispute({...dispute,payment:{...dispute.payment,origin:'initial'}}),/data-dispute-defense/);
});

test('what PayPal already holds prevents an accidental second send, on any device',async()=>{
 const {renderDefense,lastSellerMessage}=await import('../dispute-workspace.mjs');
 const previous=lastSellerMessage({messages:[{by:'SELLER',at:'2026-11-08T10:00:00Z',text:'First'},{by:'BUYER',text:'No'},{by:'SELLER',at:'2026-11-08T11:00:00Z',text:'Second <b>'}]});
 assert.equal(previous.at,'2026-11-08T11:00:00Z');
 assert.equal(lastSellerMessage({messages:[{by:'BUYER',text:'No'}]}),null);
 const html=renderDefense(defense,'x',{status:'idle',allowed:true,selected:[],previous});
 assert.match(html,/Second &lt;b&gt;/);assert.match(html,/data-defense-action="send-another"/);
 assert.doesNotMatch(renderDefense(defense,'x',{status:'idle',allowed:false,selected:[],previous}),/data-defense-action="send/);
});
test('after a reload an interrupted send is never shown as unsent, and a finished one stays finished',async()=>{
 const {renderDefense,restoredSend}=await import('../dispute-workspace.mjs');
 assert.equal(restoredSend({status:'sending',selected:['d1']}).status,'uncertain');
 assert.equal(restoredSend({status:'confirm',selected:['d1']}).status,'idle');
 assert.deepEqual(restoredSend({status:'sent',selected:['d1',7],attachment:'sent',documentsSent:1}),{status:'sent',selected:['d1'],attachment:'sent',documentsSent:1});
 assert.equal(restoredSend(null).status,'idle');
 const uncertain=renderDefense(defense,'x',{...restoredSend({status:'sending'}),allowed:true});
 assert.doesNotMatch(uncertain,/data-defense-action="send"/);assert.match(uncertain,/data-defense-action="send-another"/);assert.doesNotMatch(uncertain,/<textarea/);
 assert.equal(restoredSend({status:'partial',selected:[]}).status,'sent');
});

test('the document list shows suggestions and blocks what PayPal cannot receive',async()=>{
 const {renderDocumentChoices,validateDefense}=await import('../dispute-workspace.mjs');
 const html=renderDocumentChoices(defense.documents,['d1']);
 assert.match(html,/data-dispute-doc="d1" checked/);assert.match(html,/Addendum &lt;v1&gt;/);assert.match(html,/Defines the scope\./);
 assert.match(html,/data-dispute-doc="d2"  disabled/);
 assert.throws(()=>validateDefense({...defense,documents:[{id:'d1'}]},'PP-R-1'));
 assert.throws(()=>validateDefense({...defense,documents:undefined},'PP-R-1'));
});

test('after a reply only the sent message and the way to write another remain; the analysis folds away',async()=>{
 const {renderDefense,renderSendConfirm,needsAnalysis}=await import('../dispute-workspace.mjs');
 const previous={by:'SELLER',at:'2026-11-08T18:00:00Z',text:'My reply'};
 const after=renderDefense(defense,'old draft',{status:'idle',allowed:true,selected:[],previous});
 assert.match(after,/My reply/);assert.match(after,/<details class="dispute-analysis-more"/);assert.match(after,/data-defense-action="send-another"/);
 for(const hidden of [/data-defense-action="again"/,/data-defense-action="documents"/,/<textarea/,/old draft/])assert.doesNotMatch(after,hidden);
 const compose=renderDefense(defense,'',{status:'idle',allowed:true,selected:[],previous,composing:true});
 assert.match(compose,/<textarea/);assert.match(compose,/data-defense-action="documents"/);assert.match(compose,/data-defense-action="send"/);
 assert.doesNotMatch(compose,/data-defense-action="again"/);assert.doesNotMatch(compose,/compose-cancel/);
 assert.ok(compose.indexOf('dispute-send-row')<compose.indexOf('data-defense-action="documents"'),'both buttons share one row');
 const replied=renderDefense(defense,'',{status:'idle',allowed:true,selected:[],previous,needsAnalysis:true});
 assert.match(replied,/data-defense-action="again"/);assert.doesNotMatch(replied,/data-defense-action="send-another"/);
 const round=renderDefense(defense,'New draft',{status:'idle',allowed:true,selected:[],previous,fresh:true});
 assert.match(round,/New draft<\/textarea>/);assert.doesNotMatch(round,/<details/);
 assert.match(renderDefense(null,'',{status:'idle',allowed:true,selected:[],previous}),/My reply/);
 assert.ok(renderSendConfirm({selected:[]}).includes('dispute-confirm-note'));
 const seller={by:'SELLER',text:'x'},buyer={by:'BUYER',text:'y'};
 assert.equal(needsAnalysis({messages:[buyer]}),true);assert.equal(needsAnalysis({messages:[buyer,seller]}),false);assert.equal(needsAnalysis({messages:[buyer,seller,buyer]}),true);assert.equal(needsAnalysis(null),false);
 assert.equal(needsAnalysis({messages:[buyer,seller],actions:['provide_evidence']}),true,'PayPal asking for evidence calls for a new analysis');
 const asked=renderDefense(defense,'For the reviewer',{status:'idle',allowed:false,selected:[],previous,fresh:true,actions:['provide_evidence']});
 assert.ok(asked.includes('data-defense-action="evidence-send"'));assert.ok(asked.includes('For the reviewer'));assert.ok(!asked.includes('data-defense-action="send"'));
 const submitted=renderDefense(defense,'',{status:'idle',allowed:false,selected:[],previous,fresh:true,actions:[],notice:'evidenceDone'});
 assert.ok(!submitted.includes('data-dispute-draft'),'after the evidence goes out the form closes');
 assert.ok(asked.includes('data-defense-action="evidence-send"')&&!asked.includes('data-defense-action="accept"'),'accepting appears only when PayPal offers it');
 const refundable=renderDefense(defense,'x',{status:'idle',allowed:true,selected:[],actions:['send_message','accept_claim']});
 assert.ok(refundable.includes('data-defense-action="accept"'));
 const accepted=renderDefense(defense,'',{status:'idle',allowed:false,selected:[],previous,fresh:true,actions:[],notice:'acceptDone'});
 assert.ok(!accepted.includes('data-dispute-draft'),'accepting closes the draft');
});

test('the card only offers the conversation, which opens in a side panel',async()=>{
 const {renderConversation}=await import('../dispute-workspace.mjs');
 const messages=[{by:'BUYER',at:'2026-11-08T06:00:00Z',text:'First claim',documents:[]},{by:'SELLER',at:'2026-11-08T18:00:00Z',text:'Latest reply',documents:['scope <v1>.pdf']}];
 const html=renderDispute({...dispute,messages});
 assert.doesNotMatch(html,/First claim|Latest reply|data-dispute-docs/);
 assert.match(html,/data-dispute-conversation="PP-R-VHD-10197086"/);
 const panel=renderConversation({...dispute,messages});
 assert.match(panel,/First claim/);assert.match(panel,/Latest reply/);assert.match(panel,/data-dispute-docs="PP-R-VHD-10197086" data-message-index="1"/);
 assert.doesNotMatch(renderDispute({...dispute,messages:[]}),/data-dispute-conversation/);
});
test('the document list invites new proof and marks what the freelancer added',async()=>{
 const {renderDocumentChoices}=await import('../dispute-workspace.mjs');
 const added={id:'n1',title:'Delivery note',kind:'delivery',sendable:true,consulted:false,recommended:false,reason:'',added:true};
 const html=renderDocumentChoices([added],['n1']);
 assert.match(html,/data-docs-upload/);assert.match(html,/data-dispute-doc="n1" checked/);assert.doesNotMatch(html,/dispute-doc-unread/);
 assert.match(renderDocumentChoices([],[],{busy:true}),/data-docs-upload hidden disabled/);
 assert.match(renderDocumentChoices([],[],{error:'format'}),/role="alert"/);
});

test('further steps appear only with the link PayPal offers',async()=>{
 const {actionsMarkup,renderDefense}=await import('../dispute-workspace.mjs');
 assert.equal(actionsMarkup({actions:['send_message']}),'');
 assert.match(actionsMarkup({actions:['escalate']}),/data-defense-action="escalate"/);
 const review=actionsMarkup({actions:['provide_evidence','require_evidence','adjudicate']});
 assert.match(review,/data-defense-action="evidence"/);assert.match(review,/data-sandbox-step="require_evidence"/);assert.match(review,/data-sandbox-step="seller_favor"/);assert.match(review,/data-sandbox-step="buyer_favor"/);
 assert.match(actionsMarkup({actions:[],notice:'errorRejected'}),/cloud-error/);
 const evidence=renderDefense(null,'',{status:'idle',allowed:false,selected:['d1'],mode:'evidence',actions:['provide_evidence']});
 assert.match(evidence,/data-defense-action="evidence-send"/);assert.match(evidence,/data-defense-action="documents"/);
});

test('escalating is offered last, after everything else in the panel',async()=>{
 const {renderDefense}=await import('../dispute-workspace.mjs');
 const html=renderDefense(defense,'x',{status:'sent',allowed:true,selected:[],attachment:'none',actions:['send_message','escalate','adjudicate']});
 const position=html.indexOf('data-defense-action="escalate"');
 assert.ok(position>html.indexOf('dispute-analysis-more'));assert.ok(position>html.indexOf('data-sandbox-step'));assert.ok(position>html.indexOf('data-defense-action="send-another"'));
});
