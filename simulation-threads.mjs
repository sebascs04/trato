// Local, explicitly selected simulation. Executes the existing generic worker over stdio.
import {spawn} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const operations=new Map();
const fixtureContext={client_id:'40000000-0000-4000-8000-000000000099',project_id:'50000000-0000-4000-8000-000000000099'};
const hash=value=>createHash('sha256').update(value).digest('hex');
const uuid=value=>`${value.slice(0,8)}-${value.slice(8,12)}-4${value.slice(13,16)}-8${value.slice(17,20)}-${value.slice(20,32)}`;
function worker(message){
 return new Promise((resolve,reject)=>{
  const cwd=fileURLToPath(new URL('./repos/trato-worker/',import.meta.url));
  const python=process.env.TRATO_SIMULATION_PYTHON||fileURLToPath(new URL('./repos/trato-worker/.venv/bin/python',import.meta.url));
  const database=fileURLToPath(new URL('./.local/simulation/refund-threads.sqlite',import.meta.url));
  const child=spawn(python,['-m','trato_worker.ingest','--mode','simulation','--transport','stdio','--database',database],{cwd,stdio:['pipe','pipe','ignore'],env:{PATH:process.env.PATH,PYTHONPATH:cwd,LANG:'C.UTF-8',LANGCHAIN_TRACING_V2:'false',LANGSMITH_TRACING:'false'}});
  let output='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const timer=setTimeout(()=>{child.kill();finish(Error('SIMULATION_TIMEOUT'));},20000);
  child.on('error',()=>finish(Error('SIMULATION_UNAVAILABLE')));child.stdin.on('error',()=>{});
  child.stdout.on('data',chunk=>{output+=chunk;if(output.length>250000){child.kill();finish(Error('SIMULATION_RESULT_TOO_LARGE'));}});
  child.on('close',code=>{try{const result=JSON.parse(output);if(code!==0||!result.data)throw Error();finish(null,result.data);}catch{finish(Error('SIMULATION_COMMAND_REJECTED'));}});
  child.stdin.end(JSON.stringify(message));
 });
}
export async function simulationThreadsEndpoint(req,res){
 const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
 const host=req.headers.host||'',origin=`http://${host}`,path=new URL(req.url,origin).pathname;
 if(!/^(localhost|127\.0\.0\.1):\d+$/.test(host)||req.headers.origin&&req.headers.origin!==origin){send(403,{error:'La simulación sólo está disponible en este equipo.'});return;}
 let session=req.headers.cookie?.match(/(?:^|;\s*)trato_simulation=([a-f0-9]{64})(?:;|$)/)?.[1];
 if(req.method==='GET'){
  const id=path.slice('/api/simulation/threads/'.length),op=operations.get(id);
  if(!session||!op||op.owner!==hash(session)){send(404,{error:'No encontramos esta operación de simulación. Puedes consultar el recorrido guardado desde la misma sesión.'});return;}
  send(op.status==='processing'?202:op.status==='error'?422:200,op.status==='error'?{status:'error',error:'No se completó la simulación. Conservamos el recorrido anterior; no se ha ejecutado un reembolso.'}:{status:op.status,...(op.result?{data:op.result}:{})});return;
 }
 if(req.method!=='POST'||path!=='/api/simulation/threads'){send(405,{error:'Método no permitido.'});return;}
 if(req.headers.origin!==origin||!req.headers['content-type']?.startsWith('application/json')){send(403,{error:'Inicia la simulación desde Trato.'});return;}
 try{
  let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>24000){send(413,{error:'La orden es demasiado grande.'});return;}chunks.push(chunk);}
  const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if(input.workflow!=='manage_refund'||input.mode!=='simulation'||input.type!=='thread'||!['start','get','resume'].includes(input.action)||!/^[-a-f0-9]{36}$/.test(input.event_id||'')){send(422,{error:'Selecciona un recorrido de simulación válido.'});return;}
  if(!session){session=randomBytes(32).toString('hex');res.setHeader('Set-Cookie',`trato_simulation=${session}; HttpOnly; SameSite=Strict; Path=/api/simulation; Max-Age=604800`);}
  const owner=hash(session),message={...input,context:{owner_id:uuid(owner),...fixtureContext}};
  const id=hash(owner+':'+message.event_id),fingerprint=hash(JSON.stringify(message));
  for(const [key,value] of operations)if(Date.now()-value.created>1800000&&value.status!=='processing')operations.delete(key);
  const previous=operations.get(id);
  if(previous&&previous.fingerprint!==fingerprint){send(409,{error:'Esta orden ya corresponde a otros datos.'});return;}
  if(!previous){
   if(operations.size>=1000){send(429,{error:'Hay demasiadas operaciones de simulación. Espera antes de continuar.'});return;}
   const op={owner,fingerprint,status:'processing',created:Date.now()};operations.set(id,op);
   worker(message).then(result=>{op.result=result;op.status='ready';}).catch(()=>{op.status='error';});
  }
  send(202,{operation_id:id,status_url:`/api/simulation/threads/${id}`,mode:'simulation'});
 }catch{send(422,{error:'No se pudo leer la orden. No se avanzó el recorrido.'});}
}
