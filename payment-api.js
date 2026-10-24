/* HTTP seam for the real API. No token is persisted and no fallback to demo occurs. */
(function(root){
  class PaymentApiError extends Error{constructor(message,code,status){super(message);this.code=code;this.status=status;}}
  class PaymentApi{
    constructor({fetcher,getAccessToken}){this.fetcher=fetcher;this.getAccessToken=getAccessToken;}
    async request(path,{method='GET',body,key}={}){
      const token=await this.getAccessToken();if(!token)throw new PaymentApiError('Inicia sesión para consultar el cobro.','UNAUTHENTICATED',401);
      const response=await this.fetcher('/api/v1'+path,{method,headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{}),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
      let result;try{result=await response.json();}catch{throw new PaymentApiError('El servidor no devolvió un resultado de pago válido.','INVALID_RESPONSE',response.status);}
      if(!response.ok)throw new PaymentApiError(result.error?.message || 'No se pudo completar la operación.',result.error?.code || 'PAYMENT_ERROR',response.status);
      return result.data;
    }
    id(value){if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value || ''))throw new PaymentApiError('Identificador de pago inválido.','INVALID_ID',422);return value;}
    create(acceptanceId,key){if(!key)throw new PaymentApiError('Falta la clave de reintento.','INVALID_IDEMPOTENCY_KEY',422);return this.request('/payments',{method:'POST',body:{acceptance_id:this.id(acceptanceId)},key});}
    get(id){return this.request('/payments/'+this.id(id));}
    capture(id){return this.request('/payments/'+this.id(id)+'/capture',{method:'POST'});}
    reconcile(id){return this.request('/payments/'+this.id(id)+'/reconcile',{method:'POST'});}
    notifyByEmail(id,key){if(!key)throw new PaymentApiError('Falta la clave de envío.','INVALID_IDEMPOTENCY_KEY',422);return this.request('/payments/'+this.id(id)+'/notifications/email',{method:'POST',body:{},key});}
  }
  if(typeof module!=='undefined' && module.exports)module.exports={PaymentApi,PaymentApiError};
  else root.TratoPaymentApi=PaymentApi;
})(typeof window!=='undefined'?window:globalThis);
