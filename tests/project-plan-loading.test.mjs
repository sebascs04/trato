import test from 'node:test';
import assert from 'node:assert/strict';
import {installProjectPlanning} from '../project-planning.mjs';
import {renderAIActivity} from '../ai-activity.mjs';
function fixture(){
 let resolve,reject;
 const pending=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
 const cloud={navigationOwner:'owner-a',session:{key:'test'},active:true,tab:'plan',projectId:'project-a',location:{hash:'#clientes'},clients:[],initialSources:()=>[],sourceRows:()=>'',project:()=>({id:'project-a',client_id:'client-a',name:'Project A'}),reset(){},submit(){},click(){},document:{addEventListener(){}} ,request:()=>pending};
 installProjectPlanning(cloud);
 const panel={innerHTML:''};cloud.renderProjectPlan(panel);
 return {cloud,panel,resolve,reject};
}
test('a missing plan resolved while another tab is open does not stay loading on return',async()=>{
 const {cloud,panel,reject}=fixture();assert.match(panel.innerHTML,/Cargando el plan/);
 cloud.tab='asistente';reject({code:'AI_PLAN_NOT_FOUND'});await new Promise(resolve=>setImmediate(resolve));
 cloud.tab='plan';cloud.renderProjectPlan(panel);
 assert.match(panel.innerHTML,/aún no tiene plan de trabajo/);assert.match(panel.innerHTML,/data-plan-action="attach-plan"/);assert.doesNotMatch(panel.innerHTML,/Cargando el plan/);
});
test('a request failure offscreen becomes a retry state on return',async()=>{
 const {cloud,panel,reject}=fixture();cloud.tab='documentos';reject({code:'NETWORK_ERROR'});await new Promise(resolve=>setImmediate(resolve));
 cloud.tab='plan';cloud.renderProjectPlan(panel);assert.match(panel.innerHTML,/data-plan-action="retry-plan"/);assert.doesNotMatch(panel.innerHTML,/Cargando el plan/);
});
test('shared activity keeps the actual task label escaped and accessible with the mascot',()=>{
 const html=renderAIActivity({label:'Analizando <mensaje>'});assert.match(html,/trato-guide.png/);assert.match(html,/Analizando &lt;mensaje&gt;/);assert.match(html,/role="status"/);assert.throws(()=>renderAIActivity({label:''}));
});
test('saved plan keeps long explanations behind detail actions',async()=>{
 const {panel,resolve}=fixture();
 resolve({budget:'600.00',target_date:'2026-11-20',brief:'A long project brief',summary:'Original agent reasoning',considerations:[],limitations:[],stages:[{title:'Design',deliverables:'Long deliverables hidden from overview',percent:100,payment_condition:'Long payment condition hidden from overview',amount:'600.00'}]});
 await new Promise(resolve=>setImmediate(resolve));
 assert.match(panel.innerHTML,/data-plan-action="saved-stage"/);
 assert.match(panel.innerHTML,/data-plan-action="saved-reasoning"/);
 assert.match(panel.innerHTML,/Design/);
 assert.doesNotMatch(panel.innerHTML,/Long deliverables hidden|Long payment condition hidden|Original agent reasoning|A long project brief/);
});
