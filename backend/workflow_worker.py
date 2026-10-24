"""Local-only stdio bridge. Cookie-scoped SQLite demo, not Supabase or production auth."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import sys
import uuid
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.types import Command
from workflow import build, validate_resume

ROOT=Path(__file__).resolve().parent.parent
DATA=Path(os.environ.get('TRATO_LOCAL_DATA',str(ROOT/'.local')))
DATA.mkdir(parents=True,exist_ok=True)


def snapshot(graph,run_id):
    state=graph.get_state({'configurable':{'thread_id':run_id}})
    pending=[i.value for task in state.tasks for i in task.interrupts]
    return {'run_id':run_id,'state':state.values,'pending':pending[0] if pending else None,
        'storage':'local-sqlite','mode':'simulation','supabase_connected':False}


def handle(payload):
    owner=payload.get('owner','')
    if len(owner)!=64: raise ValueError('Sesión inválida.')
    with open(DATA/'workflow.lock','a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        db=sqlite3.connect(DATA/'workflow.sqlite', check_same_thread=False)
        db.execute('create table if not exists trato_runs (id text primary key, owner text not null, request_id text not null, project_id text not null, created_at text default current_timestamp, unique(owner, request_id))')
        saver=SqliteSaver(db)
        graph=build(saver)
        action=payload.get('action')
        if action=='list':
            rows=db.execute('select id from trato_runs where owner=? order by created_at desc limit 50',(owner,)).fetchall()
            return {'runs':[run for row in rows if (run:=snapshot(graph,row[0]))['state']]}
        if action=='create':
            item=payload.get('input',{})
            if not isinstance(item,dict): raise ValueError('Solicitud inválida.')
            project_id=item.get('project_id'); request_id=item.get('request_id')
            if not isinstance(request_id,str) or not 1<=len(request_id)<=150: raise ValueError('ID de solicitud inválido.')
            fixture=json.loads((ROOT/'data/demo.json').read_text())
            project=next((p for p in fixture['projects'] if p['id']==project_id),None)
            if not project: raise ValueError('Proyecto de demo desconocido.')
            required={'subject':160,'message':6000}
            for key,limit in required.items():
                if not isinstance(item.get(key),str) or not 1<=len(item[key].strip())<=limit: raise ValueError(f'Dato ausente o inválido: {key}')
            for key,limit in {'sender':254,'email_date':40}.items():
                if not isinstance(item.get(key,''),str) or len(item.get(key,''))>limit: raise ValueError('Metadatos inválidos.')
                item.setdefault(key,'')
            row=db.execute('select id from trato_runs where owner=? and request_id=?',(owner,request_id)).fetchone()
            if row and snapshot(graph,row[0])['state']:return snapshot(graph,row[0])
            doc=next(d for d in fixture['documents'] if d['projectId']==project_id)
            version=next(v for v in fixture['documentVersions'] if v['documentId']==doc['id'] and v['status']=='accepted')
            run_id=row[0] if row else str(uuid.uuid4())
            if not row:
                db.execute('insert into trato_runs(id,owner,request_id,project_id) values(?,?,?,?)',(run_id,owner,request_id,project_id));db.commit()
            initial={k:item[k] for k in ['subject','message','sender','email_date']}
            initial.update(project_id=project_id,request_id=request_id,agreement=version['content'],agreement_id=doc['id'],status='pending_confirmation')
            graph.invoke(initial,{'configurable':{'thread_id':run_id}})
            return snapshot(graph,run_id)
        run_id=payload.get('run_id')
        if not db.execute('select 1 from trato_runs where id=? and owner=?',(run_id,owner)).fetchone(): raise PermissionError('Flujo no encontrado para esta sesión.')
        current=snapshot(graph,run_id)
        if action=='get':return current
        if action!='resume': raise ValueError('Acción inválida.')
        if not current['pending'] or current['pending']['step']!=payload.get('expected_step'): raise ValueError('El flujo cambió. Actualiza antes de responder otra vez.')
        answer=validate_resume(current['pending']['step'],payload.get('value'))
        graph.invoke(Command(resume=answer),{'configurable':{'thread_id':run_id}})
        return snapshot(graph,run_id)


if __name__=='__main__':
    try:
        result=handle(json.load(sys.stdin))
        print(json.dumps({'ok':True,**result},ensure_ascii=False))
    except PermissionError as error:
        print(json.dumps({'ok':False,'error':str(error),'status':404}))
    except ValueError as error:
        print(json.dumps({'ok':False,'error':str(error),'status':400}))
    except Exception:
        print(json.dumps({'ok':False,'error':'No se pudo ejecutar el flujo local. Revisa las dependencias y el registro del servidor.','status':500}))
        import traceback
        traceback.print_exc(file=sys.stderr)
