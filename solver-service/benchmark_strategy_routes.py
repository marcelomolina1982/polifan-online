from flask import jsonify, request
from clean_lab_app import app, core, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, GAP_MM
from clean_lab_v4 import solve_v4
from benchmark_routes import _validate_layout
import time


def _priority(k):
    try:return float(k.get('priority') or 999999)
    except:return 999999.0


def _prep_stats(raw):
    rows=[]
    for k in raw:
        try:
            p=core._prep_kit(k,PLATE_WIDTH_MM,PLATE_HEIGHT_MM)
            rows.append((k,p))
        except Exception:
            rows.append((k,None))
    return rows


def _orders(raw):
    stats=_prep_stats(raw)
    valid=[(k,p) for k,p in stats if p is not None]
    def key_small(row):
        k,p=row;return (float(p.get('envelope') or 1e18),float(p.get('area') or 1e18),_priority(k))
    def key_dense(row):
        k,p=row;return (-float(p.get('solidity') or 0),float(p.get('envelope') or 1e18),_priority(k))
    def key_large(row):
        k,p=row;return (-float(p.get('area') or 0),-float(p.get('solidity') or 0),_priority(k))
    original=[k for k,_ in valid]
    small=[k for k,_ in sorted(valid,key=key_small)]
    dense=[k for k,_ in sorted(valid,key=key_dense)]
    large=[k for k,_ in sorted(valid,key=key_large)]
    urgent=sorted(valid,key=lambda row:(_priority(row[0]),str(row[0].get('date') or '')))
    keep=min(6,len(urgent));anchors=[k for k,_ in urgent[:keep]];anchor_ids={str(k.get('kitId')) for k in anchors}
    tail_small=[k for k in small if str(k.get('kitId')) not in anchor_ids]
    tail_dense=[k for k in dense if str(k.get('kitId')) not in anchor_ids]
    def interleave(a,b):
        out=[];seen=set()
        for i in range(max(len(a),len(b))):
            for seq in (a,b):
                if i<len(seq):
                    kid=str(seq[i].get('kitId'))
                    if kid not in seen:seen.add(kid);out.append(seq[i])
        return out
    variants=[
        ('priority',original),
        ('urgent+small',anchors+tail_small),
        ('urgent+dense',anchors+tail_dense),
        ('small-first',small),
        ('dense-first',dense),
        ('large-first',large),
        ('small-large-interleave',interleave(small,large)),
    ]
    out=[];seen=set()
    for label,rows in variants:
        sig=tuple(str(k.get('kitId')) for k in rows)
        if sig in seen:continue
        seen.add(sig);out.append((label,rows))
    return out


def _run(payload,label,kits,budget):
    data=dict(payload);data['kits']=kits;data['budgetSeconds']=budget
    started=time.time()
    with app.test_request_context('/solve-v4',method='POST',json=data):
        response=solve_v4()
    status=200;body=response
    if isinstance(response,tuple):body,status=response[0],int(response[1])
    result=body.get_json(silent=True) if hasattr(body,'get_json') else body
    return label,result if isinstance(result,dict) else {'ok':False,'error':'invalid result'},status,round(time.time()-started,2)


@app.post('/benchmark-strategies')
def benchmark_strategies():
    capture=request.get_json(silent=True) or {}
    payload=dict(capture.get('payload') if isinstance(capture.get('payload'),dict) else capture)
    raw=payload.get('kits') or []
    if not raw:return jsonify(ok=False,error='El benchmark no contiene kits'),422
    payload['widthCm']=PLATE_WIDTH_MM/10.0;payload['heightCm']=PLATE_HEIGHT_MM/10.0;payload['gapCm']=GAP_MM/10.0
    total_budget=max(90,min(420,int(capture.get('strategyBudgetSeconds') or 300)))
    strategies=_orders(raw)
    per=max(45,min(90,total_budget//max(1,len(strategies))))
    rows=[];started=time.time()
    for label,kits in strategies:
        if time.time()-started>total_budget-35:break
        name,result,status,elapsed=_run(payload,label,kits,per)
        placements=result.get('placements') or [] if isinstance(result,dict) else []
        validation={'ok':False}
        if result.get('ok') and placements:
            prepared=[]
            for k in kits:
                try:prepared.append(core._prep_kit(k,PLATE_WIDTH_MM,PLATE_HEIGHT_MM))
                except Exception:pass
            validation,_=_validate_layout(prepared,placements)
        rows.append({'strategy':name,'ok':bool(result.get('ok')),'certified':bool(validation.get('ok')),'completeFigures':int(result.get('completeFigures') or 0),'geometricOccupancyPct':float(result.get('geometricOccupancyPct') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),'elapsedSeconds':elapsed,'build':result.get('build'),'traceId':result.get('traceId'),'layoutValidation':validation,'solverResult':result})
    certified=[r for r in rows if r['ok'] and r['certified']]
    def score(r):return (r['completeFigures'],r['geometricOccupancyPct'],-r['stripWidthMm'])
    best=max(certified,key=score) if certified else (max(rows,key=score) if rows else None)
    return jsonify(ok=bool(best),workspaceMm=[PLATE_WIDTH_MM,PLATE_HEIGHT_MM],gapMm=GAP_MM,inputKitCount=len(raw),strategiesTested=len(rows),totalElapsedSeconds=round(time.time()-started,2),bestStrategy=(best.get('strategy') if best else None),bestCompleteFigures=(best.get('completeFigures') if best else 0),bestCertified=(best.get('certified') if best else False),results=rows)
