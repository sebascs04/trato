import {uiText,uiLocale,localizeStaticDocument} from './i18n.mjs';
localizeStaticDocument(document);
const params=new URLSearchParams(location.search), token=params.get('checkout');
const status=document.querySelector('#status'),details=document.querySelector('#details'),error=document.querySelector('#error'),verify=document.querySelector('#verify');
const labels={completed:uiText("Pago confirmado por PayPal"),approved:uiText("Pago aprobado. Confirmando el cobro…"),pending_approval:uiText("El pago sigue pendiente de aprobación."),pending:uiText("PayPal está procesando el pago."),capturing:uiText("Consultando la confirmación del cobro…"),reconciliation_required:uiText("Necesitamos comprobar el resultado con PayPal."),failed:uiText("PayPal no completó este pago."),cancelled:uiText("El pago sigue pendiente.")};
async function check(capture){
 verify.disabled=true;error.textContent='';
 try{
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error(uiText("El enlace de pago no es válido."));
  const response=await fetch(`/api/v1/checkout/${encodeURIComponent(token)}${capture?'/capture':''}`,{method:capture?'POST':'GET',cache:'no-store',signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok)throw Error(uiText("No pudimos verificar el pago. Vuelve a comprobarlo; no se ha marcado como pagado."));
  const data=result.data;status.textContent=labels[data.status]||uiText("Verificación pendiente.");
  details.textContent=`USD ${(data.amount_minor/100).toFixed(2)}${data.order_id?' · '+uiText('Orden')+' '+data.order_id:''}`;
  verify.hidden=data.status==='completed';
 }catch(e){status.textContent=uiText("Verificación pendiente");error.textContent=e.message;verify.hidden=false;}
 finally{verify.disabled=false;}
}
verify.addEventListener('click',()=>check(true));
check(params.get('result')==='return');
