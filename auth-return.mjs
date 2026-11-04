// Capture before route normalization. Tokens stay in memory until server verification.
export function captureAuthReturn(location=globalThis.location,history=globalThis.history){
 const url=new URL(location.href),fragment=new URLSearchParams(url.hash.slice(1));
 const fields=['access_token','refresh_token','expires_in','expires_at','token_type','type','error','error_code','error_description'];
 const present=fragment.has('access_token')||fragment.has('refresh_token')||fragment.has('error')||fragment.has('error_code')||url.searchParams.has('error')||url.searchParams.has('access_token')||url.searchParams.has('refresh_token');
 if(!present)return null;
 const unsafeQuery=url.searchParams.has('access_token')||url.searchParams.has('refresh_token');
 const errorCode=fragment.get('error_code')||url.searchParams.get('error_code');
 const hasError=fragment.has('error')||fragment.has('error_code')||url.searchParams.has('error');
 for(const key of fields)url.searchParams.delete(key);
 url.hash='inicio';history.replaceState(null,'',url.pathname+url.search+url.hash);
 if(hasError)return {error:errorCode==='otp_expired'?'expired':'invalid'};
 if(unsafeQuery||fields.some(key=>fragment.getAll(key).length>1))return {error:'invalid'};
 const token=fragment.get('access_token'),refresh=fragment.get('refresh_token'),expires=Number(fragment.get('expires_in'));
 if(!token||!refresh||token.length>16384||refresh.length>16384||!/^[\x21-\x7e]+$/.test(token)||!/^[\x21-\x7e]+$/.test(refresh)||!Number.isSafeInteger(expires)||expires<=0||(fragment.get('token_type')||'').toLowerCase()!=='bearer'||fragment.get('type')!=='signup')return {error:'invalid'};
 return {access_token:token,refresh_token:refresh,expires_in:expires};
}
