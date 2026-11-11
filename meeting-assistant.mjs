// TeTrato's meeting assistant inside a Trato project (right-hand drawer of the Meetings tab). It already knows the client,
// the project and the meeting, so there is no setup form: choose Practice or Live, press one button, and TeTrato listens,
// transcribes and helps. The live connection is the meeting copilot's (meeting-copilot.mjs); it never listens by itself.
import {uiText,uiLanguage} from './i18n.mjs';
import {icon} from './icons.mjs';
import {startLiveAudioCapture,meetingCopilotModes,getQuickActionCopy} from './meeting-copilot.mjs';

const t=(key,values)=>uiText(`meetingAssistant.${key}`,values);
const mt=key=>uiText(`meeting.${key}`);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const QUICK=['what-reply','brief','ask','objection'];
const lang=()=>uiLanguage()==='es'?'es':'en';

// Practice: a short sample call in Trato's language, one step every two seconds: four messages and four short tips from
// TeTrato, each under the message it is about. It ends by itself with the summary. Nothing is recorded or billed.
export const PRACTICE_STEP_MS=2000;
const PRACTICE={
 en:{steps:[['client','Could we add a mobile app without raising the budget?'],['risk','The mobile app is not in the agreed scope.'],['answer','Offer it as a phase 2 with its own quote.'],['you','We can do it as a phase 2, with its own quote.'],['client','Fine, but the launch date can\'t move.'],['question','Ask which app features are a must.'],['you','Agreed. Which features are a must for you?'],['tip','Send the phase 2 quote from Trato as a change request.']],
  summary:{decisions:['The mobile app is handled as a separate phase 2.','The launch date of the current project does not change.'],actionItems:['Send a separate quote for the mobile app.','List the must-have features with the client.'],risks:['Scope creep if phase 2 is not written down as additional work.'],nextSteps:['Prepare the phase 2 quote as a change request in Trato.']}},
 es:{steps:[['client','¿Podemos añadir una app móvil sin subir el presupuesto?'],['risk','La app móvil no está en el alcance acordado.'],['answer','Ofrécela como fase 2 con su propia cotización.'],['you','Podemos hacerla como fase 2, con su propia cotización.'],['client','Vale, pero la fecha de lanzamiento no se puede mover.'],['question','Pregunta qué funciones de la app son imprescindibles.'],['you','De acuerdo. ¿Qué funciones son imprescindibles para ti?'],['tip','Envía la cotización de la fase 2 desde Trato como pedido de cambio.']],
  summary:{decisions:['La app móvil se trata como una fase 2 aparte.','La fecha de lanzamiento del proyecto actual no cambia.'],actionItems:['Enviar una cotización aparte para la app móvil.','Definir con el cliente las funciones imprescindibles.'],risks:['Ampliación de alcance si la fase 2 no queda escrita como trabajo adicional.'],nextSteps:['Preparar la cotización de la fase 2 como un pedido de cambio en Trato.']}}
};

