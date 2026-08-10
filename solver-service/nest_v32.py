from nest_v3 import app, _kit_valid_for_plate, _normalize_result, _kit_area_mm2, _candidate_sets, _order_variants, _solve_complete_set, _attempt_score, _ids, _priority, _area
from app import _n
from flask import request, jsonify
import time

MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
MAX_COMPLETE=14
TOTAL_BUDGET_SECONDS=170


def _valid_payload(row, combo, label, step, safe, rejected, attempts, started, high_density=False):
    source='high-density-9' if high_density else 'deep-complete-kit-search'
    normalized=_normalize_result(row,step,source)
    complete=int(normalized.get('completeFigures',0) or 0)
    density=float(normalized.get('density',row.get('density',0)) or 0)
    ready=complete>=MIN_COMPLETE or (complete==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN)
    if not ready:
        return None
    return jsonify(ok=True,
        engine='PackingSolver V3.2 · cantidad + ocupación · V1.7 certifier',
        **normalized,
        reachedMinimum=complete>=MIN_COMPLETE,
        highDensityException=bool(complete==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN),
        productionReady=True,
        minimumTarget=MIN_COMPLETE,
        highDensityTarget=HIGH_DENSITY_COMPLETE,
        highDensityMinPercent=HIGH_DENSITY_MIN,
        candidatePool=len(safe),
        selectionStrategy=label,
        searchMode='10-profundo + 9-alta-densidad',
        rejectedCount=len(rejected),
        rejected=rejected[:8],
        attempts=attempts[-60:],
        elapsedSeconds=round(time.time()-started,2))


