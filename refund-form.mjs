// Integer-only USD arithmetic for review. SQL remains the authority when saving.
export const REFUND_MAX_MINOR=99999999999;
export function parseRefundMoney(value){
 const text=String(value).trim();
 if(!/^\d+(?:[.,]\d{1,2})?$/.test(text))throw Error('refund.invalidMoney');
 const [whole,fraction='']=text.replace(',','.').split('.');
 const minor=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
 if(minor>BigInt(REFUND_MAX_MINOR))throw Error('refund.invalidMoney');
 return Number(minor);
}
export const refundInputMoney=minor=>`${Math.floor(minor/100)}.${String(minor%100).padStart(2,'0')}`;
export function allocateRefund(refund,members){
 if(!Number.isSafeInteger(refund)||refund<0||!members.length||new Set(members.map(p=>p.id)).size!==members.length)throw Error('refund.allocationMismatch');
 const rows=members.map(p=>{
  if(![p.amount_minor,p.local_previous_refunds_minor].every(n=>Number.isSafeInteger(n)&&n>=0)||p.local_previous_refunds_minor>p.amount_minor)throw Error('refund.allocationMismatch');
  return {payment_id:p.id,available:BigInt(p.amount_minor-p.local_previous_refunds_minor)};
 });
 const total=rows.reduce((sum,p)=>sum+p.available,0n),requested=BigInt(refund);
 if(requested>total)throw Error('refund.allocationMismatch');
 for(const row of rows){
  const product=requested*row.available;
  row.minor=total?product/total:0n;row.remainder=total?product%total:0n;
 }
 let cents=requested-rows.reduce((sum,p)=>sum+p.minor,0n);
 const ranked=[...rows].sort((a,b)=>a.remainder===b.remainder?(a.payment_id<b.payment_id?-1:a.payment_id>b.payment_id?1:0):a.remainder>b.remainder?-1:1);
 for(const row of ranked){if(cents===0n)break;if(row.minor<row.available){row.minor++;cents--;}}
 if(cents!==0n)throw Error('refund.allocationMismatch');
 return rows.map(p=>({payment_id:p.payment_id,refund_minor:Number(p.minor)}));
}
export function percentageMinor(baseText,rateText){
 const base=parseRefundMoney(baseText),bps=parseRefundMoney(rateText);
 if(base===0||bps===0||bps>10000)throw Error('refund.invalidRate');
 return {base_minor:base,basis_points:bps,amount_minor:Number((BigInt(base)*BigInt(bps)+5000n)/10000n)};
}
export function previewRefund(gross,previous,items){
 if(![gross,previous].every(x=>Number.isSafeInteger(x)&&x>=0&&x<=REFUND_MAX_MINOR)||previous>gross)throw Error('refund.invalidMoney');
 let retained=0,credit=0;const ids=new Set();
 for(const item of items){
  if(ids.has(item.concept_id))throw Error('refund.duplicateConcept');ids.add(item.concept_id);
  if(!Number.isSafeInteger(item.amount_minor)||item.amount_minor<=0||item.amount_minor>REFUND_MAX_MINOR)throw Error('refund.invalidMoney');
  if(!['seller','customer'].includes(item.beneficiary)||item.kind==='recognized_work'&&item.beneficiary!=='seller')throw Error('refund.invalidConcept');
  if(item.beneficiary==='seller')retained+=item.amount_minor;else credit+=item.amount_minor;
 }
 if(Math.max(retained,credit)>REFUND_MAX_MINOR)throw Error('refund.invalidMoney');
 const entitlement=gross-retained+credit;
 if(previous>0&&entitlement<previous)throw Error('refund.priorConflict');
 const refund=Math.max(entitlement-previous,0);
 if(refund>gross-previous)throw Error('refund.exceeds');
 return {refund_minor:refund,additional_payment_due_minor:Math.max(-entitlement,0),seller_retention_minor:retained,customer_credit_minor:credit};
}
