from flask import request, jsonify
import time
import nest_sparrow as ns

MAX_INPUT_POOL=64
MAX_SEARCH_SECONDS=245
START_SIZE=4
TARGET_SIZE=10
BEAM_WIDTH=3
ADD_LIMIT=6


def _candidate_order(kits):
    return sorted(kits,key=lambda k:(k['priority'],k['envelope']/max(k['area'],1.0),k['envelope'],-k['solidity']))

def _state_score(selected,result):
    return (float(result.get('density') or 0),-float(result.get('stripWidthMm') or 1e9))

def _run(selected,gap,seconds,seed,continuous=False):
    return ns._run_sparrow(selected,gap,seconds,seed,continuous=continuous)

def _record(attempts,stage,trial,result,mode,seed,seconds):
    attempts.append({'stage':stage,'mode':mode,'seed':seed,'seconds':seconds,'figures':[k['figure'] for k in trial],'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1),'error':result.get('error')})

def _try(trial,gap,stage,attempts,started,seed,seconds,mode,continuous=False):
    remaining=MAX_SEARCH_SECONDS-(time.time()-started)
    if remaining<12:return None
    budget=max(8,min(seconds,int(remaining-4)))
    result=_run(trial,gap,budget,seed,continuous)
    _record(attempts,stage,trial,result,mode,seed,budget)
    return result

def adaptive_nest_sparrow():
    started=time.time(); data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):return jsonify(ok=False,error='El binario Sparrow no esta instalado en Render'),503
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10); height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:return jsonify(ok=False,error='Sparrow produccion esta fijado a placa 1220x580 mm'),400
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:MAX_INPUT_POOL]
    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<TARGET_SIZE:return jsonify(ok=False,error=f'Solo hay {len(kits)} kits geometricos utilizables',rejected=rejected[:8]),422
    ordered=_candidate_order(kits); attempts=[]; beam=[]

    # 4 y 5 son sólo una preselección barata.
    for sidx,offset in enumerate((0,3,6)):
        selected=ordered[offset:offset+START_SIZE]
        if len(selected)<START_SIZE:continue
        r=_try(selected,gap,4,attempts,started,429+sidx*272,14,'inicio-15deg')
        if r and r.get('ok') and r.get('fits'):beam.append((selected,r))
    if not beam:return jsonify(ok=False,error='No se encontro una base inicial de 4.',attempts=attempts),422

    for size in range(5,TARGET_SIZE+1):
        next_states=[]; seen=set()
        # El error anterior era tratar 12-15 s como prueba de incompatibilidad. Desde 6 damos presupuesto real.
        if size==5: primary_seconds=14
        elif size==6: primary_seconds=32
        elif size<=8: primary_seconds=25
        else: primary_seconds=30
        for bidx,(selected,_) in enumerate(beam):
            used={k['kitId'] for k in selected}
            candidates=[k for k in ordered if k['kitId'] not in used]
            for cidx,cand in enumerate(candidates[:ADD_LIMIT]):
                trial=selected+[cand]; sig=tuple(sorted(k['kitId'] for k in trial))
                if sig in seen:continue
                seen.add(sig)
                seed=429+size*101+bidx*37+cidx*271
                r=_try(trial,gap,size,attempts,started,seed,primary_seconds,'crecimiento-15deg')
                if r and r.get('ok') and r.get('fits'):
                    next_states.append((trial,r)); continue
                # Desde 6, un fallo con rotaciones discretas NO significa incompatibilidad: rescate con rotación libre.
                if size>=6 and cidx<2:
                    r2=_try(trial,gap,size,attempts,started,seed+7919,22,'rescate-rotacion-libre',True)
                    if r2 and r2.get('ok') and r2.get('fits'):next_states.append((trial,r2))
                if MAX_SEARCH_SECONDS-(time.time()-started)<12:break
            if MAX_SEARCH_SECONDS-(time.time()-started)<12:break
        if not next_states:
            best=max(attempts,key=lambda a:(int(a.get('stage') or 0),int(a.get('placedParts') or 0))) if attempts else None
            return jsonify(ok=False,error=f'Sparrow con presupuesto real llego hasta {size-1} completas pero no resolvio {size} antes del limite global.',engine='Sparrow incremental presupuesto real + V1.7',attempts=attempts[-30:],bestAttempt=best,candidatePool=len(kits),elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap,inputKitsReceived=len(data.get('kits') or [])),422
        next_states.sort(key=lambda sr:_state_score(sr[0],sr[1]),reverse=True); beam=next_states[:BEAM_WIDTH]

    selected,result=beam[0]
    response=ns._result_payload(selected,'base 10 incremental presupuesto real',result,kits,rejected,attempts[-36:],started,None)
    payload=response.get_json(); payload.update({'engine':'Sparrow incremental presupuesto real + huecos + V1.7','baseProtected':True,'incrementalBase':True,'realSolverBudget':True,'baseAttempts':len(attempts),'candidatePool':len(kits),'inputKitsReceived':len(data.get('kits') or []),'minimumGapMm':gap})
    return jsonify(payload)

ns.nest_sparrow=adaptive_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:ns.app.view_functions['nest_sparrow']=adaptive_nest_sparrow
