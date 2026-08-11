from flask import request, jsonify
import time
import nest_sparrow as ns

MAX_INPUT_POOL=64
MAX_SEARCH_SECONDS=205
MAX_RAW_VARIANTS=40
MAX_SPARROW_VARIANTS=6
PLATE_AREA=1220.0*580.0


def _unique_variants(rows,limit=MAX_RAW_VARIANTS):
    out=[]; seen=set()
    for label,selected in rows:
        sig=tuple(sorted(str(k.get('kitId') or '') for k in selected))
        if len(selected)!=10 or sig in seen: continue
        seen.add(sig); out.append((label,selected))
        if len(out)>=limit: break
    return out


def _replacement_pool(kits,used):
    remain=[k for k in kits if k['kitId'] not in used]
    compact=sorted(remain,key=lambda k:(k['envelope'],-k['solidity'],k['priority']))
    dense=sorted(remain,key=lambda k:(-k['solidity'],k['envelope'],k['priority']))
    small=sorted(remain,key=lambda k:(k['area'],k['envelope'],k['priority']))
    urgent=sorted(remain,key=lambda k:(k['priority'],k['envelope']))
    out=[]; seen=set()
    for seq in (compact,dense,small,urgent):
        for k in seq[:18]:
            if k['kitId'] in seen: continue
            seen.add(k['kitId']); out.append(k)
    return out


def _raw_variants(kits):
    variants=list(ns._candidate_selections(kits,10))
    bases=[rows for _,rows in variants[:4]]
    for bidx,base in enumerate(bases):
        base=list(base); used={k['kitId'] for k in base}; repl=_replacement_pool(kits,used)
        hard=list(range(10))
        hard.sort(key=lambda i:(base[i]['envelope'],-base[i]['solidity'],base[i]['priority']),reverse=True)
        # Mantener al menos 4 de los más urgentes; variar el resto.
        hard=[i for i in hard if i>=4]+[i for i in hard if i<4]
        for count in (1,2,3,4):
            for offset in (0,2,5,8):
                chosen=repl[offset:offset+count]
                if len(chosen)<count: continue
                rows=list(base); removed=[]
                for idx,new in zip(hard[:count],chosen):
                    removed.append(rows[idx]['figure']); rows[idx]=new
                variants.append((f'geo base{bidx+1} cambio {count} off{offset} · '+', '.join(removed),rows))
    return _unique_variants(variants)


def _part_dims(part):
    try:
        minx,miny,maxx,maxy=part['geom'].bounds
        return maxx-minx,maxy-miny
    except Exception:
        return 1e9,1e9


def _geometry_score(selected):
    # Filtro barato: descarta grupos imposibles por área y castiga piezas con cajas
    # envolventes grandes. Premia compactación/solidez y un poco de prioridad.
    area=sum(float(k.get('area') or 0) for k in selected)
    density=100.0*area/PLATE_AREA
    if area>PLATE_AREA*0.985: return None

    max_side_penalty=0.0
    envelope=sum(float(k.get('envelope') or 0) for k in selected)
    solidity=sum(float(k.get('solidity') or 0) for k in selected)/len(selected)
    priority=sum(float(k.get('priority') or 0) for k in selected)/len(selected)
    tall_parts=0; wide_parts=0
    for kit in selected:
        for part in kit.get('parts') or []:
            w,h=_part_dims(part)
            a,b=min(w,h),max(w,h)
            if a>580.0+1e-6 or b>1220.0+1e-6: return None
            if a>430: tall_parts+=1
            if b>760: wide_parts+=1
            max_side_penalty+=max(0.0,a-360.0)*0.05+max(0.0,b-700.0)*0.025

    # Objetivo: suficiente material para acercarse a 80%, pero no sobrecargar.
    density_penalty=abs(78.0-density)*3.0 if density<=88 else (density-88)*8.0
    envelope_ratio=envelope/max(area,1.0)
    crowd_penalty=tall_parts*18.0+wide_parts*10.0
    score=(solidity*260.0) - density_penalty - envelope_ratio*45.0 - crowd_penalty - max_side_penalty - priority*0.12
    return score,density,solidity,tall_parts,wide_parts


def _ranked_variants(kits):
    ranked=[]
    for label,rows in _raw_variants(kits):
        geo=_geometry_score(rows)
        if geo is None: continue
        score,density,solidity,tall,wide=geo
        ranked.append((score,label,rows,{'predDensity':round(density,1),'solidity':round(solidity,3),'tallParts':tall,'wideParts':wide}))
    ranked.sort(key=lambda x:x[0],reverse=True)
    return ranked[:MAX_SPARROW_VARIANTS],len(ranked)


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

    variants,ranked_count=_ranked_variants(kits)
    if not variants:
        return jsonify(ok=False,error='El prefiltro geometrico no encontro ningun grupo razonable de 10.',candidatePool=len(kits),rejected=rejected[:8]),422

    attempts=[]
    # Sparrow sólo recibe las mejores 6 combinaciones según geometría.
    for idx,(geo_score,label,selected,meta) in enumerate(variants):
        remaining=MAX_SEARCH_SECONDS-(time.time()-started)
        if remaining<18: break
        seconds=min(34 if idx<2 else 26,int(remaining-5))
        seed=(429,41,701,977,1231,1601)[idx]
        continuous=(idx>=4)
        result=ns._run_sparrow(selected,gap,seconds,seed,continuous=continuous)
        attempts.append({'label':label,'geoScore':round(geo_score,2),**meta,'seed':seed,'seconds':seconds,'rotation':'continua' if continuous else '15°','fits':result.get('fits'),'placedParts':result.get('placedParts'),'expectedParts':result.get('expectedParts'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1),'error':result.get('error')})
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 prefiltro geometrico · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json()
            payload.update({'engine':'Sparrow + prefiltro geometrico + huecos + V1.7','baseProtected':True,'adaptiveBase':True,'geometryPrefilter':True,'rankedVariants':ranked_count,'baseAttempts':len(attempts),'candidatePool':len(kits),'inputKitsReceived':len(data.get('kits') or []),'minimumGapMm':gap})
            return jsonify(payload)

    best=max(attempts,key=lambda a:(int(a.get('placedParts') or 0),-float(a.get('stripWidthMm') or 1e18))) if attempts else None
    return jsonify(ok=False,error='El prefiltro geometrico eligio las mejores combinaciones de 10, pero Sparrow no logro una base valida dentro del presupuesto.',engine='Sparrow + prefiltro geometrico + huecos + V1.7',attempts=attempts,bestAttempt=best,candidatePool=len(kits),rankedVariants=ranked_count,rejectedCount=len(rejected),rejected=rejected[:8],elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap,inputKitsReceived=len(data.get('kits') or [])),422


ns.nest_sparrow=adaptive_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=adaptive_nest_sparrow
