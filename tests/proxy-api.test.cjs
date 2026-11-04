const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const listen=server=>new Promise(resolve=>server.listen(0,'127.0.0.1',()=>resolve(`http://127.0.0.1:${server.address().port}`)));
const close=server=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});

test('API proxy preserves user authorization and idempotency without forwarding demo cookies',async()=>{
  const {proxyApiRequest}=await import('../proxy-api.mjs');
  const upstream=http.createServer(async(req,res)=>{
    assert.equal(req.url,'/api/v1/payments?test=1');assert.equal(req.headers.authorization,'Bearer test-user');
    assert.equal(req.headers['idempotency-key'],'test-key');assert.equal(req.headers['accept-language'],'en');assert.equal(req.headers.cookie,undefined);
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    res.writeHead(201,{'Content-Type':'application/json'});res.end(JSON.stringify({received:Buffer.concat(chunks).toString()}));
  });
  const base=await listen(upstream), proxy=http.createServer((req,res)=>proxyApiRequest(req,res,base));
  try {
    const address=await listen(proxy);
    const response=await fetch(address+'/api/v1/payments?test=1',{method:'POST',body:'payload',headers:{Authorization:'Bearer test-user','Idempotency-Key':'test-key','Accept-Language':'en',Cookie:'trato_demo=not-forwarded'}});
    assert.equal(response.status,201);assert.deepEqual(await response.json(),{received:'payload'});
  }finally{await close(proxy);await close(upstream);}
});

test('API proxy rejects foreign browser origins before reaching backend',async()=>{
  const {proxyApiRequest}=await import('../proxy-api.mjs');
  const proxy=http.createServer((req,res)=>proxyApiRequest(req,res,'http://127.0.0.1:1'));
  try {const address=await listen(proxy);assert.equal((await fetch(address+'/api/v1/clients',{headers:{Origin:'https://other.example'}})).status,403);}
  finally{await close(proxy);}
});

test('HTTPS deployment accepts only its configured origin and ignores spoofed forwarded headers',async()=>{
  const {proxyApiRequest}=await import('../proxy-api.mjs');
  const previous=process.env.WEB_ORIGIN;process.env.WEB_ORIGIN='https://trato.example';
  let requests=0;
  const upstream=http.createServer((req,res)=>{requests++;res.writeHead(200);res.end('ok');});
  const base=await listen(upstream),proxy=http.createServer((req,res)=>proxyApiRequest(req,res,base));
  try{
    const address=await listen(proxy);
    assert.equal((await fetch(address+'/api/v1/clients',{headers:{Origin:'https://trato.example'}})).status,200);
    assert.equal((await fetch(address+'/api/v1/clients',{headers:{Origin:'https://attacker.example','X-Forwarded-Host':'trato.example','X-Forwarded-Proto':'https'}})).status,403);
    assert.equal(requests,1);
    process.env.WEB_ORIGIN='invalid';
    assert.equal((await fetch(address+'/api/v1/clients')).status,403);
    assert.equal(requests,1);
  }finally{if(previous===undefined)delete process.env.WEB_ORIGIN;else process.env.WEB_ORIGIN=previous;await close(proxy);await close(upstream);}
});

test('PayPal webhook signature headers reach only the dedicated verification endpoint',async()=>{
  const {proxyApiRequest}=await import('../proxy-api.mjs');
  const signature={'paypal-auth-algo':'SHA256withRSA','paypal-cert-url':'https://api.sandbox.paypal.com/cert.pem','paypal-transmission-id':'transmission-test','paypal-transmission-sig':'signature-test','paypal-transmission-time':'2026-11-01T00:00:00Z'};
  const upstream=http.createServer((req,res)=>{
    for(const [name,value] of Object.entries(signature))assert.equal(req.headers[name],req.url==='/api/v1/webhooks/paypal'?value:undefined);
    assert.equal(req.headers.cookie,undefined);res.writeHead(200);res.end('ok');
  });
  const base=await listen(upstream),proxy=http.createServer((req,res)=>proxyApiRequest(req,res,base));
  try{
    const address=await listen(proxy);
    for(const path of ['/api/v1/webhooks/paypal','/api/v1/clients'])assert.equal((await fetch(address+path,{method:'POST',body:'{}',headers:{...signature,Cookie:'private=omit'}})).status,200);
  }finally{await close(proxy);await close(upstream);}
});
