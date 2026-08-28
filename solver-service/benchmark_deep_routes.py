from flask import jsonify, request
from clean_lab_app import app, core, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, GAP_MM
from clean_lab_v4 import solve_v4
from benchmark_routes import _validate_layout
import time


def _priority(k):
    try:return float(k.get('priority',999999))
    except:return 999999.0

def _area_hint(k):
    total=0.0
    for p in k.get('parts') or []:
        try:total+=float(p.get('widthCm') or p.get('sourceWidthCm') or 0)*float(p.get('heightCm') or p.get('sourceHeightCm') or 0)
        except:pass
    return total

def _orders(kits):
    variants=[]
    def add(label,rows):
        sig=tuple(str(k.get('kitId') or '') for k in rows)
        if sig and all(sig!=s for _,_,s in variants):variants.append((label,rows,sig))
    add('prioridad',sorted(kits,key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or ''))))
    add('compactas primero',sorted(kits,key=lambda k:(_area_hint(k),_priority(k))))
    add('grandes primero',sorted(kits,key=lambda k:(-_area_hint(k),_priority(k))))
    add('alternada',sorted(kits,key=lambda k:(_priority(k)%2,_area_hint(k),_priority(k))))
    # Mantiene los primeros urgentes y cambia el orden del resto: útil cuando una pieza incómoda bloquea cavidades.
    urgent=sorted(kits,key=lambda k:_priority(k))[:4];urgent_ids={str(k.get('kitId') or '') for k in urgent}
    tail=[k for k in kits if str(k.get('kitId') or '') not in urgent_ids]
    add('4 urgentes + compactas',urgent+sorted(tail,key=lambda k:(_area_hint(k),-_priority(k))))
    add('4 urgentes + grandes',urgent+sorted(tail,key=lambda k:(-_area_hint(k),_priority(k))))
    return [(a,b) for a,b,_ in variants]


def _prepare_all(kits):
    prepared=[];rejected=[]
    for kit in kits:
        try:prepared.append(core._prep_kit(kit,PLATE_WIDTH_MM,PLATE_HEIGHT_MM))
        except Exception as exc:rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(exc)})
    return prepared,rejected


def _run(payload):
    with app.test_request_context('/solve-v4',method='POST',json=payload):
        response=solve_v4()
    status=200;body=response
    if isinstance(response,tuple):body,status=response[0],int(response[1])
    data=body.get_json(silent=True) if hasattr(body,'get_json') else body
    return status,data if isinstance(data,dict) else {'ok':False,'error':'Respuesta inválida'}


@app.post('/replay-benchmark-deep')
def replay_benchmark_deep():
    capture=request.get_json(silent=True) or {}
    base_payload=dict(capture.get('payload') if isinstance(capture.get('payload'),dict) else capture)
    kits=list(base_payload.get('kits') or [])
    if not kits:return jsonify(ok=False,error='El benchmark no contiene kits'),422
    base_payload['widthCm']=PLATE_WIDTH_MM/10.0;base_payload['heightCm']=PLATE_HEIGHT_MM/10.0;base_payload['gapCm']=GAP_MM/10.0
    total_budget=max(120,min(720,int(capture.get('deepBudgetSeconds') or 420)));started=time.time();runs=[];best=None
    variants=_orders(kits)
    per_run=max(70,min(180,int(total_budget/max(1,len(variants)))))
    for idx,(label,ordered) in enumerate(variants):
        remaining=total_budget-(time.time()-started)
        if remaining<55:break
        payload=dict(base_payload);payload['kits']=ordered;payload['budgetSeconds']=min(per_run,int(remaining));payload['urgentAnchorCount']=4 if idx>=3 else int(base_payload.get('urgentAnchorCount') or 6)
        status,result=_run(payload)
        row={'label':label,'httpStatus':status,'ok':bool(result.get('ok')),'completeFigures':int(result.get('completeFigures') or 0),'geometricOccupancyPct':result.get('geometricOccupancyPct'),'stripWidthMm':result.get('stripWidthMm'),'elapsedSeconds':result.get('elapsedSeconds'),'traceId':result.get('traceId')}
        runs.append(row)
        if result.get('ok'):
            score=(int(result.get('completeFigures') or 0),float(result.get('geometricOccupancyPct') or 0),-float(result.get('stripWidthMm') or 1e18))
            if best is None or score>best[0]:best=(score,label,result,ordered)
    if best is None:return jsonify(ok=False,error='Ninguna estrategia produjo una placa válida',runs=runs,elapsedSeconds=round(time.time()-started,2)),422
    _,label,result,ordered=best
    prepared,rejected=_prepare_all(ordered)
    selected=set(str(x) for x in (result.get('selectedKitIds') or []));prepared_selected=[k for k in prepared if str(k.get('kitId') or '') in selected] if selected else prepared
    validation,_rows=_validate_layout(prepared_selected,result.get('placements') or [])
    return jsonify(ok=bool(validation.get('ok')),engine='Sparrow V4 deep multi-order benchmark',strategy=label,workspaceMm=[PLATE_WIDTH_MM,PLATE_HEIGHT_MM],gapMm=GAP_MM,inputKitCount=len(kits),completeFigures=int(result.get('completeFigures') or 0),geometricOccupancyPct=result.get('geometricOccupancyPct'),stripWidthMm=result.get('stripWidthMm'),placements=result.get('placements') or [],selectedKitIds=result.get('selectedKitIds') or [],layoutValidation=validation,rejected=rejected[:20],runs=runs,solverResult=result,elapsedSeconds=round(time.time()-started,2)),(200 if validation.get('ok') else 422)
