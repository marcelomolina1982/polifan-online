from flask import request, jsonify
import time
import nest_sparrow as ns

MAX_INPUT_POOL=64
MAX_SEARCH_SECONDS=220
START_SIZE=4
TARGET_SIZE=10
BEAM_WIDTH=4
ADD_LIMIT=9
BACKTRACK_LIMIT=12


def _candidate_order(kits):
    return sorted(kits,key=lambda k:(k['priority'],k['envelope']/max(k['area'],1.0),k['envelope'],-k['solidity']))


def _state_score(selected,result):
    placed=int(result.get('placedParts') or 0); expected=int(result.get('expectedParts') or len(selected)*2)
    density=float(result.get('density') or 0); strip=float(result.get('stripWidthMm') or 1e9)
    return (1 if result.get('fits') else 0,placed/max(expected,1),density,-strip)


def _run(selected,gap,seconds,seed,continuous=False):
    return ns._run_sparrow(selected,gap,seconds,seed,continuous=continuous)


def _record(attempts,stage,trial,result,**extra):
    row={'stage':stage,'figures':[k['figure'] for k in trial],'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'density':round(float(result.get('density') or 0),1),'stripWidthMm':result.get('stripWidthMm')}
    row.update(extra); attempts.append(row)


def _backtrack_expand(beam,ordered,size,gap,attempts,started):
    """Si N->N+1 falla, reemplaza una pieza del estado N y agrega otra distinta.
    Es backtracking de profundidad 1: no explota combinatoriamente y conserva prioridad.
    """
    rescued=[]; seen=set(); tries=0
    for bidx,(selected,_) in enumerate(beam):
        # Cambiar primero las piezas geometricamente mas costosas, preservando las 2 mas urgentes.
        removable=list(range(len(selected)))
        removable.sort(key=lambda i:(selected[i]['priority']<=1,selected[i]['envelope'],-selected[i]['solidity']),reverse=True)
        for ridx in removable[:4]:
            kept=[k for i,k in enumerate(selected) if i!=ridx]
            used={k['kitId'] for k in kept}
            alternatives=[k for k in ordered if k['kitId'] not in used]
            # Dos nuevas piezas: una sustituye la retirada y otra permite crecer al nivel siguiente.
            for a in range(min(6,len(alternatives))):
                for b in range(a+1,min(9,len(alternatives))):
                    if tries>=BACKTRACK_LIMIT:return rescued
                    remaining=MAX_SEARCH_SECONDS-(time.time()-started)
                    if remaining<10:return rescued
                    trial=kept+[alternatives[a],alternatives[b]]
                    sig=tuple(sorted(k['kitId'] for k in trial))
                    if sig in seen:continue
                    seen.add(sig); tries+=1
                    result=_run(trial,gap,min(15,int(remaining-4)),9001+size*211+bidx*53+ridx*17+tries*29,continuous=(size>=8 and tries>6))
                    _record(attempts,size,trial,result,mode='backtrack-1',removed=selected[ridx]['figure'],added=[alternatives[a]['figure'],alternatives[b]['figure']])
                    if result.get('ok') and result.get('fits'):rescued.append((trial,result))
    return rescued


def adaptive_nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):return jsonify(ok=False,error='El binario Sparrow no esta instalado en Render'),503
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10); height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:return jsonify(ok=False,error='Sparrow produccion esta fijado a placa 1220x580 mm'),400
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_INPUT_POOL]
    if not raw:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<TARGET_SIZE:return jsonify(ok=False,error=f'Solo hay {len(kits)} kits geometricos utilizables',rejected=rejected[:8]),422

    ordered=_candidate_order(kits); attempts=[]; beam=[]
    for sidx,offset in enumerate((0,2,5,8)):
        selected=ordered[offset:offset+START_SIZE]
        if len(selected)<START_SIZE:continue
        remaining=MAX_SEARCH_SECONDS-(time.time()-started)
        if remaining<12:break
        result=_run(selected,gap,min(15,int(remaining-4)),429+sidx*272,False)
        _record(attempts,START_SIZE,selected,result,mode='inicio')
        if result.get('ok') and result.get('fits'):beam.append((selected,result))
    if not beam:return jsonify(ok=False,error='Sparrow no pudo construir una base inicial valida de 4 completas.',attempts=attempts,candidatePool=len(kits)),422

    for size in range(START_SIZE+1,TARGET_SIZE+1):
        next_states=[]; seen=set()
        for bidx,(selected,_) in enumerate(beam):
            used={k['kitId'] for k in selected}; candidates=[k for k in ordered if k['kitId'] not in used]
            for cidx,cand in enumerate(candidates[:ADD_LIMIT]):
                remaining=MAX_SEARCH_SECONDS-(time.time()-started)
                if remaining<10:break
                trial=selected+[cand]; sig=tuple(sorted(k['kitId'] for k in trial))
                if sig in seen:continue
                seen.add(sig)
                result=_run(trial,gap,min(12 if size<9 else 16,int(remaining-4)),41+size*173+bidx*37+cidx*101,continuous=(size>=9 and cidx>=5))
                _record(attempts,size,trial,result,mode='add',added=cand['figure'])
                if result.get('ok') and result.get('fits'):next_states.append((trial,result))
        if not next_states:
            # No abandonar: retroceder una pieza y probar dos alternativas para alcanzar este mismo nivel.
            next_states=_backtrack_expand(beam,ordered,size,gap,attempts,started)
        if not next_states:
            best=max(attempts,key=lambda a:(int(a.get('stage') or 0),int(a.get('placedParts') or 0))) if attempts else None
            return jsonify(ok=False,error=f'Incremental con backtracking llego hasta {size-1} completas; cambio piezas del estado anterior pero no pudo llegar a {size}.',engine='Sparrow incremental backtracking + huecos + V1.7',attempts=attempts[-32:],bestAttempt=best,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap,inputKitsReceived=len(data.get('kits') or [])),422
        next_states.sort(key=lambda sr:_state_score(sr[0],sr[1]),reverse=True); beam=next_states[:BEAM_WIDTH]

    selected,result=beam[0]
    response=ns._result_payload(selected,'base 10 incremental con backtracking',result,kits,rejected,attempts[-36:],started,None)
    payload=response.get_json(); payload.update({'engine':'Sparrow incremental backtracking + huecos + V1.7','baseProtected':True,'incrementalBase':True,'shortBacktracking':True,'baseAttempts':len(attempts),'candidatePool':len(kits),'inputKitsReceived':len(data.get('kits') or []),'minimumGapMm':gap})
    return jsonify(payload)

ns.nest_sparrow=adaptive_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=adaptive_nest_sparrow
