from flask import request, jsonify
import time
import nest_sparrow as ns

# EMERGENCIA REAL DE PRODUCCION:
# - no dejar al usuario 200+ segundos sin una placa;
# - usar el gap minimo productivo permitido (2.5 mm);
# - diversificar la seleccion para no forzar siempre 5 urgentes enormes;
# - intentar 10 -> 4 y devolver la primera placa certificada que entre;
# - si nada entra dentro del presupuesto, cortar y devolver error rapido: NO volver
#   a encadenar el solver viejo otros 100+ segundos.
MIN_FALLBACK_SIZE = 4
MAX_FALLBACK_SECONDS = 72
MAX_VARIANTS_PER_SIZE = 4
SEEDS = (41, 429, 701, 1701)


def _unique(rows, size):
    out=[]; seen=set()
    for label, selected in rows:
        selected=list(selected)[:size]
        if len(selected) != size:
            continue
        sig=tuple(str(k.get('kitId') or '') for k in selected)
        if sig in seen:
            continue
        seen.add(sig); out.append((label, selected))
    return out


def _manual_variants(kits, size):
    if len(kits) < size:
        return []
    pool=kits[:min(24, len(kits))]
    compact=sorted(pool, key=lambda k:(float(k.get('envelope') or 1e30), -float(k.get('solidity') or 0), ns._priority(k)))
    dense=sorted(pool, key=lambda k:(-float(k.get('solidity') or 0), float(k.get('envelope') or 1e30), ns._priority(k)))
    area_small=sorted(pool, key=lambda k:(float(k.get('area') or 1e30), float(k.get('envelope') or 1e30), ns._priority(k)))
    rows=[]
    # Mantener prioridad, pero variar cuantas urgentes quedan fijas. En casos duros
    # esto permite sacar 1-3 figuras grandes que bloquean toda la placa.
    for urgent in (min(4,size), min(3,size), min(2,size)):
        head=pool[:urgent]
        used={str(k.get('kitId') or '') for k in head}
        for label, source in (('compacta',compact),('solida',dense),('area-chica',area_small)):
            tail=[k for k in source if str(k.get('kitId') or '') not in used]
            rows.append((f'{urgent} urgentes + {label}', head + tail[:max(0,size-urgent)]))
    rows.append(('compacta pura', compact[:size]))
    rows.append(('prioridad pura', pool[:size]))
    try:
        rows.extend(ns._candidate_selections(kits,size))
    except Exception:
        pass
    return _unique(rows,size)[:MAX_VARIANTS_PER_SIZE]


def _try_cuttable_plate():
    started=time.time(); data=request.get_json(silent=True) or {}
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    # La UI productiva admite 2.5 mm como minimo absoluto. No forzar 3 mm aqui.
    requested=max(2.5,ns._n(data.get('gapCm'),.25)*10)
    gap=min(3.0, requested)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:40]
    kits=[]; rejected=[]
    for k in raw:
        try:
            kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits) < MIN_FALLBACK_SIZE:
        return jsonify(ok=False,error=f'Solo hay {len(kits)} figuras geometricas utilizables para corte de emergencia.',rejected=rejected[:8]),422

    attempts=[]
    start_size=min(10,len(kits))
    for size in range(start_size, MIN_FALLBACK_SIZE-1, -1):
        variants=_manual_variants(kits,size)
        for idx,(label,selected) in enumerate(variants):
            remaining=MAX_FALLBACK_SECONDS-(time.time()-started)
            if remaining < 5.0:
                return jsonify(ok=False,error='Corte de emergencia: no se encontro una placa certificada dentro de 72 s.',engine='Sparrow emergencia rapida',attempts=attempts,rejected=rejected[:8]),422
            # Corridas cortas y muchas variantes. En produccion importa entregar algo
            # util rapido, no demostrar optimalidad.
            seconds=max(4,min(7,int(remaining-2)))
            seed=SEEDS[idx % len(SEEDS)] + size*31
            result=ns._run_sparrow(selected,gap,seconds,seed,continuous=False)
            attempts.append({'size':size,'label':label,'seed':seed,'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1)})
            if result.get('ok') and result.get('fits'):
                response=ns._result_payload(selected,f'EMERGENCIA RAPIDA · placa valida de {size}',result,kits,rejected,attempts,started,None)
                payload=response.get_json()
                payload.update({
                    'engine':'Sparrow emergencia rapida 2.5mm',
                    'emergencyFallback':True,
                    'reachedMinimum':size>=10,
                    'completeCount':size,
                    'completeFigures':size,
                    'minimumGapMm':gap,
                    'message':f'Placa de emergencia valida: {size} figuras completas en {round(time.time()-started,1)} s.'
                })
                return jsonify(payload)
    return jsonify(ok=False,error='Corte de emergencia: ninguna combinacion de 10 a 4 entro certificada.',engine='Sparrow emergencia rapida',attempts=attempts,rejected=rejected[:8]),422


def emergency_cut_solver():
    return _try_cuttable_plate()

ns.nest_sparrow=emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=emergency_cut_solver
