"""Read-only real production-state benchmark for the isolated motor lab.

It fetches the current app_state through Supabase REST, reconstructs the same pending
cut queue used by MotorDefinitivo, and runs Sparrow only inside this lab service.
No production rows are mutated.
"""
from flask import jsonify, request
from datetime import datetime
from zoneinfo import ZoneInfo
import json, os, re, threading, time, unicodedata, urllib.request, uuid

from clean_lab_app import app
from clean_lab_v4 import solve_v4

_jobs={}
_lock=threading.Lock()


def norm(v):
    s=unicodedata.normalize('NFD',str(v or ''))
    s=''.join(c for c in s if unicodedata.category(c)!='Mn').lower()
    return re.sub(r'[^a-z0-9]+',' ',s).strip()


def clean_alias(v):
    s=re.sub(r'\.svg$','',str(v or ''),flags=re.I)
    s=re.sub(r'\s*[·_–—-]\s*(tapa|base|figura|simple|capa.*)$','',s,flags=re.I)
    return norm(s)


def n(v,default=0):
    try:return float(v)
    except:return float(default)


def today_ar():return datetime.now(ZoneInfo('America/Argentina/Buenos_Aires')).date().isoformat()

def order_date(o):return str(o.get('delivery') or '')[:10]

def committed(o,today):
    if not o or o.get('status') in ('Cancelado','Entregado'):return False
    d=order_date(o)
    return (not d) or d>=today

def automatically_out(o,today):
    if not o or o.get('status')=='Cancelado':return False
    if o.get('status')=='Entregado':return True
    d=order_date(o);return bool(d and d<today)


def canonical_key(v):
    k=norm(v)
    known={'oso':'osito','jessie':'jessie toy story','micky':'mickey mouse','stitch':'stitch entero','feliz dia corazon':'feliz dia'}
    return known.get(k,k)


def physical_stock(db,today):
    raw={}; loose={}; out={}
    for m in db.get('movements') or []:
        fig=canonical_key(m.get('figure'))
        if not fig:continue
        comp=str(m.get('component') or '')
        q=n(m.get('qty'))
        if comp in ('tapa','base'):
            pos=str(m.get('type') or '') in ('Entrada extra','Ajuste positivo','Entrada de corte','Ajuste componente positivo')
            neg=str(m.get('type') or '') in ('Salida manual','Ajuste negativo','Ajuste componente negativo')
            if pos or neg:
                loose.setdefault(fig,{'tapa':0.0,'base':0.0})[comp]+=q if pos else -q
        else:
            pos=str(m.get('type') or '') in ('Entrada extra','Ajuste positivo','Entrada de corte')
            raw[fig]=raw.get(fig,0.0)+(q if pos else -q)
    for o in db.get('orders') or []:
        if not automatically_out(o,today):continue
        for item in o.get('items') or []:
            if item.get('inventoryTracked') is False:continue
            fig=canonical_key(item.get('figure'))
            if fig:out[fig]=out.get(fig,0.0)+n(item.get('qty'))
    physical={}
    for fig in set(raw)|set(loose)|set(out):
        t=max(0.0,n((loose.get(fig) or {}).get('tapa')));b=max(0.0,n((loose.get(fig) or {}).get('base')))
        physical[fig]=max(0.0,n(raw.get(fig))+min(t,b)-n(out.get(fig)))
    return physical


def active_cut(db):
    active={}
    for batch in db.get('cutBatches') or []:
        if batch.get('status')!='En corte':continue
        mult=max(1.0,n(batch.get('multiplier'),1))
        for item in batch.get('items') or []:
            if item.get('component') and item.get('component')!='complete':continue
            fig=canonical_key(item.get('figure'))
            if fig:active[fig]=active.get(fig,0.0)+n(item.get('qty'))*mult
    return active


