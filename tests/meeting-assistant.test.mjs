import test from 'node:test';
import assert from 'node:assert/strict';
import {assistantHtml,summaryHtml,addHeardLine} from '../meeting-assistant.mjs';

const base={mode:'practice',phase:'idle',source:'screen',objective:'',type:'general',notesOpen:false,meeting:'Review the store',transcript:[],interim:'',feed:[],summary:null,error:''};
const context={client:'Café Aurora',project:'Website <Aurora>'};

test('inside a project the assistant needs no setup form: it shows what it already knows and one main button',()=>{
 const html=assistantHtml(base,context);
 assert.match(html,/Café Aurora/);assert.match(html,/Website &lt;Aurora&gt;/);assert.match(html,/Review the store/);
 assert.match(html,/data-ma-start/);
 assert.doesNotMatch(html,/data-ma-quick|ma-summary|ma-feed|ma-listen/);
});

test('live asks where to listen; the controls and help appear only once the meeting runs',()=>{
 assert.match(assistantHtml({...base,mode:'live'},context),/ma-listen/);
 const running=assistantHtml({...base,mode:'live',phase:'running',transcript:[{speaker:'client',text:'Add an app?'},{speaker:'you',text:'Maybe'}],feed:[{kind:'risk',text:'Scope <creep>',at:0,about:'Add an app?'}]},context);
 // The help sits right under the message it is about, before the next one.
 assert.ok(running.indexOf('Add an app?')<running.indexOf('Scope &lt;creep&gt;')&&running.indexOf('Scope &lt;creep&gt;')<running.indexOf('Maybe'));
 assert.match(running,/data-ma-end/);assert.match(running,/data-ma-pause/);assert.match(running,/data-ma-quick/);
 assert.match(running,/Scope &lt;creep&gt;/);assert.doesNotMatch(running,/data-ma-start|ma-listen/);
});

test('while TeTrato answers, its button shows it is thinking and no second question can be sent',()=>{
 const html=assistantHtml({...base,mode:'live',phase:'running',asking:'what-reply'},context);
 assert.match(html,/data-ma-quick="what-reply"[^>]*class="is-loading"/);
 assert.match(html,/ma-spinner/);
 assert.equal((html.match(/data-ma-quick="[^"]+" disabled/g)||[]).length,4);
 assert.doesNotMatch(assistantHtml({...base,mode:'live',phase:'running'},context),/disabled class|ma-spinner/);
});

test('a practice has no pause: it only ends',()=>{
 const html=assistantHtml({...base,phase:'running'},context);
 assert.match(html,/data-ma-end/);assert.doesNotMatch(html,/data-ma-pause/);
});

test('the summary shows only after the meeting ends, with the sections that have content',()=>{
 const summary={decisions:['Phase 2 <app>'],actionItems:[],risks:[],nextSteps:[]};
 // The drawer keeps one line; the summary opens in the floating dialog.
 const html=assistantHtml({...base,phase:'ended',summary},context);
 assert.match(html,/data-ma-summary-open/);assert.match(html,/data-ma-reset/);assert.doesNotMatch(html,/Phase 2/);
 assert.doesNotMatch(assistantHtml({...base,phase:'running',summary},context),/data-ma-summary-open/);
 const dialog=summaryHtml(summary);
 assert.match(dialog,/Phase 2 &lt;app&gt;/);assert.match(dialog,/is-decisions/);assert.doesNotMatch(dialog,/is-risks/);
});

test('a sentence split by a short pause stays one line; a finished sentence or another speaker starts a new one',()=>{
 const lines=[];
 addHeardLine(lines,'client','The homepage looks great. Can we add',1000);
 addHeardLine(lines,'client','online reservations?',2000);
 assert.equal(lines.length,1);assert.equal(lines[0].text,'The homepage looks great. Can we add online reservations?');
 addHeardLine(lines,'client','Customers keep asking.',2500);
 assert.equal(lines.length,2);
 addHeardLine(lines,'you','Good idea, it',3000);addHeardLine(lines,'you','would be new work.',9000);
 assert.equal(lines.length,4);
});
