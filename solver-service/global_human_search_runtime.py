"""Sparrow V1.14 Global Human Search — stress/breadth-first revision.

Parte de una placa válida y busca escapar de óptimos locales. La búsqueda global
TIENE SU PROPIO CRONÓMETRO: el tiempo usado por V1.13 para construir el baseline
no consume el presupuesto de Human Search.

Estrategia:
- +1 directa con candidatas diversas (prioridad, área y compacidad);
- quitar 1/agregar 2;
- quitar 2/agregar 3;
- quitar 3/agregar 4;
- primera ola ANCHA: una prueba de cada vecindario antes de profundizar;
- segunda ola: distintos órdenes/semillas sobre los candidatos prometedores;
- sólo reemplaza el baseline si queda certificado y mejora.
"""
from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

LAB_GAP_MM = 2.5
MAX_EXTRA_SECONDS = 108.0
SEEDS = (101, 307, 911, 1701, 4099, 7919, 12011, 31337, 48017, 65537, 91081, 131071, 196613)


def _prepare_kits(data):
    width=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height=max(1.0,ns._n(data.get('heightCm'),58)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:72]
    out=[]
    for k in raw:
        try:
            p=ns._prep_kit(k,width,height)
            p['date']=str(k.get('date') or '')
            p['sourcePriority']=k.get('priority')
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
    return (str(k.get('date') or '9999-12-31'), int(k.get('sourcePriority') or k.get('priority') or 999999))


def _diverse_extras(extras, limit=14):
    """No deja que una sola heurística esconda una candidata (caso Rosa manual)."""
    variants=[
        sorted(extras,key=lambda k:(_priority_key(k),-float(k.get('area') or 0),float(k.get('envelope') or 1e18))),
        sorted(extras,key=lambda k:(-float(k.get('area') or 0),float(k.get('envelope') or 1e18),_priority_key(k))),
        sorted(extras,key=lambda k:((float(k.get('envelope') or 1e18)-float(k.get('area') or 0)),-float(k.get('area') or 0),_priority_key(k))),
        sorted(extras,key=lambda k:(float(k.get('envelope') or 1e18),-float(k.get('area') or 0),_priority_key(k))),
    ]
    out=[];seen=set();i=0
    while len(out)<limit and any(i<len(v) for v in variants):
        for v in variants:
            if i>=len(v): continue
            k=v[i]; kid=str(k.get('kitId'))
            if kid not in seen:
                seen.add(kid);out.append(k)
                if len(out)>=limit:break
        i+=1
    return out


def _candidate_sets(selected,kits,max_sets=42):
    chosen={str(k.get('kitId')) for k in selected}
    extras0=[k for k in kits if str(k.get('kitId')) not in chosen]
    extras=_diverse_extras(extras0,14)
    # Para destruir, no sólo sacar las chicas: mezcla chicas, poco sólidas y grandes.
    rem_variants=[
        sorted(selected,key=lambda k:(float(k.get('area') or 0),-float(k.get('envelope') or 0))),
        sorted(selected,key=lambda k:(float(k.get('solidity') or 0),-float(k.get('envelope') or 0))),
        sorted(selected,key=lambda k:(-float(k.get('envelope') or 0),float(k.get('area') or 0))),
    ]
    removable=[];seen_r=set()
    for i in range(max(len(v) for v in rem_variants)):
        for v in rem_variants:
            if i>=len(v):continue
            k=v[i];kid=str(k.get('kitId'))
            if kid not in seen_r:
                seen_r.add(kid);removable.append(k)
            if len(removable)>=9:break
        if len(removable)>=9:break

    out=[];seen=set()
    def add(group,label):
        if len(group)<10:return
        sig=tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:return
        seen.add(sig);out.append((label,list(group)))

    # +1: TODOS los extras diversos se prueban antes de destroy/repair.
    for idx,new in enumerate(extras):
        add(list(selected)+[new],f'plus1-{idx}-{str(new.get("figure") or "")[:24]}')

    # Intercalamos destroy 1/2/3 de forma relativamente ancha.
    for ridx,old in enumerate(removable[:8]):
        core=[k for k in selected if str(k.get('kitId'))!=str(old.get('kitId'))]
        for eoff in range(min(4,max(0,len(extras)-1))):
            add(core+extras[eoff:eoff+2],f'd1r2-{ridx}-{eoff}')
            if len(out)>=max_sets:return out

    for ridx,pair in enumerate(combinations(removable[:7],2)):
        ids={str(x.get('kitId')) for x in pair}; core=[k for k in selected if str(k.get('kitId')) not in ids]
        for eoff in range(min(3,max(0,len(extras)-2))):
            add(core+extras[eoff:eoff+3],f'd2r3-{ridx}-{eoff}')
            if len(out)>=max_sets:return out

    for ridx,trio in enumerate(combinations(removable[:6],3)):
        ids={str(x.get('kitId')) for x in trio}; core=[k for k in selected if str(k.get('kitId')) not in ids]
        if len(extras)>=4:add(core+extras[:4],f'd3r4-{ridx}')
        if len(out)>=max_sets:return out
    return out[:max_sets]


def _orders(group):
    by_big=sorted(group,key=lambda k:(-float(k.get('area') or 0),float(k.get('envelope') or 1e18)))
    by_compact=sorted(group,key=lambda k:(float(k.get('envelope') or 1e18)-float(k.get('area') or 0),-float(k.get('area') or 0)))
    by_priority=sorted(group,key=lambda k:(_priority_key(k),-float(k.get('area') or 0)))
    zig=[];left=0;right=len(by_big)-1
    while left<=right:
        zig.append(by_big[left]);left+=1
        if left<=right:zig.append(by_big[right]);right-=1
    return [('big-first',by_big),('compact-first',by_compact),('priority-first',by_priority),('zigzag',zig)]