def pending_rows(db):
    today=today_ar();physical=physical_stock(db,today);incut=active_cut(db);available={}
    for fig in set(physical)|set(incut):available[fig]=n(physical.get(fig))+n(incut.get(fig))
    groups={}
    orders=[o for o in (db.get('orders') or []) if committed(o,today)]
    orders.sort(key=lambda o:(order_date(o) or '9999-12-31',str(o.get('number') or '')))
    for o in orders:
        d=order_date(o);g=groups.setdefault(d or 'sin-fecha',{'date':d,'orders':[],'rows':{}})
        if o.get('number'):g['orders'].append(o.get('number'))
        for item in o.get('items') or []:
            if item.get('inventoryTracked') is False or n(item.get('qty'))<=0:continue
            fig=canonical_key(item.get('figure'))
            if not fig:continue
            qty=n(item.get('qty'));on=max(0.0,n(available.get(fig)));covered=min(on,qty);available[fig]=on-covered;missing=qty-covered
            if missing>0:g['rows'][fig]=g['rows'].get(fig,0.0)+missing
    out=[]
    for key,g in groups.items():
        rows=[{'figure':fig,'qty':int(qty) if float(qty).is_integer() else qty} for fig,qty in sorted(g['rows'].items()) if qty>0]
        if rows:out.append({'key':key,'date':g['date'],'orders':list(dict.fromkeys(g['orders'])),'rows':rows})
    out.sort(key=lambda g:g['date'] or '9999-12-31');return out


def aliases(item):return list(dict.fromkeys(x for x in (clean_alias(item.get('productName')),clean_alias(item.get('modelName')),clean_alias(item.get('name'))) if x))

def complete(items):
    simple=next((x for x in items if str(x.get('role') or 'simple')=='simple' and x.get('svgText')),None)
    if simple:return [simple]
    base=next((x for x in items if x.get('role')=='base' and x.get('svgText')),None);tapa=next((x for x in items if x.get('role')=='tapa' and x.get('svgText')),None)
    return [base,tapa] if base and tapa else None


def library_index(db):
    groups={}
    for item in db.get('svgLibrary') or []:
        aa=aliases(item);key=str(item.get('modelId') or item.get('productId') or (aa[0] if aa else '') or item.get('id') or '')
        if not key:continue
        g=groups.setdefault(key,{'key':key,'items':[],'aliases':set()});g['items'].append(item);g['aliases'].update(aa)
    rows=list(groups.values());exact={}
    for g in rows:
        for a in g['aliases']:exact.setdefault(a,[]).append(g)
    return rows,exact


def unique_complete(groups):
    good=[]
    for g in groups:
        c=complete(g['items'])
        if c:good.append((g['key'],c))
    uniq={k:c for k,c in good}
    return next(iter(uniq.values())) if len(uniq)==1 else None


def components(rows,exact,figure,mode):
    target=canonical_key(figure)
    got=unique_complete(exact.get(target) or [])
    if got:return got,'exact'
    if mode=='safe':return None,'missing-exact'
    matched=[g for g in rows if any(a==target or a in target or target in a for a in g['aliases'])]
    got=unique_complete(matched)
    return (got,'legacy-fuzzy') if got else (None,'missing')


def build_payload(db,mode):
    rows,exact=library_index(db);units=[];missing={};fuzzy={}
    for group in pending_rows(db):
        for row in group['rows']:
            comps,how=components(rows,exact,row['figure'],mode)
            if not comps:
                missing[row['figure']]=missing.get(row['figure'],0)+int(row['qty']);continue
            if how=='legacy-fuzzy':fuzzy[row['figure']]=fuzzy.get(row['figure'],0)+int(row['qty'])
            for _ in range(int(row['qty'])):units.append({'figure':row['figure'],'date':group['date'] or '', 'components':comps})
    kits=[]
    for idx,u in enumerate(units[:120]):
        kid=f'live-{idx}-{u["figure"]}'
        parts=[]
        for pidx,c in enumerate(u['components']):
            parts.append({'instanceId':f'{kid}-p{pidx}','kitId':kid,'figure':u['figure'],'name':c.get('name') or f'{u["figure"]} {c.get("role") or "pieza"}','role':c.get('role') or 'simple','svgText':c.get('svgText'),'sourceWidthCm':n(c.get('sourceWidthCm') or c.get('widthCm')),'sourceHeightCm':n(c.get('sourceHeightCm') or c.get('heightCm')),'widthCm':n(c.get('sourceWidthCm') or c.get('widthCm')),'heightCm':n(c.get('sourceHeightCm') or c.get('heightCm')),'allowRotate':True})
        kits.append({'kitId':kid,'figure':u['figure'],'date':u['date'],'priority':idx,'parts':parts})
    earliest=next((u['date'] for u in units if u['date']), '')
    same=sum(1 for u in units if earliest and u['date']==earliest)
    return {'widthCm':123,'heightCm':58,'gapCm':.3,'kits':kits,'budgetSeconds':180,'urgentAnchorCount':max(1,min(12,same or 6))},missing,fuzzy,len(units)


