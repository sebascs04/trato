"""Fixed LangGraph workflow. All interpretation/signing outputs are explicit simulations."""
from typing import TypedDict
from decimal import Decimal, InvalidOperation
from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt


class State(TypedDict, total=False):
    project_id: str
    request_id: str
    subject: str
    message: str
    sender: str
    email_date: str
    agreement: str
    agreement_id: str
    status: str
    relation: str
    analysis: dict
    proposal: dict
    adenda: dict
    signature_simulated: bool


def confirm(state):
    answer = interrupt({'step':'confirm','title':'Confirma los datos del correo',
        'description':'Revisa el pedido y el acuerdo de referencia. El correo fue aportado manualmente; su identidad y firma no están verificadas.'})
    return {'status':'confirmed' if answer['confirmed'] else 'cancelled'}


def pertinence(state):
    answer = interrupt({'step':'pertinence','title':'¿El pedido corresponde a este proyecto?',
        'description':'Sin modelo conectado: tú indicas el resultado para probar las ramas del flujo. Esta elección no es una validación realizada por IA.'})
    relation = answer['relation']
    return {'relation':relation,'status':{'matches':'ready_for_analysis','unrelated':'blocked','unclear':'needs_clarification'}[relation]}


def clarification(state):
    answer = interrupt({'step':'clarification','title':'Falta aclarar la relación con el proyecto',
        'description':'Corrige o amplía el pedido. Volveremos a confirmar los datos y revisar su pertinencia; no avanzamos a propuestas.'})
    return {'message':answer['message'],'status':'pending_confirmation'}


def analyze(state):
    return {'status':'analysis_ready','analysis':{
        'mode':'simulation',
        'conclusion':'Ejemplo de salida: revisar si el nuevo pedido modifica el alcance. No se ha ejecutado un modelo ni determinado que sea un extra.',
        'sources':[{'kind':'agreement','id':state['agreement_id']},{'kind':'request','id':state['request_id']}],
        'missing':['Esfuerzo y disponibilidad del profesional','Precio y plazo revisados','Representante autorizado para firmar'],
    }}


def analysis_review(state):
    interrupt({'step':'analysis','title':'Revisa el resultado simulado',
        'description':'Esta salida muestra el formato futuro del agente; no es un análisis real de tu documento. Continúa para definir tú una alternativa de prueba.'})
    return {'status':'awaiting_proposal'}


def alternatives(state):
    answer=interrupt({'step':'proposal','title':'Define una alternativa de prueba',
        'description':'Elige ampliar alcance, intercambiar una entrega pendiente o separar en fases. Tú aportas alcance, adicional y días; no son estimaciones de IA.'})
    return {'proposal':answer,'status':'draft_ready'}


def draft(state):
    p=state['proposal']
    return {'adenda':{'project_id':state['project_id'],'agreement_id':state['agreement_id'],
        'reason':state['message'],'scope':p['scope'],'option':p['option'],'amount':p['amount'],
        'currency':'USD','days':p['days'],'terms':p['terms'],'signed':False},'status':'awaiting_signature_simulation'}


def signature(state):
    answer=interrupt({'step':'signature','title':'Adenda preparada · todavía sin firma',
        'description':'Para terminar la prueba puedes simular la firma de ambas partes o rechazar el borrador. No produce una firma legal, una versión aceptada ni un cobro.'})
    return {'signature_simulated':answer['signed'], 'status':'simulation_complete' if answer['signed'] else 'draft_rejected'}


def build(checkpointer):
    graph=StateGraph(State)
    for name,fn in [('confirm',confirm),('pertinence',pertinence),('clarification',clarification),('analyze',analyze),('analysis_review',analysis_review),('alternatives',alternatives),('draft',draft),('signature',signature)]:
        graph.add_node(name,fn)
    graph.add_edge(START,'confirm')
    graph.add_conditional_edges('confirm',lambda s: 'pertinence' if s['status']=='confirmed' else END,{'pertinence':'pertinence',END:END})
    graph.add_conditional_edges('pertinence',lambda s: {'matches':'analyze','unrelated':END,'unclear':'clarification'}[s['relation']],{'analyze':'analyze','clarification':'clarification',END:END})
    graph.add_edge('clarification','confirm')
    graph.add_edge('analyze','analysis_review')
    graph.add_edge('analysis_review','alternatives')
    graph.add_edge('alternatives','draft')
    graph.add_edge('draft','signature')
    graph.add_edge('signature',END)
    return graph.compile(checkpointer=checkpointer)


def validate_resume(step,value):
    if not isinstance(value,dict): raise ValueError('Respuesta inválida.')
    if step=='confirm':
        if type(value.get('confirmed')) is not bool: raise ValueError('Confirma o cancela el pedido.')
        return {'confirmed':value['confirmed']}
    if step=='pertinence':
        if value.get('relation') not in ('matches','unrelated','unclear'): raise ValueError('Selecciona la relación con el proyecto.')
        return {'relation':value['relation']}
    if step=='clarification':
        text=str(value.get('message','')).strip()
        if not 10<=len(text)<=6000: raise ValueError('La aclaración debe tener entre 10 y 6000 caracteres.')
        return {'message':text}
    if step=='analysis':
        if value.get('reviewed') is not True: raise ValueError('Confirma que revisaste el ejemplo.')
        return {'reviewed':True}
    if step=='proposal':
        if value.get('option') not in ('extra','swap','phase'): raise ValueError('Alternativa inválida.')
        scope=str(value.get('scope','')).strip()
        if not 10<=len(scope)<=2000: raise ValueError('Describe el alcance con entre 10 y 2000 caracteres.')
        try: amount=Decimal(str(value.get('amount','')))
        except InvalidOperation: raise ValueError('Importe inválido.')
        if not amount.is_finite() or not 0<=amount<=100000 or amount!=amount.quantize(Decimal('.01')): raise ValueError('Usa un importe de 0 a 100000 con hasta dos decimales.')
        days=value.get('days')
        if type(days) is not int or not 0<=days<=365: raise ValueError('Días inválidos.')
        if value['option']=='swap' and amount!=0: raise ValueError('El intercambio propuesto no tiene adicional.')
        terms=str(value.get('terms','')).strip()
        if len(terms)>2000: raise ValueError('Condiciones demasiado largas.')
        return {'option':value['option'],'scope':scope,'amount':str(amount.quantize(Decimal('.01'))),'days':days,'terms':terms}
    if step=='signature':
        if type(value.get('signed')) is not bool: raise ValueError('Elige el resultado simulado.')
        return {'signed':value['signed']}
    raise ValueError('El flujo no espera una respuesta.')