// A short pause can split one sentence in two: a piece from the same person right after an unfinished line joins it.
export function addHeardLine(transcript,who,text,now){
 const last=transcript[transcript.length-1];
 if(last&&last.speaker===who&&now-(last.heardAt||0)<2500&&!/[.!?…]["»”]?$/.test(last.text.trim())){last.text=`${last.text.trim()} ${text.trim()}`;last.heardAt=now;return;}
 transcript.push({speaker:who,text,heardAt:now});
}
export function assistantHtml(s,context){
 const live=s.mode==='live',busy=['connecting','running','paused','ending'].includes(s.phase);
 const chips=[context.client,context.project,s.meeting||''].filter(Boolean).map(v=>`<span>${esc(v)}</span>`).join('');
 const modes=`<div class="ma-modes" role="group" aria-label="${esc(t('modeLabel'))}"><button type="button" data-ma-mode="practice" aria-pressed="${!live}" ${busy?'disabled':''}>${icon('play')}${t('practice')}</button><button type="button" data-ma-mode="live" aria-pressed="${live}" ${busy?'disabled':''}>${icon('users')}${t('live')}</button></div><p class="ma-hint">${t(live?'liveHint':'practiceHint')}</p>`;
 const setup=busy||s.phase==='ended'?'':`${live?`<p class="ma-listen">${icon('users')}<span><strong>${t('listensTitle')}</strong>${t('listensBoth')}</span></p>`:''}
  <details class="ma-notes" ${s.notesOpen?'open':''}><summary>${icon('pencil')}${t('notes')}</summary><label for="ma-objective">${t('objective')}</label><textarea id="ma-objective" data-ma-note="objective" rows="2" maxlength="600" placeholder="${esc(t('objectivePlaceholder'))}">${esc(s.objective)}</textarea><label for="ma-type">${t('type')}</label><select id="ma-type" data-ma-note="type">${meetingCopilotModes.map(m=>`<option value="${m}" ${s.type===m?'selected':''}>${mt(`modes.${m}`)}</option>`).join('')}</select></details>
  ${live?`<p class="ma-hint">${icon('info')}${t('tabPickHint')}</p>`:''}
  <button type="button" class="button ma-start" data-ma-start>${icon(live?'users':'play')}${t(live?'startLive':'startPractice')}</button>`;
 const status=busy?`<div class="ma-status"><span class="ma-pill is-${s.phase}"><span aria-hidden="true"></span>${t(s.mode==='practice'&&s.phase==='running'?'playing':s.phase)}</span>${['running','paused'].includes(s.phase)?`${live?`<button type="button" class="button secondary" data-ma-pause>${icon(s.phase==='paused'?'play':'pause')}${t(s.phase==='paused'?'resume':'pause')}</button>`:''}<button type="button" class="button ma-end" data-ma-end>${t('end')}</button>`:''}</div>`:'';
 const error=s.error?`<p class="cloud-error" role="alert">${esc(s.error)}</p>`:'';
 const who=speaker=>speaker==='you'?t('you'):speaker==='client'?t('client'):esc(speaker);
 // TeTrato's help sits right under the message it is about, so it is clear what it answers.
 const help=index=>s.feed.filter(f=>f.at===index).map(f=>`<li class="ma-help is-${f.kind}${f.shown?'':' is-new'}"><small><img src="/assets/mascot/trato-guide.png" alt="" width="18" height="18">TeTrato · ${t(f.kind)}</small><p>${esc(f.text)}</p></li>`).join('');
 // In a live meeting the speaker can be corrected with one click: You ⇄ Client.
 const label=l=>`<small>${who(l.speaker)}</small>`;
 const lines=help(-1)+s.transcript.map((l,i)=>`<li class="is-${l.speaker==='you'?'mine':'theirs'}">${label(l,i)}<p>${esc(l.text)}</p></li>${help(i)}`).join('')+(s.interim?`<li class="is-theirs is-partial"><p>${esc(s.interim)}</p></li>`:'')+help(null);
 const quick=['running','paused'].includes(s.phase)?`<div class="ma-quick"><h3>${icon('sparkles')}${t('askTeTrato')}</h3><div>${QUICK.map(k=>`<button type="button" data-ma-quick="${k}" ${s.asking?'disabled':''} class="${s.asking===k?'is-loading':''}" ${s.asking===k?'aria-busy="true"':''}>${s.asking===k?`<span class="ma-spinner" aria-hidden="true"></span>${t('thinking')}`:mt(`quick.${k}`)}</button>`).join('')}</div></div>`:'';
 const conversation=busy||s.transcript.length?`<section class="ma-card"><h3>${t('conversation')}</h3>${lines?`<ol class="ma-transcript" data-ma-transcript aria-live="polite">${lines}</ol>`:`<p class="ma-empty">${t('emptyConversation')}</p>`}${quick}</section>`:'';
 const feed='';
 // Once ended, the drawer keeps one line; the summary itself opens in a floating dialog in the middle.
 const summary=s.phase==='ended'?`<section class="ma-status ma-summary-ready">${icon('circle-check')}<strong>${t('summaryReady')}${s.saved?`<small class="ma-saved is-${s.saved}">${t(`saved.${s.saved}`)}</small>`:''}</strong><button type="button" class="button" data-ma-summary-open aria-haspopup="dialog">${t('viewSummary')}</button><button type="button" class="button secondary" data-ma-reset>${icon('refresh-cw')}${t('again')}</button></section>`:'';
 return `<div class="ma">${chips?`<div class="ma-context">${chips}</div>`:''}${modes}${setup}${status}${error}${feed}${conversation}${summary}</div>`;
}

export function summaryHtml(sum){
 const parts=sum?['decisions','actionItems','risks','nextSteps'].filter(k=>sum[k]?.length):[];
 return parts.length?parts.map(k=>`<section class="ma-summary-part is-${k}"><h4>${t(`sum.${k}`)}</h4><ul>${sum[k].map(i=>`<li>${esc(i)}</li>`).join('')}</ul></section>`).join(''):`<p class="ma-empty">${t('noSummary')}</p>`;
}

export function mountMeetingAssistant(root,{context,meeting='',meetingId=null}){
 // The summary dialog: Trato's floating dialog, centred above the drawer.
 const doc=root.ownerDocument,dialog=doc.createElement('dialog');
 dialog.className='cloud-dialog ma-summary-dialog';dialog.setAttribute('aria-labelledby','ma-summary-title');
 doc.body.append(dialog);
 const openSummary=()=>{
  dialog.innerHTML=`<div class="upload-modal-header"><div><span class="eyebrow">TeTrato</span><h2 id="ma-summary-title">${t('summary')}</h2>${s.meeting||context.project?`<p class="ma-hint">${esc([s.meeting,context.project].filter(Boolean).join(' · '))}</p>`:''}</div><button type="button" class="close" data-ma-summary-close aria-label="${esc(uiText('Cerrar'))}" title="${esc(uiText('Cerrar'))}">${icon('x')}</button></div><div class="ma-summary">${summaryHtml(s.summary)}</div><p class="cloud-error" role="alert" data-ma-addendum-error></p><div class="dialog-actions"><button type="button" class="button secondary" data-ma-summary-close>${t('done')}</button>${s.recordId&&context.prepareAddendum?`<button type="button" class="button" data-ma-addendum>${icon('file-text')}${t('addendum')}</button>`:''}</div>`;
  dialog.querySelectorAll('[data-ma-summary-close]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  // Prepare addendum: what the client asked becomes the project's request, and Trato opens Prepare change for it.
  dialog.querySelector('[data-ma-addendum]')?.addEventListener('click',async event=>{
   const button=event.currentTarget;button.disabled=true;
   dialog.close();
   const problem=await context.prepareAddendum(s.recordId,s.meeting||s.summary?.title||t('untitled'));
   if(problem){openSummary();const note=dialog.querySelector('[data-ma-addendum-error]');note.textContent=problem.text||problem;note.classList.toggle('is-draft',!!problem.draft);}
  });
  if(!dialog.open)dialog.showModal();
 };
 const fresh=()=>({mode:'practice',phase:'idle',source:'screen',objective:'',type:'general',notesOpen:false,meeting,transcript:[],interim:'',feed:[],summary:null,error:'',asking:'',meetingId,saved:''});
 let s=fresh(),live=null,mine=null,timer=null,summaryWait=null,askTimer=null,lastAuto=0;
 // Repaints keep the reader where they are: the conversation follows new lines only if it was already at the bottom.
 const paint=()=>{
  const old=root.querySelector('[data-ma-transcript]'),follow=!old||old.scrollHeight-old.scrollTop-old.clientHeight<40,top=old?.scrollTop||0,outer=root.scrollTop;
  const outerFollow=root.scrollHeight-root.scrollTop-root.clientHeight<80;
  root.innerHTML=assistantHtml(s,context);
  // Help fades in once, when it arrives; later repaints show it still.
  for(const f of s.feed)f.shown=true;
  const list=root.querySelector('[data-ma-transcript]');
  if(list)list.scrollTop=follow?list.scrollHeight:top;
  // The drawer itself follows too while the reader is at its bottom, so the newest line and the help stay in view.
  root.scrollTop=follow&&outerFollow?root.scrollHeight:outer;
 };
 // Each piece of help is tied to the latest client message (or the latest one at all), and quotes its start.
 const add=(kind,text)=>{
  if(!text)return;
  // TeTrato can answer before the client's sentence closes: the help then belongs to that line, still on its way.
  if(s.awaitingLine&&kind!=='tip'){const line=s.interim||'';s.feed.push({kind,text,at:null,about:line.length>70?line.slice(0,67).trimEnd()+'…':line});return;}
  let at=s.transcript.length-1;
  // A next-step tip is about where the conversation got to; the rest answer the client.
  if(kind!=='tip')for(let i=at;i>=0;i-=1){if(s.transcript[i].speaker!=='you'){at=i;break;}}
  const line=s.transcript[at]?.text||'',about=line.length>70?line.slice(0,67).trimEnd()+'…':line;
  if(!s.feed.some(f=>f.at===at&&f.text===text))s.feed.push({kind,text,at,about});
 };
 const liveContext=()=>({meeting:s.meeting,client:context.client,project:context.project,objective:s.objective,notes:'',client_id:context.clientId,project_id:context.projectId,project_name:context.project,documents:context.documents()});
 const transcriptContext=()=>({type:'transcript-context',transcript:s.transcript.map(({speaker,text})=>({speaker:speaker==='you'?'You':speaker==='client'?'Client':speaker,text})),mode:s.type,language:lang(),context:liveContext()});
 const playPractice=()=>playPracticeFrom();
 // Two voices, two transcriptions: the Meet tab is always the client and the microphone is always you, so no
 // line has to be guessed. Help and the summary go through the client's connection, which carries the whole conversation.
 const heard=(who,event)=>{
  if(event.phase==='partial'){
   s.interim=event.text||'';s.interimWho=who;
   // A question is visible before the sentence closes: TeTrato starts on it now, with the line as heard so far.
   if(who==='client'&&/[?¿]/.test(s.interim)&&Date.now()-lastAuto>8000&&!s.asking&&live){
    const ctx=transcriptContext();ctx.transcript.push({speaker:'Client',text:s.interim});
    try{live.send(ctx);}catch{}
    s.awaitingLine=true;autoSuggest();
   }
   return;
  }
  if(event.phase!=='final'||!event.text)return;
  if(s.interimWho===who)s.interim='';
  addHeardLine(s.transcript,who,event.text,Date.now());
  if(who==='client'&&s.awaitingLine){for(const f of s.feed)if(f.at===null)f.at=s.transcript.length-1;s.awaitingLine=false;}
  try{live?.send(transcriptContext());}catch{}
  // When the client asks something, TeTrato suggests the answer by itself: one at a time, at most every 8 s.
  if(who==='client'&&/[?¿]/.test(event.text)&&Date.now()-lastAuto>8000)autoSuggest();
 };
 // One meeting listens at a time. Each start gets a number; a connection from an earlier start is closed and
 // anything it still sends is ignored, so a voice is never transcribed twice and nothing listens after the end.
 let runId=0;
 async function stopCaptures(){
  runId+=1;const old=[live,mine];live=null;mine=null;
  for(const capture of old)if(capture){try{await capture.close();}catch{}}
 }
 async function startLive(){
  await stopCaptures();const run=runId;
  s.phase='connecting';s.error='';paint();
  // The microphone comes first, so the browser asks in a sensible order: your voice, then the Meet tab.
  // Without it the meeting does not start halfway: the message says how to allow it.
  try{
   const probe=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
   for(const track of probe.getTracks())track.stop();
  }catch{if(run!==runId)return;s.phase='idle';s.error=t('micBlocked');paint();return;}
  if(run!==runId)return;
  try{
   const capture=await startLiveAudioCapture({source:'screen',language:lang(),mode:s.type,context:liveContext(),sessionId:`meeting-${Date.now()}-client`,onEvent:event=>{
    if(run!==runId)return;
    if(event.type==='transcription')heard('client',event);
    else if(event.type==='suggestion'){
     // One request, one answer: only the piece the freelancer asked for.
     const r=event.result||{};s.asking='';clearTimeout(askTimer);
     if(event.kind==='ask')add('question',r.recommended_question||r.reply);
     else if(event.kind==='objection')add('risk',r.rationale||r.reply);
     else add('answer',r.reply);
    }else if(event.type==='summary'){
     const r=event.result||{};s.summary={title:typeof r.title==='string'?r.title.trim().slice(0,200):'',decisions:r.decisions||[],actionItems:r.action_items||[],risks:r.risks||[],nextSteps:r.next_steps||[]};summaryWait?.();
    }else if(event.type==='error'){s.error=event.message||t('error');s.asking='';clearTimeout(askTimer);summaryWait?.();}
    else if(event.type==='status')s.phase=event.status==='pause'?'paused':'running';
    paint();
   }});
   if(run!==runId){try{await capture.close();}catch{}return;}
   live=capture;s.phase='running';
  }catch(failure){if(run!==runId)return;live=null;s.phase='idle';s.error=failure?.message||t('error');paint();return;}
  paint();
  // Your own voice, on its own connection. Without a microphone the meeting goes on with the client alone.
  try{
   const capture=await startLiveAudioCapture({source:'microphone',language:lang(),mode:s.type,context:liveContext(),sessionId:`meeting-${Date.now()}-you`,onEvent:event=>{
    if(run!==runId)return;
    if(event.type==='transcription'){heard('you',event);paint();}
   }});
   if(run!==runId){try{await capture.close();}catch{}return;}
   mine=capture;
  }catch{if(run!==runId)return;mine=null;s.error=t('micMissing');paint();}
 }
 async function end(){
  clearTimeout(timer);
  if(s.mode==='practice'){s.summary=PRACTICE[lang()].summary;s.phase='ended';paint();openSummary();return;}
  s.phase='ending';paint();
  if(live){
   // Gemini thinks before it writes the summary: about 8 s for a short call, longer for a long one.
   const ready=new Promise(resolve=>{summaryWait=resolve;setTimeout(resolve,40000);});
   try{live.send(transcriptContext());live.send({type:'summary-request'});await ready;}catch{}
   summaryWait=null;
   try{await live.close();}catch{}
   live=null;
  }
  // After the summary nothing keeps listening: both connections close and late events are ignored.
  await stopCaptures();
  s.phase='ended';paint();openSummary();
  void keep();
 }
 function autoSuggest(){
  if(s.asking||!live)return;
  lastAuto=Date.now();s.asking='what-reply';clearTimeout(askTimer);askTimer=setTimeout(()=>{if(s.asking){s.asking='';paint();}},30000);
  try{live.send({type:'suggestion-request',kind:'what-reply'});}catch{s.asking='';}
 }
 // The conversation as it happened, with TeTrato's help right under the line it answered (at most 400 lines in all).
 const keptLines=()=>{
  const line=l=>({speaker:l.speaker==='you'?'you':l.speaker==='client'?'client':'call',text:l.text});
  const tips=at=>s.feed.filter(f=>f.at===at&&f.text).map(f=>({speaker:'tetrato-'+f.kind,text:f.text}));
  return [...tips(-1),...s.transcript.flatMap((l,i)=>[line(l),...tips(i)]),...tips(null)].slice(0,400);
 };
 async function keep(){
  if(!s.transcript.length||!context.saveRecord)return;
  s.saved='saving';paint();
  const sum=s.summary||{};
  try{
   const saved=await context.saveRecord({title:s.meeting||s.summary?.title||t('untitled'),meeting_id:s.meetingId||null,summary:{decisions:sum.decisions||[],actionItems:sum.actionItems||[],risks:sum.risks||[],nextSteps:sum.nextSteps||[]},
    transcript:keptLines()});
   s.saved='saved';s.recordId=saved?.id||null;
   // The summary may already be open: it gains its Prepare addendum button now that the meeting is kept.
   if(dialog.open)openSummary();
  }catch{s.saved='failed';}
  paint();
 }
 root.addEventListener('click',event=>{
  const b=event.target.closest('button');if(!b||!root.contains(b))return;
  // Changing mode starts clean: a practice conversation never carries over into a live meeting, nor the other way round.
  if(b.dataset.maMode){if(b.dataset.maMode!==s.mode){clearTimeout(timer);void stopCaptures();dialog.close();s={...fresh(),mode:b.dataset.maMode,source:s.source,objective:s.objective,type:s.type,meeting:s.meeting};}paint();return;}
  if(b.matches('[data-ma-start]')){s.transcript=[];s.feed=[];s.summary=null;s.awaitingLine=false;if(s.mode==='practice'){s.phase='running';paint();playPractice();}else void startLive();return;}
  if(b.matches('[data-ma-pause]')){
   const pausing=s.phase==='running';s.phase=pausing?'paused':'running';
   for(const capture of [live,mine])if(capture){try{pausing?capture.pause():capture.resume();}catch{}}
   else if(!pausing){clearTimeout(timer);playPracticeFrom();}
   if(pausing)clearTimeout(timer);
   paint();return;
  }
  if(b.matches('[data-ma-end]')){void end();return;}
  if(b.matches('[data-ma-summary-open]')){openSummary();return;}
  if(b.matches('[data-ma-reset]')){clearTimeout(timer);void stopCaptures();const keep={mode:s.mode,source:s.source,objective:s.objective,type:s.type};s={...fresh(),...keep};paint();return;}
  if(b.dataset.maQuick){
   // One question at a time: the button shows TeTrato thinking and the others wait until the answer arrives.
   if(s.asking)return;
   const key=b.dataset.maQuick;s.asking=key;s.error='';paint();
   clearTimeout(askTimer);askTimer=setTimeout(()=>{if(s.asking){s.asking='';s.error=t('error');paint();}},30000);
   if(live){try{live.send(transcriptContext());live.send({type:'suggestion-request',kind:key});}catch{s.asking='';s.error=t('error');paint();}return;}
   askTimer=setTimeout(()=>{s.asking='';add(key==='ask'?'question':key==='objection'?'risk':'answer',getQuickActionCopy(key,lang()));paint();},1200);
  }
 });
 // One step at a time: a message or a tip, every two seconds; after the last one the practice ends with its summary.
 function playPracticeFrom(){
  const steps=PRACTICE[lang()].steps;let index=0;
  const step=()=>{
   if(s.phase!=='running')return;
   if(index>=steps.length){void end();return;}
   const [who,text]=steps[index];index+=1;
   if(who==='client'||who==='you')s.transcript.push({speaker:who,text});else add(who,text);
   paint();timer=setTimeout(step,PRACTICE_STEP_MS);
  };
  timer=setTimeout(step,800);
 }
 root.addEventListener('change',event=>{
  const field=event.target;
  if(field.name==='ma-source'){s.source=field.value==='microphone'?'microphone':'screen';paint();}
  else if(field.dataset.maNote==='type')s.type=meetingCopilotModes.includes(field.value)?field.value:'general';
 });
 root.addEventListener('input',event=>{if(event.target.dataset.maNote==='objective')s.objective=event.target.value;});
 root.addEventListener('toggle',event=>{if(event.target.matches?.('.ma-notes'))s.notesOpen=event.target.open;},true);
 paint();
 return {stop:()=>{clearTimeout(timer);return stopCaptures();},setMeeting(title,id=null){if(!['connecting','running','paused','ending'].includes(s.phase)){s.meeting=title||'';s.meetingId=id;paint();}}};
}