@app.post('/nest-v32')
def nest_v32():
    started=time.time()
    data=request.get_json(silent=True) or {}
    try:
        kits=data.get('kits') or []
        if not kits:
            return jsonify(ok=False,error='No llegaron figuras completas al Motor V3.2'),400

        width_mm=max(1.0,_n(data.get('widthCm'),122)*10)
        height_mm=max(1.0,_n(data.get('heightCm'),58)*10)
        spacing_mm=max(2.5,_n(data.get('gapCm'),.3)*10)
        kits=sorted(kits,key=lambda k:(_priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))
        source_pool=kits[:min(32,len(kits))]

        safe=[]; rejected=[]
        for kit in source_pool:
            valid,detail=_kit_valid_for_plate(kit,width_mm,height_mm)
            if valid:
                row=dict(kit); row['_area']=_kit_area_mm2(kit); safe.append(row)
            else:
                rejected.append({'kitId':str(kit.get('kitId') or ''),'figure':str(kit.get('figure') or ''),'reason':str(detail)})
        if not safe:
            return jsonify(ok=False,error='Ningún kit completo tiene geometría utilizable',rejected=rejected[:10]),422

        window=safe[:min(30,len(safe))]
        attempts=[]
        best=None; best_combo=None; best_label=''; best_step=15
        ranked=[]

        # 1) Mantener la búsqueda profunda de 10 completas.
        if len(window)>=MIN_COMPLETE:
            candidates=_candidate_sets(window,MIN_COMPLETE)
            for combo,label in candidates:
                if time.time()-started>78: break
                local_best=None
                for ordered,order_label in _order_variants(combo)[:3]:
                    if time.time()-started>78: break
                    row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=4,step=15)
                    attempts.append({'target':10,'strategy':label,'order':order_label,'step':15,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'density':round(float(row.get('density',0) or 0),1)})
                    if local_best is None or _attempt_score(row)>_attempt_score(local_best[0]):
                        local_best=(row,ordered,order_label)
                    if row.get('feasible'):
                        best=row; best_combo=ordered; best_label=f'{label}/{order_label}'; best_step=15; break
                if local_best:
                    ranked.append((local_best[0],local_best[1],f'{label}/{local_best[2]}'))
                if best: break

            if not best:
                ranked=sorted(ranked,key=lambda x:_attempt_score(x[0]),reverse=True)
                shortlist=[]; seen=set()
                for row,combo,label in ranked:
                    key=tuple(sorted(_ids(combo)))
                    if key in seen: continue
                    seen.add(key); shortlist.append((combo,label))
                    if len(shortlist)>=6: break
                if not shortlist:
                    shortlist=[(c,l) for c,l in candidates[:6]]
                for combo,label in shortlist:
                    if time.time()-started>112: break
                    for ordered,order_label in _order_variants(combo)[:4]:
                        if time.time()-started>112: break
                        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=6,step=10)
                        attempts.append({'target':10,'strategy':label,'order':order_label,'step':10,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'density':round(float(row.get('density',0) or 0),1)})
                        if row.get('feasible'):
                            best=row; best_combo=ordered; best_label=f'{label}/{order_label}-10deg'; best_step=10; break
                    if best: break

            if not best:
                fine=[]; seen=set()
                for row,combo,label in sorted(ranked,key=lambda x:_attempt_score(x[0]),reverse=True):
                    key=tuple(sorted(_ids(combo)))
                    if key in seen: continue
                    seen.add(key); fine.append((combo,label))
                    if len(fine)>=3: break
                if not fine:
                    fine=[(c,l) for c,l in candidates[:3]]
                for combo,label in fine:
                    if time.time()-started>142: break
                    for ordered,order_label in _order_variants(combo)[:3]:
                        if time.time()-started>142: break
                        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=8,step=5)
                        attempts.append({'target':10,'strategy':label,'order':order_label,'step':5,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'density':round(float(row.get('density',0) or 0),1)})
                        if row.get('feasible'):
                            best=row; best_combo=ordered; best_label=f'{label}/{order_label}-5deg'; best_step=5; break
                    if best: break

        # Si hubo 10+, devolverla y luego permitir crecimiento hasta 14.
        if best:
            selected=list(best_combo or [])
            current_best=best; current_label=best_label
            selected_ids=set(_ids(selected)); failures=0
            extras=sorted([k for k in window if str(k.get('kitId') or '') not in selected_ids],key=lambda k:(_area(k),_priority(k)))
            for extra in extras:
                if len(selected)>=MAX_COMPLETE or failures>=4 or time.time()-started>TOTAL_BUDGET_SECONDS: break
                candidate=selected+[extra]
                row=_solve_complete_set(candidate,width_mm,height_mm,spacing_mm,seconds=4,step=10)
                attempts.append({'target':len(candidate),'strategy':'crecimiento','figure':str(extra.get('figure') or ''),'step':10,'ok':bool(row.get('feasible')),'density':round(float(row.get('density',0) or 0),1)})
                if row.get('feasible'):
                    selected=candidate; current_best=row; current_label='crecimiento-kit-completo'; best_step=10; failures=0
                else:
                    failures+=1
            payload=_valid_payload(current_best,selected,current_label,best_step,safe,rejected,attempts,started,False)
            if payload: return payload

        # 2) Excepción productiva: si 10 no entra, buscar 9 y quedarse con la de MAYOR ocupación.
        best9=None; best9_combo=None; best9_label=''; best9_step=15
        if len(window)>=HIGH_DENSITY_COMPLETE:
            candidates9=_candidate_sets(window,HIGH_DENSITY_COMPLETE)
            for step,seconds,max_sets,max_orders in ((15,4,12,4),(10,5,8,4),(5,7,4,3)):
                for combo,label in candidates9[:max_sets]:
                    if time.time()-started>TOTAL_BUDGET_SECONDS: break
                    for ordered,order_label in _order_variants(combo)[:max_orders]:
                        if time.time()-started>TOTAL_BUDGET_SECONDS: break
                        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=seconds,step=step)
                        density=float(row.get('density',0) or 0)
                        attempts.append({'target':9,'strategy':label,'order':order_label,'step':step,'ok':bool(row.get('feasible')),'placed':int(row.get('placedCount',0) or 0),'density':round(density,1)})
                        if row.get('feasible') and (best9 is None or density>float(best9.get('density',0) or 0)):
                            best9=row; best9_combo=ordered; best9_label=f'{label}/{order_label}-{step}deg'; best9_step=step
                        if best9 is not None and float(best9.get('density',0) or 0)>=HIGH_DENSITY_MIN:
                            break
                    if best9 is not None and float(best9.get('density',0) or 0)>=HIGH_DENSITY_MIN:
                        break
                if best9 is not None and float(best9.get('density',0) or 0)>=HIGH_DENSITY_MIN:
                    break

        if best9:
            density=float(best9.get('density',0) or 0)
            payload=_valid_payload(best9,best9_combo,best9_label,best9_step,safe,rejected,attempts,started,True)
            if payload: return payload
            return jsonify(ok=False,
                error=f'V3.2 encontró 9 completas, pero la ocupación fue {density:.1f}% y el mínimo para validar 9 es {HIGH_DENSITY_MIN:.0f}%.',
                productionReady=False,bestDiagnosticComplete=9,bestDiagnosticDensity=round(density,1),
                highDensityMinPercent=HIGH_DENSITY_MIN,candidatePool=len(safe),attempts=attempts[-60:],elapsedSeconds=round(time.time()-started,2)),422

        return jsonify(ok=False,
            error='V3.2 no encontró 10 completas ni una placa de 9 completas con alta ocupación.',
            productionReady=False,highDensityMinPercent=HIGH_DENSITY_MIN,candidatePool=len(safe),
            rejectedCount=len(rejected),rejected=rejected[:8],attempts=attempts[-60:],elapsedSeconds=round(time.time()-started,2)),422
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='PackingSolver V3.2',elapsedSeconds=round(time.time()-started,2)),500
