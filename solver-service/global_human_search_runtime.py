"""Sparrow V1.14 Global Human Search.

Parte de una placa ya válida (V1.13) y busca superar óptimos locales con una fase
agresiva de destroy-and-repair. Prueba +1 directa, quitar 1/agregar 2,
quitar 2/agregar 3 y quitar 3/agregar 4; además cambia ordenes y semillas.
Sólo reemplaza la solución base si la nueva queda certificada y mejora la ocupación
real de placa. Si no mejora, devuelve exactamente la solución anterior.
"""
from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

LAB_GAP_MM = 2.5
MAX_EXTRA_SECONDS = 95.0
SEEDS = (101, 307, 911, 1701, 4099, 7919, 12011, 31337, 48017, 65537, 91081)


def _prepare_kits(data):
    width=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:72]
    out=[]
    for k in raw:
        try:
            p=ns._prep_kit(k,width,height)
            p['date']=str(k.get('date') or '')
            out.append(p)
        except Exception:
            pass
    return out


def _certified(selected,result):
    if not (result and result.get('fits')): return False,{}
    validator=getattr(ns,'_validate_final_geometry',None)
    if validator is None: return False,{'reason':'validator missing'}
    try: valid,cert=validator(selected,result)
    except Exception as exc: return False,{'reason':str(exc)}
    gap=cert.get('minimumGapMmCertified')
    required=float(getattr(ns,'MIN_PRODUCTION_GAP_MM',LAB_GAP_MM))
    return bool(valid and gap is not None and float(gap)>=required),cert


def _score(selected,result):
    density=float((result or {}).get('density') or 0.0)
    width=float((result or {}).get('stripWidthMm') or 1e18)
    return (round(density,4),len(selected),-width)


def _better(selected,result,best_selected,best_result):
    return _score(selected,result)>_score(best_selected,best_result)


def _priority_key(k):
    return (str(k.get('date') or '9999-12-31'), int(k.get('priority') or 999999))


def _candidate_sets(selected,kits,max_sets=34):
    """Genera vecindarios destroy-and-repair alrededor de la mejor placa actual."""
    chosen={str(k.get('kitId')) for k in selected}
    extras=[k for k in kits if str(k.get('kitId')) not in chosen]
    extras=sorted(extras,key=lambda k:(_priority_key(k),-float(k.get('area') or 0),float(k.get('envelope') or 1e18)))
    removable=sorted(selected,key=lambda k:(float(k.get('area') or 0),-float(k.get('envelope') or 0)))
    out=[];seen=set()
    def add(group,label):
        if len(group)<10:return
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:return
        seen.add(sig);out.append((label,list(group)))
    # +1 directa: misma composición + cada una de las candidatas más prometedoras.
    for idx,new in enumerate(extras[:10]): add(list(selected)+[new],f'plus1-{idx}')
    # destroy 1 / repair 2
    for ridx,old in enumerate(removable[:7]):
        core=[k for k in selected if str(k.get('kitId'))!=str(old.get('kitId'))]
        for eoff in range(min(6,max(0,len(extras)-1))):
            add(core+extras[eoff:eoff+2],f'd1r2-{ridx}-{eoff}')
            if len(out)>=max_sets:return out
    # destroy 2 / repair 3
    for ridx,pair in enumerate(combinations(removable[:6],2)):
        ids={str(x.get('kitId')) for x in pair}; core=[k for k in selected if str(k.get('kitId')) not in ids]
        for eoff in range(min(4,max(0,len(extras)-2))):
            add(core+extras[eoff:eoff+3],f'd2r3-{ridx}-{eoff}')
            if len(out)>=max_sets:return out
    # destroy 3 / repair 4: menos combinaciones pero más agresivas.
    for ridx,trio in enumerate(combinations(removable[:5],3)):
        ids={str(x.get('kitId')) for x in trio}; core=[k for k in selected if str(k.get('kitId')) not in ids]
        if len(extras)>=4:add(core+extras[:4],f'd3r4-{ridx}')
        if len(out)>=max_sets:return out
    return out[:max_sets]


def _orders(group):
    """Mismo conjunto, distinto orden: imita distintas decisiones humanas de inserción."""
    by_big=sorted(group,key=lambda k:(-float(k.get('area') or 0),float(k.get('envelope') or 1e18)))
    by_compact=sorted(group,key=lambda k:(float(k.get('envelope') or 1e18)-float(k.get('area') or 0),-float(k.get('area') or 0)))
    by_priority=sorted(group,key=lambda k:(_priority_key(k),-float(k.get('area') or 0)))
    zig=[]
    left=0;right=len(by_big)-1
    while left<=right:
        zig.append(by_big[left]);left+=1
        if left<=right:zig.append(by_big[right]);right-=1
    return [('big-first',by_big),('compact-first',by_compact),('priority-first',by_priority),('zigzag',zig)]


