// PayPal's own buttons (JavaScript SDK) for an order Trato already created on the server.
// The page keeps its link to PayPal: if the SDK does not load or the buttons cannot render, nothing changes for the client.
// Trato never sees the buyer's PayPal details; approving happens in PayPal's window and the server captures and verifies.
const SDK='https://www.paypal.com/sdk/js';
let loading=null;

export function paypalOrderId(value){
 // An order id as PayPal writes it, from our API or from the `token` of its approval link.
 if(typeof value==='string'&&/^[A-Z0-9]{10,24}$/.test(value))return value;
 try{const url=new URL(value);const token=url.searchParams.get('token')||'';return ['www.sandbox.paypal.com','sandbox.paypal.com'].includes(url.hostname)&&/^[A-Z0-9]{10,24}$/.test(token)?token:null;}catch{return null;}
}

export function sdkUrl(config){
 if(!config||config.environment!=='sandbox'||!/^[A-Za-z0-9_-]{20,120}$/.test(config.client_id||'')||config.currency!=='USD')return null;
 return `${SDK}?${new URLSearchParams({'client-id':config.client_id,currency:'USD',intent:'capture',components:'buttons',commit:'true'})}`;
}

// One script per page, shared by every button on it.
function loadSdk(doc){
 const view=doc.defaultView;
 if(view.paypal?.Buttons)return Promise.resolve(view.paypal);
 loading??=(async()=>{
  const response=await view.fetch('/api/v1/portal/paypal-sdk',{cache:'no-store'});
  if(!response.ok)throw new Error('PAYPAL_SDK_UNAVAILABLE');
  const url=sdkUrl((await response.json()).data);
  if(!url)throw new Error('PAYPAL_SDK_UNAVAILABLE');
  await new Promise((resolve,reject)=>{
   const script=doc.createElement('script');script.src=url;script.async=true;script.dataset.paypalSdk='true';
   script.onload=resolve;script.onerror=()=>reject(new Error('PAYPAL_SDK_UNAVAILABLE'));doc.head.append(script);
  });
  if(!view.paypal?.Buttons)throw new Error('PAYPAL_SDK_UNAVAILABLE');
  return view.paypal;
 })().catch(error=>{loading=null;throw error;});
 return loading;
}

// host: where the buttons go. order(): resolves to the PayPal order id (or null to stop). approved(): the server
// captures and verifies. Returns true when the buttons are on screen; false leaves the page's own link in charge.
export async function mountPayPalButtons({doc,host,order,approved,failed=()=>{}}){
 if(!host)return false;
 try{
  const paypal=await loadSdk(doc);
  if(!host.isConnected)return false;
  const buttons=paypal.Buttons({
   style:{layout:'vertical',color:'gold',shape:'rect',label:'pay',height:44,tagline:false},
   createOrder:async()=>{const id=paypalOrderId(await order());if(!id)throw new Error('PAYMENT_NOT_READY');return id;},
   onApprove:()=>approved(),
   onError:()=>failed()
  });
  if(!buttons.isEligible())return false;
  host.replaceChildren();
  await buttons.render(host);
  return true;
 }catch{return false;}
}
