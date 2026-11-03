const {test}=require('node:test');
const assert=require('node:assert/strict');
// Minimal dialog fixture for controller/state tests; visual behavior is tested in app.
function installWithDialog(install,cloud){
 const dialog={innerHTML:'',open:false,setAttribute(){},addEventListener(){},close(){this.open=false;},showModal(){this.open=true;},contains(){return false;},querySelector(){return {set outerHTML(value){},innerHTML:'',focus(){}};},querySelectorAll(){return [];},insertAdjacentHTML(where,html){this.innerHTML+=html;}};
 cloud.document={activeElement:null,body:{append(){}},createElement(){return dialog;}};cloud.modal={addEventListener(){}};cloud.projects=[];install(cloud);return dialog;
}
const form=()=>import('../refund-form.mjs');
test('USD parsing rejects rounding, grouping, signs, exponent notation and unsafe amounts',async()=>{
 const {parseRefundMoney}=await form();
 assert.equal(parseRefundMoney('120,50'),12050);assert.equal(parseRefundMoney('120.5'),12050);
 for(const value of ['1,000.00','-1','1.001','1e2','NaN','Infinity','1000000000.00','',true])assert.throws(()=>parseRefundMoney(value));
});
test('percentages round half up and require a nonzero rate no greater than 100%',async()=>{
 const {percentageMinor}=await form();
 assert.deepEqual(percentageMinor('1.01','50'),{base_minor:101,basis_points:5000,amount_minor:51});
 for(const [base,rate] of [['0','10'],['1','0'],['1','100.01']])assert.throws(()=>percentageMinor(base,rate));
});
test('total partial zero and previously refunded amounts are not counted twice',async()=>{
 const {previewRefund}=await form();
 const item={concept_id:'work',kind:'recognized_work',beneficiary:'seller',amount_minor:12000};
 assert.equal(previewRefund(30000,0,[]).refund_minor,30000);
 assert.equal(previewRefund(30000,5000,[item]).refund_minor,13000);
 assert.equal(previewRefund(30000,0,[{...item,amount_minor:30000}]).refund_minor,0);
 assert.equal(previewRefund(30000,0,[{...item,amount_minor:31000}]).additional_payment_due_minor,1000);
 assert.throws(()=>previewRefund(30000,5000,[{...item,amount_minor:30000}]));
});
test('duplicate concepts and unfunded customer credits fail visibly',async()=>{
 const {previewRefund}=await form();
 const item={concept_id:'penalty',kind:'penalty',beneficiary:'seller',amount_minor:3000};
 assert.throws(()=>previewRefund(30000,0,[item,item]));
 assert.throws(()=>previewRefund(30000,0,[{...item,beneficiary:'customer'}]));
});
test('proposal requires actual evidence and conditions; keeps concept identities',async()=>{
 const {buildRefundTerms}=await import('../refund-workspace.mjs');
 const editor={conditions:'Review',items:[{concept_id:'stable',kind:'penalty',beneficiary:'seller',description:'Clause',mode:'fixed',amount:'30',evidence:[]}]};
 assert.throws(()=>buildRefundTerms(editor,{amount_minor:30000,local_previous_refunds_minor:0}));
 editor.items[0].evidence=[{quote:'Cancellation fee: USD 30.'}];
 assert.equal(buildRefundTerms(editor,{amount_minor:30000,local_previous_refunds_minor:0}).terms.adjustments[0].concept_id,'stable');
});
test('renders saved snapshots and editor without translating document data or injecting markup',async()=>{
 const {installRefundWorkspace}=await import('../refund-workspace.mjs');
 const cloud={active:true,projectId:'project',session:{session:{user:{id:'owner'}}},documents:[],reset(){},notify(){},sourceReady(){return true},storage:{getItem(){return null}},async request(path){
  if(path.endsWith('request-status'))return {can_register:true};return [];
 }};
 const dialog=installWithDialog(installRefundWorkspace,cloud);const panel={innerHTML:'',contains(){return false;}};cloud.renderRefunds(panel);await new Promise(setImmediate);
 const s=cloud.refundState;
 const snap={id:'snap',settlement_id:'parent',version_no:1,draft_sequence:2,created_at:'2026-11-01T12:00:00Z',breakdown:{refund_minor:30000},terms:{conditions:'<img src=x onerror=alert(1)>',adjustments:[]}};
 s.detail={settlement:{id:'parent',project_id:'project',payment_id:'payment',status:'draft',current_snapshot_id:'snap',request_evidence:[],reason:'Client text'},snapshots:[snap]};s.snapshot=snap;s.view='detail';s.wizardOpen=true;s.step=2;
 s.payments=[{id:'payment',amount_minor:30000,local_previous_refunds_minor:0}];cloud.renderRefunds(panel);
 assert.match(dialog.innerHTML,/instantánea interna 2/);assert.ok(!dialog.innerHTML.includes('<img src=x'));
 assert.match(dialog.innerHTML,/&lt;img/);
 s.editor={conditions:'Review',reviewed:false,items:[{concept_id:'item',kind:'penalty',beneficiary:'seller',description:'Clause',mode:'percent',base:'300',rate:'10',evidence:[]}]};cloud.renderRefunds(panel);
 assert.match(dialog.innerHTML,/Base monetaria en USD/);
});
test('late detail responses cannot replace the state of another project',async()=>{
 const {installRefundWorkspace}=await import('../refund-workspace.mjs');
 let release;const delayed=new Promise(resolve=>release=resolve);
 const cloud={active:true,projectId:'a',session:{session:{user:{id:'owner'}}},documents:[],reset(){},notify(){},sourceReady(){return true},storage:{getItem(){return null}},async request(path){
  if(path==='/api/v1/refunds/parent'){await delayed;return {settlement:{id:'parent',project_id:'a',current_snapshot_id:null}};}
  return path.endsWith('request-status')?{can_register:true}:[];
 }};
 const dialog=installWithDialog(installRefundWorkspace,cloud);const panel={innerHTML:'',contains(){return false;}};cloud.renderRefunds(panel);await new Promise(setImmediate);cloud.renderRefunds(panel);
 panel.onclick({target:{closest(){return {dataset:{refundAction:'open',id:'parent'}};}},preventDefault(){}});
 cloud.projectId='b';cloud.renderRefunds(panel);release();await new Promise(setImmediate);
 assert.equal(cloud.refundState.project,'b');assert.equal(cloud.refundState.detail,null);
});
test('supporting PDF upload remains a reference even when another request is open',async()=>{
 const {ConnectedWorkspace}=await import('../connected-workspace.mjs');
 const cloud=new ConnectedWorkspace({document:{},location:{origin:'http://localhost:5173',search:''},fetchFn:async()=>{},storage:{}});
 cloud.projectId='p';cloud.projects=[{id:'p'}];cloud.requestStatus={can_register:false};
 let markup='';cloud.show=(title,html)=>{markup=html;};cloud.openSource('reference');
 assert.match(markup,/name="kind" value="reference"/);assert.match(markup,/accept=".pdf"/);
 assert.ok(!markup.includes('value="email_request"'));
});
test('idempotency conflict preserves pending identity and immutable retry payload without storing terms',async()=>{
 const {installRefundWorkspace}=await import('../refund-workspace.mjs');
 globalThis.crypto??=require('node:crypto').webcrypto;
 const storage=new Map();
 const cloud={active:true,projectId:'project',session:{session:{user:{id:'owner'}}},documents:[],reset(){},notify(){},sourceReady(){return true},json:body=>({method:'POST',body:JSON.stringify(body)}),storage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},async request(path,options){
  if(options){const error=Error('conflict');error.status=409;error.code='IDEMPOTENCY_KEY_CONFLICT';throw error;}
  return path.endsWith('request-status')?{can_register:true}:[];
 }};
 const dialog=installWithDialog(installRefundWorkspace,cloud);const panel={innerHTML:'',contains(){return false;}};cloud.renderRefunds(panel);await new Promise(setImmediate);
 const s=cloud.refundState;s.view='detail';s.wizardOpen=true;s.step=2;s.detail={settlement:{id:'parent',project_id:'project',payment_id:'payment',status:'draft',current_snapshot_id:null,request_evidence:[]},snapshots:[]};
 s.payments=[{id:'payment',amount_minor:30000,local_previous_refunds_minor:0}];s.editor={items:[],conditions:'Private settlement terms',reviewed:true};cloud.renderRefunds(panel);
 dialog.onsubmit({target:{dataset:{refundForm:'draft'}},preventDefault(){},stopPropagation(){}});await new Promise(setImmediate);
 assert.ok(s.pending);assert.equal(s.pending.action,'edit_draft');
 s.editor.conditions='Changed afterwards';assert.equal(s.pendingBody.terms.conditions,'Private settlement terms');
 assert.ok(![...storage.values()][0].includes('Private settlement terms'));
});
test('global closure allocates automatically within each remaining balance and rounds cents without losing the total',async()=>{
 const {buildRefundTerms}=await import('../refund-workspace.mjs');const {allocateRefund}=await form();
 const payment={scope:'project_closure',amount_minor:40000,local_previous_refunds_minor:5000,members:[{id:'initial',amount_minor:10000,local_previous_refunds_minor:5000},{id:'change',amount_minor:30000,local_previous_refunds_minor:0}]};
 const editor={conditions:'Global closure',items:[],allocations:[]};
 assert.deepEqual(buildRefundTerms(editor,payment).terms.allocations,[{payment_id:'initial',refund_minor:5000},{payment_id:'change',refund_minor:30000}]);
 const parts=allocateRefund(1,[{id:'a',amount_minor:1,local_previous_refunds_minor:0},{id:'b',amount_minor:1,local_previous_refunds_minor:0}]);assert.deepEqual(parts,[{payment_id:'a',refund_minor:1},{payment_id:'b',refund_minor:0}]);
 assert.throws(()=>allocateRefund(35001,payment.members));
 assert.throws(()=>allocateRefund(1,[{id:'a',amount_minor:1,local_previous_refunds_minor:2}]));
 assert.equal(buildRefundTerms({conditions:'Single',items:[]},{amount_minor:30000,local_previous_refunds_minor:0}).terms.allocations,undefined);
});
