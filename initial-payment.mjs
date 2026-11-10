import {uiText,uiLocale,setUiLanguage} from './i18n.mjs';
import {mountPayPalButtons} from './paypal-buttons.mjs';
let mounted='';
const params=new URLSearchParams(location.search),token=params.get('checkout');
if(['es','en'].includes(params.get('lang')))setUiLanguage(params.get('lang'));
const t=(key,values)=>uiText(`initialPayment.${key}`,values),find=id=>document.getElementById(id);
find('title').textContent=t('checkoutTitle');find('sandbox').textContent=t('sandbox');find('pay').textContent=t('pay');find('verify').textContent=t('verify');
async function check(capture=false){
 find('verify').disabled=true;find('error').textContent='';find('pay').hidden=true;find('status').textContent=t('checkoutLoading');
 try{
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error(t('invalidLink'));
  const response=await fetch(`/api/v1/initial-checkout/${encodeURIComponent(token)}${capture?'/capture':''}`,{method:capture?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw Error(t('checkoutError'));
  const pay=result.data;find('title').textContent=pay.stage_position?uiText('planPayment.checkoutTitle',{number:pay.stage_position}):t('checkoutTitle');find('project').textContent=pay.project_name;find('conditions').textContent=pay.conditions;find('details').textContent=new Intl.NumberFormat(uiLocale(),{style:'currency',currency:'USD'}).format(pay.amount_minor/100);
  find('status').textContent=t(pay.status==='completed'?'checkoutPaid':pay.status==='pending_approval'?'checkoutPending':'checkoutProcessing');
  find('verify').hidden=pay.status==='completed';
  if(pay.approval_url){
   const url=new URL(pay.approval_url);
   if(url.protocol!=='https:'||!['www.sandbox.paypal.com','sandbox.paypal.com'].includes(url.hostname)||url.username||url.password)throw Error(t('invalidLink'));
   find('pay').href=url.href;find('pay').hidden=false;
   // PayPal's own buttons for this same order; the link above stays if they cannot load.
   const order=pay.order_id||url.href;
   if(pay.method==='invoice'){find('paypal-buttons').replaceChildren();find('paypal-buttons').dataset.shown='false';mounted='';}
   else if(mounted!==order){
    mounted=order;
    void mountPayPalButtons({doc:document,host:find('paypal-buttons'),order:async()=>order,approved:()=>check(true),
     failed:()=>{find('error').textContent=t('checkoutError');}}).then(shown=>{find('paypal-buttons').dataset.shown=String(shown);if(shown)find('pay').hidden=true;});
   }else if(find('paypal-buttons').dataset.shown==='true')find('pay').hidden=true;
  }else{find('paypal-buttons').replaceChildren();find('paypal-buttons').dataset.shown='false';mounted='';
  }
 }catch(error){find('error').textContent=error.message;find('status').textContent=t('pending');find('verify').hidden=false;}
 finally{find('verify').disabled=false;}
}
find('verify').addEventListener('click',()=>check(true));check(params.get('result')==='return');