def with_global_human_search(base_solver):
    def solver():
        started=time.time()
        response=base_solver()
        try: payload=response.get_json() if hasattr(response,'get_json') else None
        except Exception: payload=None
        if not isinstance(payload,dict) or not payload.get('ok') or int(payload.get('completeFigures') or 0)<10:
            return response
        data=request.get_json(silent=True) or {}
        kits=_prepare_kits(data)
        if len(kits)<11:return response
        selected_ids=[]
        for pl in payload.get('placements') or []:
            if pl.get('partialExtra'):continue
            kid=str(pl.get('kitId') or '')
            if kid and kid not in selected_ids:selected_ids.append(kid)
        selected=[k for k in kits if str(k.get('kitId')) in set(selected_ids)]
        if len(selected)<10:return response

        # Representación del baseline para comparar; jamás se pierde.
        best_selected=list(selected)
        best_result={'density':float(payload.get('density') or 0),'stripWidthMm':float(payload.get('stripWidthMm') or 1220),'placements':list(payload.get('placements') or []),'fits':True}
        baseline_score=_score(best_selected,best_result)
        trace=[];attempt_no=0

        for label,group in _candidate_sets(best_selected,kits,34):
            if time.time()-started>MAX_EXTRA_SECONDS:break
            for order_label,ordered in _orders(group):
                if time.time()-started>MAX_EXTRA_SECONDS:break
                # dos semillas por orden; suficiente diversidad sin disparar el tiempo.
                for local in range(2):
                    if time.time()-started>MAX_EXTRA_SECONDS:break
                    seed=SEEDS[attempt_no%len(SEEDS)] + len(group)*1009 + local*7919
                    attempt_no+=1
                    remaining=MAX_EXTRA_SECONDS-(time.time()-started)
                    budget=min(3.6,max(1.8,remaining-0.25))
                    try:r=ns._run_sparrow(ordered,LAB_GAP_MM,budget,seed,continuous=True)
                    except Exception as exc:
                        trace.append({'phase':label,'order':order_label,'count':len(group),'ok':False,'error':str(exc)[:120]});continue
                    valid,cert=_certified(ordered,r)
                    trace.append({'phase':label,'order':order_label,'count':len(group),'ok':bool(valid),'density':round(float((r or {}).get('density') or 0),2),'width':round(float((r or {}).get('stripWidthMm') or 0),1),'gap':cert.get('minimumGapMmCertified'),'seed':seed})
                    if valid and _better(ordered,r,best_selected,best_result):
                        best_selected,best_result=list(ordered),r
                    # Si ya sumamos al menos una completa Y mejoramos claramente el área, salir rápido.
                    if len(best_selected)>=len(selected)+1 and float(best_result.get('density') or 0)>=max(70.0,float(payload.get('density') or 0)+1.0):break
                if len(best_selected)>=len(selected)+1 and float(best_result.get('density') or 0)>=max(70.0,float(payload.get('density') or 0)+1.0):break

        if _score(best_selected,best_result)<=baseline_score:
            payload['globalHumanSearch']=True
            payload['globalHumanSearchImproved']=False
            payload['globalHumanSearchAttempts']=attempt_no
            payload['globalHumanSearchTrace']=trace[-24:]
            payload['engine']=str(payload.get('engine') or 'Sparrow')+' + V1.14 Global Human Search (sin mejora; conservó baseline)'
            return jsonify(payload)

        # Construimos el payload mejorado conservando telemetría útil del baseline.
        payload['placements']=best_result.get('placements') or []
        payload['density']=float(best_result.get('density') or 0)
        payload['stripWidthMm']=float(best_result.get('stripWidthMm') or 0)
        payload['completeFigures']=len(best_selected)
        payload['placedParts']=int(best_result.get('placedParts') or len(payload['placements']))
        payload['expectedParts']=int(best_result.get('expectedParts') or len(payload['placements']))
        payload['partialExtraAllowed']=False
        payload['partialExtra']=None
        payload['partialExtras']=[]
        payload['partialExtraCount']=0
        payload['loosePartFill']=False
        payload['unusedRightMm']=max(0.0,1220.0-float(payload.get('stripWidthMm') or 1220.0))
        payload['globalHumanSearch']=True
        payload['globalHumanSearchImproved']=True
        payload['globalHumanSearchAttempts']=attempt_no
        payload['globalHumanSearchBaselineDensity']=float(baseline_score[0])
        payload['globalHumanSearchBaselineCount']=len(selected)
        payload['globalHumanSearchTrace']=trace[-24:]
        payload['optimizationPriority']='plate-area-first-global-search'
        payload['selectorVersion']='smart-v114-global-human-search'
        payload['engine']='Sparrow V1.14 Global Human Search · destroy-and-repair · certificado'
        return jsonify(payload)
    solver.__name__=getattr(base_solver,'__name__','solver')+'_global_human'
    solver.polifan_global_human_search=True
    return solver
