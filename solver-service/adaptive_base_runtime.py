from flask import request, jsonify
import time
import nest_sparrow as ns

MAX_INPUT_POOL=64
MAX_SEARCH_SECONDS=220
MAX_VARIANTS=14


def _unique_variants(rows):
    out=[]; seen=set()
    for label,selected in rows:
        sig=tuple(sorted(str(k.get('kitId') or '') for k in selected))
        if len(selected)!=10 or sig in seen: continue
        seen.add(sig); out.append((label,selected))
        if len(out)>=MAX_VARIANTS: break
    return out


def _replacement_pool(kits,used):
    remain=[k for k in kits if k['kitId'] not in used]
    compact=sorted(remain,key=lambda k:(k['envelope'],-k['solidity'],k['priority']))
    dense=sorted(remain,key=lambda k:(-k['solidity'],k['envelope'],k['priority']))
    urgent=sorted(remain,key=lambda k:(k['priority'],k['envelope']))
    out=[]; seen=set()
    for seq in (compact,dense,urgent):
        for k in seq[:12]:
            if k['kitId'] in seen: continue
            seen.add(k['kitId']); out.append(k)
    return out


def _adaptive_variants(kits):
    variants=list(ns._candidate_selections(kits,10))
    if not variants: return []
    base=variants[0][1]
    used={k['kitId'] for k in base}
    replacements=_replacement_pool(kits,used)
    # Las primeras 5 unidades mantienen prioridad. Se reemplazan primero las piezas
    # más difíciles de las otras 5: gran envelope y baja solidez.
    tail_indices=list(range(5,10))
    tail_indices.sort(key=lambda i:(base[i]['envelope'],-base[i]['solidity']),reverse=True)
    for count in (1,2,3):
        if len(replacements)<count: break
        # Dos familias por cantidad: compacta pura y una desplazada para variar forma.
        for offset in (0,2):
            chosen=replacements[offset:offset+count]
            if len(chosen)<count: continue
            rows=list(base)
            removed=[]
            for idx,new in zip(tail_indices[:count],chosen):
                removed.append(rows[idx]['figure'])
                rows[idx]=new
            variants.append((f'adaptativa cambio {count} · '+', '.join(removed)+' → '+', '.join(k['figure'] for k in chosen),rows))
    # También generar cambios sobre la segunda estrategia original: a veces la base
    # compacta y la de prioridad fallan por razones geométricas distintas.
    if len(variants)>1:
        base2=list(variants[1][1]); used2={k['kitId'] for k in base2}; repl2=_replacement_pool(kits,used2)
        idxs=list(range(5,10)); idxs.sort(key=lambda i:(base2[i]['envelope'],-base2[i]['solidity']),reverse=True)
        for count in (1,2):
            if len(repl2)<count: break
            rows=list(base2)
            for idx,new in zip(idxs[:count],repl2[:count]): rows[idx]=new
            variants.append((f'adaptativa alternativa cambio {count}',rows))
    return _unique_variants(variants)


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
    if len(kits)<10:return jsonify(ok=False,error=f'Solo hay {len(kits)} kits geometricos utilizables',rejected=rejected[:8]),422

    variants=_adaptive_variants(kits)
    attempts=[]
    # Primera pasada: muchas combinaciones, poco tiempo cada una. Si una entra, se corta.
    for idx,(label,selected) in enumerate(variants):
        remaining=MAX_SEARCH_SECONDS-(time.time()-started)
        if remaining<14: break
        seconds=min(20 if idx<4 else 16,int(remaining-4))
        seed=429 if idx==0 else 41+idx*137
        result=ns._run_sparrow(selected,gap,seconds,seed,continuous=False)
        attempts.append({'label':label,'seed':seed,'seconds':seconds,'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1),'error':result.get('error')})
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 adaptativa · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json()
            payload.update({'engine':'Sparrow adaptativo secuencial + huecos + V1.7','baseProtected':True,'adaptiveBase':True,'baseVariantsGenerated':len(variants),'baseAttempts':len(attempts),'candidatePool':len(kits),'inputKitsReceived':len(data.get('kits') or []),'minimumGapMm':gap})
            return jsonify(payload)

    # Rescate continuo sólo sobre las mejores 3 variantes, sin volver a barrer todo.
    for idx,(label,selected) in enumerate(variants[:3]):
        remaining=MAX_SEARCH_SECONDS-(time.time()-started)
        if remaining<16: break
        seconds=min(22,int(remaining-4))
        result=ns._run_sparrow(selected,gap,seconds,901+idx*211,continuous=True)
        attempts.append({'label':'continuo · '+label,'seed':901+idx*211,'seconds':seconds,'fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1),'error':result.get('error')})
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 adaptativa continua · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json(); payload.update({'engine':'Sparrow adaptativo secuencial + huecos + V1.7','baseProtected':True,'adaptiveBase':True,'baseVariantsGenerated':len(variants),'baseAttempts':len(attempts),'candidatePool':len(kits),'inputKitsReceived':len(data.get('kits') or []),'minimumGapMm':gap})
            return jsonify(payload)

    best=max(attempts,key=lambda a:(int(a.get('placedParts') or 0),-float(a.get('stripWidthMm') or 1e18))) if attempts else None
    return jsonify(ok=False,error='Sparrow probo combinaciones consecutivas cambiando 1, 2 y 3 figuras, pero no encontro una base valida de 10 dentro del presupuesto.',engine='Sparrow adaptativo secuencial + huecos + V1.7',attempts=attempts,bestAttempt=best,candidatePool=len(kits),baseVariantsGenerated=len(variants),rejectedCount=len(rejected),rejected=rejected[:8],elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap,inputKitsReceived=len(data.get('kits') or [])),422


ns.nest_sparrow=adaptive_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=adaptive_nest_sparrow
