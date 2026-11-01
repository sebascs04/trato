// Configure the canonical HTTPS origin explicitly behind a managed TLS proxy.
// Forwarded headers never decide which browser origin is trusted.
export function browserOriginAllowed(req,publicOrigin=process.env.WEB_ORIGIN){
 if(publicOrigin!==undefined){
  try{
   const url=new URL(publicOrigin);
   if(!['http:','https:'].includes(url.protocol)||url.origin!==publicOrigin||url.username||url.password)return false;
  }catch{return false;}
 }
 return !req.headers.origin||req.headers.origin===(publicOrigin??`http://${req.headers.host}`);
}
