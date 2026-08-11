from flask import request, jsonify
import time
import nest_sparrow as ns

# Esta etapa tiene UNA sola misión: conseguir 10 figuras completas válidas.
# Ya no depende del timeout del navegador: /nest-jobs la ejecuta en segundo plano.
# El crecimiento 11/12/13 lo hace fixed_hole_runtime sin mover esta base.
MAX_BASE_SEARCH_SECONDS=540


def _base_only_nest_sparrow():
    started=time.time()
    data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):
        return jsonify(ok=False,error='El binario Sparrow no está instalado en Render'),503

    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:
        return jsonify(ok=False,error='Sparrow producción está fijado a placa 1220×580 mm'),400

    # Producción: 3,0 mm es el mínimo real. Nunca se relaja a 2,5 mm en Sparrow.
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
    if not raw:return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400

    kits=[]; rejected=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits geométricos utilizables',rejected=rejected[:8]),422

    variants=ns._candidate_selections(kits,10)
    # La combinación que ya produjo una placa real certificada va siempre primero.
    variants=sorted(variants,key=lambda row:0 if row[0]=='prioridad flexible + compactas' else 1)
    attempts=[]

    # Varias semillas y selecciones. Como corre en background, no sacrificamos
    # confiabilidad para entrar dentro de una petición HTTP corta.
    seeds=[429,41,235,332,701,941,1901,3101]
    plan=[]
    if variants:
        # Reforzar primero la combinación históricamente exitosa.
        for seed,seconds,continuous in [(429,70,False),(41,55,False),(701,45,True)]:
            plan.append((0,seed,seconds,continuous,'base preferida'))
    # Después recorrer hasta seis combinaciones diferentes.
    for vi in range(min(6,len(variants))):
        plan.append((vi,seeds[(vi+2)%len(seeds)],48,False,'búsqueda combinatoria'))
        plan.append((vi,seeds[(vi+5)%len(seeds)],34,True,'rescate rotación continua'))

    for variant_idx,seed,seconds,continuous,tag in plan:
        elapsed=time.time()-started
        remaining=MAX_BASE_SEARCH_SECONDS-elapsed
        if remaining<18:break
        if variant_idx>=len(variants):continue
        run_seconds=max(15,min(seconds,int(remaining-8)))
        label,selected=variants[variant_idx]
        result=ns._run_sparrow(selected,gap,run_seconds,seed,continuous=continuous)
        attempts.append({
            'label':f'{tag} · {label}','seed':seed,'seconds':run_seconds,
            'ok':result.get('ok'),'fits':result.get('fits'),
            'stripWidthMm':result.get('stripWidthMm'),
            'density':round(float(result.get('density') or 0),1),
            'solverDensity':round(float(result.get('solverDensity') or 0),1),
            'rotation':('continua' if continuous else '15°'),'error':result.get('error')
        })
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 protegida · {tag} · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json()
            payload.update({
                'engine':'Sparrow asíncrono · base protegida + relleno fijo + V1.7',
                'baseOnly':True,'baseSeed':seed,'baseProtected':True,
                'baseSearchSeconds':round(time.time()-started,2),
                'baseAttempts':len(attempts),
                'minimumGapMm':gap,
            })
            return jsonify(payload)

    return jsonify(
        ok=False,
        error='Sparrow agotó la búsqueda ampliada sin encontrar una combinación válida de 10 completas a 3 mm.',
        engine='Sparrow asíncrono · base protegida + relleno fijo + V1.7',
        attempts=attempts,candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],
        elapsedSeconds=round(time.time()-started,2),minimumGapMm=gap
    ),422


ns.nest_sparrow=_base_only_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=_base_only_nest_sparrow
