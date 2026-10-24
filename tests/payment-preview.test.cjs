const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createPreview,transition}=require('../payment-panel.js');
test('email is reviewed before sending and repeated send does not duplicate',()=>{
 const model=createPreview({amount:180,clientName:'Luna',projectName:'Video'});
 transition(model,'send');assert.equal(model.status,'draft');
 transition(model,'review-email');transition(model,'send');transition(model,'send');
 assert.equal(model.status,'pending_approval');assert.equal(model.emailsSent,1);
});
test('freelancer cannot approve buyer payment; client view has a distinct flow',()=>{
 const model=createPreview({amount:180});
 transition(model,'review-email');transition(model,'send');transition(model,'pay');
 assert.equal(model.status,'pending_approval');
 transition(model,'client-view');transition(model,'pay');assert.equal(model.status,'pending');
 transition(model,'preview-confirmed');assert.equal(model.status,'completed');
 transition(model,'freelancer-view');transition(model,'send');transition(model,'pay');
 assert.equal(model.status,'completed');assert.equal(model.emailsSent,1);
});

test('browser preview restores completed payment without restarting its creation flow',()=>{
 const vm=require('node:vm');const fs=require('node:fs');
 const modal={innerHTML:'',open:false,setAttribute(){},addEventListener(){},showModal(){this.open=true;},close(){this.open=false;}};
 const window={dispatchEvent(){}};
 const runtime=vm.createContext({window,document:{createElement:()=>modal,body:{append(){}}},Map,Number,String,setTimeout,CustomEvent:class{constructor(name,options){this.detail=options.detail;}}});
 vm.runInContext(fs.readFileSync(require.resolve('../payment-panel.js'),'utf8'),runtime);
 window.TratoPayments.restoreState([['request-1',{paymentKey:'request-1',amount:180,status:'completed',screen:'summary',view:'client',emailsSent:1,clientName:'Luna',projectName:'Video',recipientEmail:'cliente@example.com'}]]);
 window.TratoPayments.openDemo({paymentKey:'request-1',amount:180,clientName:'Luna',projectName:'Video'});
 assert.equal(window.TratoPayments.getStatus('request-1'),'completed');
 assert.match(modal.innerHTML,/Pago recibido/);
 assert.doesNotMatch(modal.innerHTML,/Enviar solicitud|Revisar correo/);
 assert.equal(window.TratoPayments.exportState()[0][1].emailsSent,1);
});
