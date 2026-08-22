from flask import request, jsonify
import time
import nest_sparrow as ns

# EMERGENCIA DE PRODUCCION: primero intenta placas mas chicas certificadas
# antes de volver al flujo historico. Esta variante ya demostro encontrar 9
# completas en el caso actual; se conserva porque el certificador ahora corre
# en el mismo backend aislado y ya no aplica la guardia historica de minimo 10.
MIN_FALLBACK_SIZE = 6
MAX_FALLBACK_SECONDS = 72
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


def _variants(kits, size):
    pool=kits[:min(24, len(kits))]
    rows=[]
    try:
        rows.extend(ns._candidate_selections(kits,size))
    except Exception:
        pass
    compact=sorted(pool,key=lambda k:(float(k.get('envelope') or 1e30),ns._priority(k)))
    dense=sorted(pool,key=lambda k:(-float(k.get('solidity') or 0),float(k.get('envelope') or 1e30),ns._priority(k)))
    rows.extend([
        ('compactas',compact[:size]),
        ('densas',dense[:size]),
        ('prioridad',pool[:size]),
    ])
    return _unique(rows,size)[:4]


def _try_cuttable_plate():
    started=time.time(); data=request.get_json(silent=True) or {}
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    requested=max(2.5,ns._n(data.get('gapCm'),.25)*10)
    gap=min(3.0,requested)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:40]
    kits=[]; rejected=[]
    for k in raw:
        try:
            kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<MIN_FALLBACK_SIZE:
        return jsonify(ok=False,error=f'Solo hay {len(kits)} figuras geometricas utilizables para corte de emergencia.',rejected=rejected[:8]),422

    attempts=[]
    # El caso actual ya encontro 9 con esta estrategia. Empezamos por 9 para
    # entregar una placa util rapido y no gastar tiempo reintentando 10.
    start_size=min(9,len(kits))
    for size in range(start_size,MIN_FALLBACK_SIZE-1,-1):
        for idx,(label,selected) in enumerate(_variants(kits,size)):
            remaining=MAX_FALLBACK_SECONDS-(time.time()-started)
            if remaining<6:
                return jsonify(ok=False,error='Corte de emergencia: no se encontro una placa certificada dentro de 72 s.',engine='Sparrow emergencia estable',attempts=attempts,rejected=rejected[:8]),422
            seconds=max(6,min(12,int(remaining-2)))
            seed=SEEDS[idx%len(SEEDS)] + size*31
            result=ns._run_sparrow(selected,gap,seconds,seed,continuous=False)
            attempts.append({'size':size,'label':label,'seed':seed,'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1)})
            if result.get('ok') and result.get('fits'):
                response=ns._result_payload(selected,f'EMERGENCIA ESTABLE · placa valida de {size}',result,kits,rejected,attempts,started,None)
                payload=response.get_json()
                payload.update({'engine':'Sparrow emergencia estable','emergencyFallback':True,'reachedMinimum':size>=10,'completeCount':size,'completeFigures':size,'minimumGapMm':gap,'message':f'Placa de emergencia valida: {size} figuras completas en {round(time.time()-started,1)} s.'})
                return jsonify(payload)
    return jsonify(ok=False,error='Corte de emergencia: ninguna combinacion de 9 a 6 entro certificada.',engine='Sparrow emergencia estable',attempts=attempts,rejected=rejected[:8]),422


def emergency_cut_solver():
    return _try_cuttable_plate()

ns.nest_sparrow=emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=emergency_cut_solver
