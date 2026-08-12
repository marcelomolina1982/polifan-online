from nest_v32 import app, _kit_valid_for_plate, _kit_area_mm2, _priority, _area
from nest_v3 import _normalize_result, _solve_complete_set, _order_variants, _ids
from app import _n
from flask import request, jsonify
import time

MIN_COMPLETE=10
HIGH_DENSITY_COMPLETE=9
HIGH_DENSITY_MIN=72.0
MAX_COMPLETE=14
TOTAL_BUDGET_SECONDS=170
BEAM_WIDTH=5
MAX_BRANCHES_PER_STATE=7


def _state_key(combo):
    return tuple(sorted(_ids(combo)))


def _state_score(row, combo):
    return (
        len(combo),
        float(row.get('density',0) or 0),
        float(row.get('compactness',0) or 0),
        -sum(_priority(k) for k in combo),
    )


def _candidate_extras(window, combo):
    used=set(_ids(combo))
    remaining=[k for k in window if str(k.get('kitId') or '') not in used]
    if not remaining:
        return []
    # Mezcla prioridad y tamaño para no quedar atrapados en piezas grandes.
    urgent=sorted(remaining,key=lambda k:(_priority(k),_area(k)))[:4]
    compact=sorted(remaining,key=lambda k:(_area(k),_priority(k)))[:4]
    balanced=sorted(remaining,key=lambda k:((_area(k)/(1220.0*580.0))+(_priority(k)*0.02)))[:4]
    out=[]; seen=set()
    for k in urgent+compact+balanced:
        kid=str(k.get('kitId') or '')
        if kid and kid not in seen:
            seen.add(kid); out.append(k)
        if len(out)>=MAX_BRANCHES_PER_STATE:
            break
    return out


def _solve_combo(combo,width_mm,height_mm,spacing_mm,seconds=3,step=15):
    best=None; best_order=None; best_label=''
    for ordered,label in _order_variants(combo)[:3]:
        row=_solve_complete_set(ordered,width_mm,height_mm,spacing_mm,seconds=seconds,step=step)
        if row.get('feasible'):
            if best is None or _state_score(row,ordered)>_state_score(best,best_order):
                best=row; best_order=ordered; best_label=label
    return best,best_order,best_label


def _payload(row,combo,label,step,safe,rejected,attempts,started,ready,reason):
    normalized=_normalize_result(row,step,'progressive-beam-search')
    complete=int(normalized.get('completeFigures',0) or 0)
    density=float(normalized.get('density',0) or 0)
    return jsonify(ok=bool(ready),
        engine='PackingSolver V4 · progresivo + V1.7 certifier',
        **normalized,
        reachedMinimum=complete>=MIN_COMPLETE,
        highDensityException=bool(complete==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN),
        productionReady=bool(ready),
        minimumTarget=MIN_COMPLETE,
        highDensityTarget=HIGH_DENSITY_COMPLETE,
        highDensityMinPercent=HIGH_DENSITY_MIN,
        candidatePool=len(safe),
        selectionStrategy=label,
        searchMode='progressive-beam-search',
        resultReason=reason,
        rejectedCount=len(rejected),
        rejected=rejected[:8],
        attempts=attempts[-80:],
        elapsedSeconds=round(time.time()-started,2)), (200 if ready else 422)


