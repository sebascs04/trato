// Client portal page for the emailed link: review, accept and pay an addendum without a Trato account.
// The token lives in the URL fragment (never sent to servers or logs) and only travels in POST bodies to the API.
// Client accounts open the same view inside Trato ("My projects"), not on this page.
import {uiText,uiLanguage,setUiLanguage} from './i18n.mjs';
import {mountAgreement} from './portal-view.mjs';

const t=(key,values)=>uiText(`portal.${key}`,values);
const $=id=>document.getElementById(id);
const token=new URLSearchParams(location.hash.slice(1)).get('t')||'';

async function api(path,body,{binary=false}={}){
 const response=await fetch('/api/v1/portal/'+path,{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({token,...body}),signal:AbortSignal.timeout(30000)});
 if(!response.ok){let code='';try{code=(await response.json())?.error?.code||'';}catch{}const error=new Error(code||'PORTAL_ERROR');error.code=code;error.status=response.status;throw error;}
 return binary?response.blob():(await response.json()).data;
}
function chrome(){
 document.documentElement.lang=uiLanguage();document.title=t('pageTitle');
 for(const button of document.querySelectorAll('[data-portal-lang]'))button.setAttribute('aria-pressed',String(button.dataset.portalLang===uiLanguage()));
 $('portal-foot').textContent=t('foot');
}
let mounted=null;
function start(){
 if(!/^[0-9a-f]{64}$/.test(token)){$('portal').innerHTML=`<section class="portal-card"><div class="portal-message"><h1>${t('expiredTitle')}</h1><p>${t('expiredCopy')}</p></div></section>`;return;}
 mounted=mountAgreement($('portal'),{api,linkMode:true});
}
for(const button of document.querySelectorAll('[data-portal-lang]'))button.addEventListener('click',()=>{if(setUiLanguage(button.dataset.portalLang)){chrome();mounted?mounted.reload():start();}});
chrome();start();