def with_global_human_search(base_solver):
    def solver():
        request_started=time.time()
        response=base_solver()
        try: payload=response.get_json() if hasattr(response,'get_json') else None
        except Exception: payload=None
        if not isinstance(payload,dict) or not payload.get('ok') or int(payload.get('completeFigures') or 0)<10:
            return response

        # IMPORTANTE: presupuesto nuevo, independiente de lo que tardó el baseline.
        search_started=time.time()
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

        best_selected=list(selected)
        best_result={'density':float(payload.get('density') or 0),'stripWidthMm':float(payload.get('stripWidthMm') or 1220),'placements':list(payload.get('placements') or []),'fits':True}
        baseline_score=_score(best_selected,best_result)
        trace=[];attempt_no=0
        candidates=_candidate_sets(best_selected,kits,42)

        def run_one(label, ordered, order_label, wave, budget):
            nonlocal attempt_no,best_selected,best_result
            if time.time()-search_started>=MAX_EXTRA_SECONDS:return False
            seed=SEEDS[attempt_no%len(SEEDS)] + len(ordered)*1009 + wave*104729
            attempt_no+=1
            remaining=MAX_EXTRA_SECONDS-(time.time()-search_started)
            budget=min(budget,max(1.25,remaining-.15))
            if budget<1.2:return False
            try:r=ns._run_sparrow(ordered,LAB_GAP_MM,budget,seed,continuous=True)
            except Exception as exc:
                trace.append({'phase':label,'order':order_label,'wave':wave,'count':len(ordered),'ok':False,'error':str(exc)[:120]});return True
            valid,cert=_certified(ordered,r)
            row={'phase':label,'order':order_label,'wave':wave,'count':len(ordered),'ok':bool(valid),'density':round(float((r or {}).get('density') or 0),2),'width':round(float((r or {}).get('stripWidthMm') or 0),1),'gap':cert.get('minimumGapMmCertified'),'seed':seed}
            trace.append(row)
            if valid and _better(ordered,r,best_selected,best_result):
                best_selected,best_result=list(ordered),r
                row['NEW_BEST']=True
            return True

        # OLA 1: ANCHA. Un intento big-first por candidato. Así Rosa/+1 y destroy/repair
        # reciben al menos una oportunidad antes de gastar tiempo profundizando.
        for label,group in candidates:
            if time.time()-search_started>=MAX_EXTRA_SECONDS:break
            run_one(label,_orders(group)[0][1],'big-first',1,2.05)
            if len(best_selected)>=len(selected)+1 and float(best_result.get('density') or 0)>=70.0:break

        # OLA 2: profundiza sólo si todavía no llegamos al objetivo; cambia orden.
        if float(best_result.get('density') or 0)<70.0 and time.time()-search_started<MAX_EXTRA_SECONDS:
            for label,group in candidates[:24]:
                if time.time()-search_started>=MAX_EXTRA_SECONDS:break
                for order_label,ordered in _orders(group)[1:]:
                    if time.time()-search_started>=MAX_EXTRA_SECONDS:break
                    run_one(label,ordered,order_label,2,2.45)
                    if len(best_selected)>=len(selected)+1 and float(best_result.get('density') or 0)>=70.0:break
                if len(best_selected)>=len(selected)+1 and float(best_result.get('density') or 0)>=70.0:break

        # OLA 3: semillas más largas sobre los primeros +1 y mejores vecindarios.
        if float(best_result.get('density') or 0)<70.0 and time.time()-search_started<MAX_EXTRA_SECONDS:
            for label,group in candidates[:12]:
                if time.time()-search_started>=MAX_EXTRA_SECONDS:break
                for order_label,ordered in _orders(group):
                    if time.time()-search_started>=MAX_EXTRA_SECONDS:break
                    run_one(label,ordered,order_label,3,3.2)

        improved=_score(best_selected,best_result)>baseline_score
        payload['globalHumanSearch']=True
        payload['globalHumanSearchImproved']=bool(improved)
        payload['globalHumanSearchAttempts']=attempt_no
        payload['globalHumanSearchSearchSeconds']=round(time.time()-search_started,2)
        payload['globalHumanSearchRequestSeconds']=round(time.time()-request_started,2)
        payload['globalHumanSearchCandidateSets']=len(candidates)
        payload['globalHumanSearchTrace']=trace[-40:]

        if not improved:
            payload['engine']=str(payload.get('engine') or 'Sparrow')+' + V1.14 Global Human Search (sin mejora; conservó baseline)'
            return jsonify(payload)

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
        payload['globalHumanSearchBaselineDensity']=float(baseline_score[0])
        payload['globalHumanSearchBaselineCount']=len(selected)
        payload['optimizationPriority']='plate-area-first-global-search'
        payload['selectorVersion']='smart-v114-global-human-search-stress'
        payload['engine']='Sparrow V1.14 Global Human Search · breadth-first destroy-and-repair · certificado'
        return jsonify(payload)
    solver.__name__=getattr(base_solver,'__name__','solver')+'_global_human'
    solver.polifan_global_human_search=True
    solver.polifan_global_human_revision='stress-breadth-first'
    return solver
