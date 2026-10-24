import {spawn} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

export async function workflowEndpoint(req,res) {
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
  if(req.method!=='POST'){send(405,{error:'Método no permitido.'});return;}
  if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`){send(403,{error:'Origen no permitido.'});return;}
  if(!['localhost:5173','127.0.0.1:5173',`localhost:${process.env.PORT || 5173}`,`127.0.0.1:${process.env.PORT || 5173}`].includes(req.headers.host)){send(403,{error:'Este flujo es solo para desarrollo local.'});return;}
  try {
    let size=0;const chunks=[];
    for await(const chunk of req){size+=chunk.length;if(size>32000){send(413,{error:'Solicitud demasiado grande.'});return;}chunks.push(chunk);}
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    let token=req.headers.cookie?.match(/(?:^|;\s*)trato_demo=([a-f0-9]{64})(?:;|$)/)?.[1];
    if(!token){token=randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`trato_demo=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);}
    payload.owner=createHash('sha256').update(token).digest('hex');
    const result=await runWorker(payload);
    send(result.ok?200:result.status || 500,result);
  }catch{send(503,{error:'El motor de flujos no está disponible. Instala backend/requirements.lock.txt en .venv y vuelve a intentar.'});}
}

export function runWorker(payload){
  return new Promise((resolve,reject)=>{
    const python=process.env.TRATO_PYTHON || fileURLToPath(new URL('.venv/bin/python',import.meta.url));
    const child=spawn(python,[fileURLToPath(new URL('backend/workflow_worker.py',import.meta.url))],{stdio:['pipe','pipe','pipe'],env:{...process.env,LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'}});
    let output='';let error='';let settled=false;
    const finish=(issue,value)=>{if(settled)return;settled=true;clearTimeout(timer);issue?reject(issue):resolve(value);};
    const timer=setTimeout(()=>{child.kill();finish(new Error('timeout'));},20000);
    child.on('error',issue=>finish(issue));child.stdin.on('error',()=>{});
    child.stdout.on('data',data=>{output+=data;if(output.length>250000){child.kill();finish(new Error('output limit'));}});
    child.stderr.on('data',data=>{if(error.length<10000)error+=data;});
    child.on('close',code=>{try{if(code!==0)throw new Error('worker failed');finish(null,JSON.parse(output));}catch(issue){finish(issue);}});
    child.stdin.end(JSON.stringify(payload));
  });
}