@app.post('/nest-v4')
def nest_v4():
    started=time.time()
    data=request.get_json(silent=True) or {}
    try:
        kits=data.get('kits') or []
        if not kits:
            return jsonify(ok=False,error='No llegaron figuras completas al Motor V4'),400

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
        best_row=None; best_combo=[]; best_label=''; best_step=15

        # Semillas: urgentes, compactas y balanceadas. Cada una se prueba como placa válida de 1 kit.
        seed_candidates=[]; seen=set()
        for k in (window[:6]+sorted(window,key=lambda x:(_area(x),_priority(x)))[:6]):
            kid=str(k.get('kitId') or '')
            if kid and kid not in seen:
                seen.add(kid); seed_candidates.append(k)

        beam=[]
        for seed in seed_candidates:
            if time.time()-started>35: break
            row,ordered,label=_solve_combo([seed],width_mm,height_mm,spacing_mm,seconds=2,step=15)
            attempts.append({'depth':1,'figure':seed.get('figure'),'ok':bool(row),'step':15})
            if row:
                beam.append((row,ordered,label,15))
                if best_row is None or _state_score(row,ordered)>_state_score(best_row,best_combo):
                    best_row,best_combo,best_label,best_step=row,ordered,f'semilla/{label}',15
        beam=sorted(beam,key=lambda x:_state_score(x[0],x[1]),reverse=True)[:BEAM_WIDTH]

        # Crecimiento progresivo: agrega una figura por vez y conserva varias ramas buenas.
        depth=1
        while beam and depth<MAX_COMPLETE and time.time()-started<TOTAL_BUDGET_SECONDS:
            depth+=1
            next_states=[]; state_seen=set()
            step=15 if depth<=8 else (10 if depth<=10 else 5)
            seconds=2.5 if depth<=8 else (4 if depth<=10 else 5)
            for row,combo,label,old_step in beam:
                for extra in _candidate_extras(window,combo):
                    if time.time()-started>TOTAL_BUDGET_SECONDS: break
                    candidate=list(combo)+[extra]
                    key=_state_key(candidate)
                    if key in state_seen: continue
                    state_seen.add(key)
                    solved,ordered,order_label=_solve_combo(candidate,width_mm,height_mm,spacing_mm,seconds=seconds,step=step)
                    attempts.append({'depth':depth,'added':extra.get('figure'),'ok':bool(solved),'step':step,'parent':len(combo)})
                    if not solved:
                        continue
                    next_states.append((solved,ordered,f'{label}+{extra.get("figure")}/{order_label}',step))
                    if best_row is None or _state_score(solved,ordered)>_state_score(best_row,best_combo):
                        best_row,best_combo,best_label,best_step=solved,ordered,f'progresivo/{order_label}',step
                    complete=len(ordered)
                    density=float(solved.get('density',0) or 0)
                    if complete>=MIN_COMPLETE:
                        # Ya hay placa productiva. Sigue sólo si aún queda tiempo para crecer.
                        if complete>=MAX_COMPLETE or time.time()-started>TOTAL_BUDGET_SECONDS-12:
                            return _payload(best_row,best_combo,best_label,best_step,safe,rejected,attempts,started,True,'10+ completas alcanzadas progresivamente')
                    elif complete==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN:
                        # Guarda 9 de alta densidad como piso productivo, pero sigue intentando 10+.
                        pass
            if not next_states:
                break
            beam=sorted(next_states,key=lambda x:_state_score(x[0],x[1]),reverse=True)[:BEAM_WIDTH]

        if best_row is None:
            return jsonify(ok=False,error='V4 no pudo formar ni una placa parcial válida.',productionReady=False,rejected=rejected[:8],attempts=attempts[-80:],elapsedSeconds=round(time.time()-started,2)),422

        complete=len(best_combo)
        density=float(best_row.get('density',0) or 0)
        if complete>=MIN_COMPLETE:
            return _payload(best_row,best_combo,best_label,best_step,safe,rejected,attempts,started,True,'10+ completas alcanzadas progresivamente')
        if complete==HIGH_DENSITY_COMPLETE and density>=HIGH_DENSITY_MIN:
            return _payload(best_row,best_combo,best_label,best_step,safe,rejected,attempts,started,True,f'9 completas con {density:.1f}% de ocupación')

        # Importante: devuelve la mejor placa parcial real para diagnóstico; nunca vuelve a 0 artificialmente.
        normalized=_normalize_result(best_row,best_step,'progressive-best-partial')
        return jsonify(ok=False,
            engine='PackingSolver V4 · mejor parcial preservado',
            error=f'V4 llegó a {complete} completas con {density:.1f}% de ocupación. Se conserva como diagnóstico, pero no se habilita para producción.',
            **normalized,
            bestDiagnosticComplete=complete,
            bestDiagnosticDensity=round(density,1),
            productionReady=False,
            candidatePool=len(safe),
            selectionStrategy=best_label,
            rejectedCount=len(rejected),rejected=rejected[:8],
            attempts=attempts[-80:],elapsedSeconds=round(time.time()-started,2)),422
    except Exception as exc:
        return jsonify(ok=False,error=str(exc),engine='PackingSolver V4',elapsedSeconds=round(time.time()-started,2)),500
