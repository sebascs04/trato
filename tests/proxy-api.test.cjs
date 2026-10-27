const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

test('API proxy preserves user authorization and idempotency without forwarding demo cookies',async()=>{
  const {proxyApiRequest}=await import('../proxy-api.mjs');
  const upstream=http.createServer(async(req,res)=>{
    assert.equal(req.url,'/api/v1/payments?test=1');assert.equal(req.headers.authorization,'Bearer test-user');
    assert.equal(req.headers['idempotency-key'],'test-key');assert.equal(req.headers.cookie,undefined);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({received:Buffer.concat(chunks).toString()}));
  });
  const base=await listen(upstream), proxy=http.createServer((req,res)=>proxyApiRequest(req,res,base));
  try {
    const address=await listen(proxy);
    const response=await fetch(address+'/api/v1/payments?test=1',{method:'POST',body:'payload',headers:{Authorization:'Bearer test-user','Idempotency-Key':'test-key',Cookie:'trato_demo=not-forwarded'}});
    assert.equal(response.status,201);assert.deepEqual(await response.json(),{received:'payload'});
  }finally{await close(proxy);await close(upstream);}
});

test('API proxy rejects foreign browser origins before reaching backend',async()=>{
  const {proxyApiRequest}=await import('../proxy-api.mjs');
  const proxy=http.createServer((req,res)=>proxyApiRequest(req,res,'http://127.0.0.1:1'));
  try {const address=await listen(proxy);assert.equal((await fetch(address+'/api/v1/clients',{headers:{Origin:'https://other.example'}})).status,403);}
  finally{await close(proxy);}
});