def fetch_db():
    url=os.environ.get('REAL_STATE_SUPABASE_URL','').rstrip('/');key=os.environ.get('REAL_STATE_SUPABASE_KEY','')
    if not url or not key:raise RuntimeError('Faltan REAL_STATE_SUPABASE_URL/KEY')
    req=urllib.request.Request(url+'/rest/v1/app_state?id=eq.main&select=data',headers={'apikey':key,'Authorization':'Bearer '+key,'Accept':'application/json'})
    with urllib.request.urlopen(req,timeout=45) as r:rows=json.loads(r.read().decode('utf-8'))
    if not rows:raise RuntimeError('Supabase no devolvió app_state/main')
    return rows[0].get('data') or {}


def run_job(job_id,mode):
    started=time.time()
    try:
        db=fetch_db();payload,missing,fuzzy,total=build_payload(db,mode)
        if not payload['kits']:raise RuntimeError('No quedaron kits con SVG para probar')
        with app.test_request_context('/solve-v4',method='POST',json=payload):resp=solve_v4()
        status=200;body=resp
        if isinstance(resp,tuple):body,status=resp[0],int(resp[1])
        data=body.get_json(silent=True) if hasattr(body,'get_json') else body
        result={'ok':bool(isinstance(data,dict) and data.get('ok')),'httpStatus':status,'mode':mode,'currentPendingUnits':total,'candidatePoolSent':len(payload['kits']),'missingSvg':missing,'legacyFuzzyUsed':fuzzy,'completeFigures':data.get('completeFigures') if isinstance(data,dict) else None,'selectedFigures':[p for p in (data.get('selectedKitIds') or [])] if isinstance(data,dict) else [],'geometricOccupancyPct':data.get('geometricOccupancyPct') if isinstance(data,dict) else None,'stripWidthMm':data.get('stripWidthMm') if isinstance(data,dict) else None,'gapMm':data.get('gapMm') if isinstance(data,dict) else None,'widthCm':data.get('widthCm') if isinstance(data,dict) else None,'heightCm':data.get('heightCm') if isinstance(data,dict) else None,'rescueRounds':data.get('rescueRounds') if isinstance(data,dict) else None,'residualAttempts':data.get('residualAttempts') if isinstance(data,dict) else None,'pairAccepted':data.get('pairAccepted') if isinstance(data,dict) else None,'swapAccepted':data.get('swapAccepted') if isinstance(data,dict) else None,'attemptCount':len(data.get('attempts') or []) if isinstance(data,dict) else 0,'error':data.get('error') if isinstance(data,dict) else 'invalid result','elapsedSeconds':round(time.time()-started,2)}
        print(json.dumps({'marker':'POLIFAN_REAL_STATE_BENCHMARK',**result},ensure_ascii=False),flush=True)
        with _lock:_jobs[job_id]={'status':'done' if result['ok'] else 'error','result':result}
    except Exception as exc:
        result={'ok':False,'mode':mode,'error':str(exc),'elapsedSeconds':round(time.time()-started,2)}
        print(json.dumps({'marker':'POLIFAN_REAL_STATE_BENCHMARK',**result},ensure_ascii=False),flush=True)
        with _lock:_jobs[job_id]={'status':'error','result':result}


@app.get('/real-state-benchmark-start')
def start_real_state_benchmark():
    mode=str(request.args.get('mode') or 'legacy').lower()
    if mode not in ('legacy','safe'):mode='legacy'
    job_id=uuid.uuid4().hex
    with _lock:_jobs[job_id]={'status':'running','startedAt':time.time(),'mode':mode}
    threading.Thread(target=run_job,args=(job_id,mode),daemon=True).start()
    return jsonify(ok=True,jobId=job_id,status='running',mode=mode,readOnly=True)

@app.get('/real-state-benchmark-status')
def real_state_benchmark_status():
    job_id=str(request.args.get('id') or '')
    with _lock:job=dict(_jobs.get(job_id) or {})
    if not job:return jsonify(ok=False,error='Trabajo no encontrado'),404
    if job.get('status')=='running':return jsonify(ok=True,jobId=job_id,status='running',mode=job.get('mode'),elapsedSeconds=round(time.time()-float(job.get('startedAt') or time.time()),2))
    return jsonify(ok=True,jobId=job_id,**job)
