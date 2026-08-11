from flask import request, jsonify
import time
import nest_sparrow as ns

MAX_INPUT_POOL=64
MAX_SEARCH_SECONDS=205
START_SIZE=4
TARGET_SIZE=10
BEAM_WIDTH=3


def _candidate_order(kits):
    # Prioridad productiva primero, pero favoreciendo geometrías compactas/densas.
    return sorted(kits,key=lambda k:(k['priority'],k['envelope']/max(k['area'],1.0),k['envelope'],-k['solidity']))


def _state_score(selected,result):
    placed=int(result.get('placedParts') or 0)
    expected=int(result.get('expectedParts') or len(selected)*2)
    density=float(result.get('density') or 0)
    strip=float(result.get('stripWidthMm') or 1e9)
    # Estados que colocan todo dominan; luego mayor densidad y menor ancho.
    return (1 if result.get('fits') else 0, placed/max(expected,1), density, -strip)


def _run(selected,gap,seconds,seed,continuous=False):
    return ns._run_sparrow(selected,gap,seconds,seed,continuous=continuous)


def adaptive_nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):
        return jsonify(ok=False,error='El binario Sparrow no esta instalado en Render'),503
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:
        return jsonify(ok=False,error='Sparrow produccion esta fijado a placa 1220x580 mm'),400
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_INPUT_POOL]
    if not raw:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<TARGET_SIZE:return jsonify(ok=False,error=f'Solo hay {len(kits)} kits geometricos utilizables',rejected=rejected[:8]),422

    ordered=_candidate_order(kits)
    attempts=[]
    # Semillas iniciales compactas: tres grupos distintos de 4.
    starts=[]
    for offset in (0,2,5):
        group=ordered[offset:offset+START_SIZE]
        if len(group)==START_SIZE: starts.append(group)
    beam=[]
    for sidx,selected in enumerate(starts):
        remaining=MAX_SEARCH_SECONDS-(time.time()-started)
        if remaining<12: break
        result=_run(selected,gap,min(16,int(remaining-4)),429+sidx*272,False)
        attempts.append({'stage':START_SIZE,'label':f'inicio {sidx+1}','figures':[k['figure'] for k in selected],'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'density':round(float(result.get('density') or 0),1),'stripWidthMm':result.get('stripWidthMm')})
        if result.get('ok') and result.get('fits'): beam.append((selected,result))
    if not beam:
        return jsonify(ok=False,error='Sparrow no pudo construir ni una base inicial valida de 4 completas.',attempts=attempts,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,2)),422

    # Crecer una figura completa por vez. En cada nivel conservar sólo los mejores estados.
    for size in range(START_SIZE+1,TARGET_SIZE+1):
        next_states=[]; seen=set()
        for bidx,(selected,prev_result) in enumerate(beam):
            used={k['kitId'] for k in selected}
            candidates=[k for k in ordered if k['kitId'] not in used]
            # Probar hasta 7 incorporaciones diferentes por estado, priorizando compactas.
            for cidx,cand in enumerate(candidates[:7]):
                remaining=MAX_SEARCH_SECONDS-(time.time()-started)
                if remaining<10: break
                trial=selected+[cand]
                sig=tuple(sorted(k['kitId'] for k in trial))
                if sig in seen: continue
                seen.add(sig)
                seconds=min(13 if size<9 else 18,int(remaining-4))
                seed=41+size*173+bidx*37+cidx*101
                result=_run(trial,gap,seconds,seed,continuous=(size>=9 and cidx>=4))
                attempts.append({'stage':size,'added':cand['figure'],'figures':[k['figure'] for k in trial],'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'density':round(float(result.get('density') or 0),1),'stripWidthMm':result.get('stripWidthMm')})
                if result.get('ok') and result.get('fits'):
                    next_states.append((trial,result))
            if MAX_SEARCH_SECONDS-(time.time()-started)<10: break
        if not next_states:
            best=max(attempts,key=lambda a:(int(a.get('stage') or 0),int(a.get('placedParts') or 0))) if attempts else None
            return jsonify(ok=False,error=f'Construccion incremental llego hasta {size-1} completas pero no encontro una figura compatible para llegar a {size}.',engine='Sparrow incremental + huecos + V1.7',attempts=attempts[-24:],bestAttempt=best,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap,inputKitsReceived=len(data.get('kits') or [])),422
        next_states.sort(key=lambda sr:_state_score(sr[0],sr[1]),reverse=True)
        beam=next_states[:BEAM_WIDTH]

    selected,result=beam[0]
    response=ns._result_payload(selected,'base 10 incremental protegida',result,kits,rejected,attempts[-30:],started,None)
    payload=response.get_json()
    payload.update({'engine':'Sparrow incremental + huecos + V1.7','baseProtected':True,'incrementalBase':True,'baseAttempts':len(attempts),'candidatePool':len(kits),'inputKitsReceived':len(data.get('kits') or []),'minimumGapMm':gap})
    return jsonify(payload)


ns.nest_sparrow=adaptive_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=adaptive_nest_sparrow
