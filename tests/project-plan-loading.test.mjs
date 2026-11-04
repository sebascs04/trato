import test from 'node:test';
import assert from 'node:assert/strict';
import {installProjectPlanning} from '../project-planning.mjs';
import {renderAIActivity} from '../ai-activity.mjs';
function fixture(){
 let resolve,reject;
 const pending=new Promise((ok,fail)=>{resolve=ok;reject=fail;});
 const cloud={navigationOwner:'owner-a',session:{key:'test'},active:true,tab:'plan',projectId:'project-a',location:{hash:'#clientes'},clients:[],project:()=>({id:'project-a',client_id:'client-a',name:'Project A'}),reset(){},submit(){},click(){},document:{addEventListener(){}} ,request:()=>pending};
 installProjectPlanning(cloud);
 const panel={innerHTML:''};cloud.renderProjectPlan(panel);
 return {cloud,panel,resolve,reject};
}
test('a missing plan resolved while another tab is open does not stay loading on return',async()=>{
 const {cloud,panel,reject}=fixture();assert.match(panel.innerHTML,/Cargando el plan/);
 cloud.tab='asistente';reject({code:'AI_PLAN_NOT_FOUND'});await new Promise(resolve=>setImmediate(resolve));
 cloud.tab='plan';cloud.renderProjectPlan(panel);
 assert.match(panel.innerHTML,/todavía no tiene un plan/);assert.doesNotMatch(panel.innerHTML,/Cargando el plan/);
});
test('a request failure offscreen becomes a retry state on return',async()=>{
 const {cloud,panel,reject}=fixture();cloud.tab='documentos';reject({code:'NETWORK_ERROR'});await new Promise(resolve=>setImmediate(resolve));
 cloud.tab='plan';cloud.renderProjectPlan(panel);assert.match(panel.innerHTML,/data-plan-action="retry-plan"/);assert.doesNotMatch(panel.innerHTML,/Cargando el plan/);
});
test('shared activity keeps the actual task label escaped and accessible with the mascot',()=>{
 const html=renderAIActivity({label:'Analizando <mensaje>'});assert.match(html,/trato-guide.png/);assert.match(html,/Analizando &lt;mensaje&gt;/);assert.match(html,/role="status"/);assert.throws(()=>renderAIActivity({label:''}));
});
