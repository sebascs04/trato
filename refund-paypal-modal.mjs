// The freelancer confirms a refund in a floating window with PayPal's look, and watches PayPal's answer there.
// The refund itself is PayPal's refund of the original payment, sent by the server with the freelancer's connected
// PayPal account: nobody types credentials, the money goes back to the same PayPal the client paid with.
import {uiText} from './i18n.mjs';
import {icon} from './icons.mjs';
import {renderAIActivity} from './ai-activity.mjs';

const t=(key,values)=>uiText(`refundModal.${key}`,values);
const LOGO='<span class="refund-pp-logo" aria-label="PayPal"><b>Pay</b><i>Pal</i></span>';

// Resolves with the server's result, or null if the freelancer closes the window before confirming.
export function confirmPayPalRefund({doc,amount,execute,describe=result=>result?.settlement?.status}){
 return new Promise(resolve=>{
  const dialog=doc.createElement('dialog');dialog.className='refund-pp-dialog';dialog.setAttribute('aria-labelledby','refund-pp-title');
  let result=null,running=false;
  const paint=(state,message='')=>{
   const body=state==='confirm'
    ?`<p class="refund-pp-amount">${amount}</p><dl class="refund-pp-route"><div><dt>${t('from')}</dt><dd>${t('fromValue')}</dd></div><div><dt>${t('to')}</dt><dd>${t('toValue')}</dd></div></dl><p class="refund-pp-note">${t('note')}</p><div class="refund-pp-actions"><button type="button" class="refund-pp-confirm" data-refund-pp="confirm">${t('confirm',{amount})}</button><button type="button" class="text-button" data-refund-pp="cancel">${t('cancel')}</button></div>`
    :state==='sending'?`<p class="refund-pp-amount">${amount}</p>${renderAIActivity({label:t('sending'),compact:true})}<p class="refund-pp-note">${t('sendingNote')}</p>`
    :state==='done'?`<span class="refund-pp-check" aria-hidden="true">${icon('check')}</span><p class="refund-pp-amount">${amount}</p><p class="refund-pp-status" role="status">${t('done')}</p><div class="refund-pp-actions"><button type="button" class="refund-pp-confirm" data-refund-pp="close">${t('close')}</button></div>`
    :state==='pending'?`<p class="refund-pp-amount">${amount}</p><p class="refund-pp-status" role="status">${t('pending')}</p><div class="refund-pp-actions"><button type="button" class="refund-pp-confirm" data-refund-pp="close">${t('close')}</button></div>`
    :`<p class="refund-pp-status cloud-error" role="alert">${message||t('error')}</p><div class="refund-pp-actions"><button type="button" class="refund-pp-confirm" data-refund-pp="confirm">${t('retry')}</button><button type="button" class="text-button" data-refund-pp="close">${t('close')}</button></div>`;
   dialog.innerHTML=`<header class="refund-pp-head">${LOGO}<button type="button" class="refund-pp-x" data-refund-pp="${running?'':'close'}" aria-label="${t('close')}" ${running?'disabled':''}>${icon('x')}</button></header><h2 id="refund-pp-title">${t('title')}</h2>${body}`;
  };
  const finish=()=>{dialog.close();dialog.remove();resolve(result);};
  dialog.addEventListener('cancel',event=>{if(running)event.preventDefault();});
  dialog.addEventListener('click',async event=>{
   const what=event.target.closest('[data-refund-pp]')?.dataset.refundPp;if(!what||running)return;
   if(what==='cancel'||what==='close'){finish();return;}
   running=true;paint('sending');
   try{result=await execute();const status=describe(result);running=false;paint(status==='completed'||status==='closed_without_refund'?'done':'pending');}
   catch(error){running=false;paint('error',error?.message);}
  });
  paint('confirm');doc.body.append(dialog);dialog.showModal();
 });
}
