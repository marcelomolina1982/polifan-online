from flask import request, jsonify
import time
import nest_sparrow as ns

# Esta capa convierte /nest-sparrow en una tarea única y predecible:
# encontrar 10 completas. El crecimiento 11/12/13 lo hace fixed_hole_runtime después.
# La semilla 429 + prioridad flexible/compactas es la configuración que ya produjo
# una placa real certificada sobre este conjunto de pendientes.


def _base_only_nest_sparrow():
    started=time.time()
    data=request.get_json(silent=True) or {}
    if not ns.os.path.exists(ns.SPARROW_BIN):
        return jsonify(ok=False,error='El binario Sparrow no está instalado en Render'),503

    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    if abs(width_mm-ns.PLATE_WIDTH_MM)>1 or abs(height_mm-ns.PLATE_HEIGHT_MM)>1:
        return jsonify(ok=False,error='Sparrow producción está fijado a placa 1220×580 mm'),400

    gap=max(2.5,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:32]
    if not raw:
        return jsonify(ok=False,error='No llegaron figuras a Sparrow'),400

    kits=[]; rejected=[]
    for k in raw:
        try:
            kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:
        return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits geométricos utilizables',rejected=rejected[:8]),422

    variants=ns._candidate_selections(kits,10)
    # Reordenar explícitamente para no depender del orden futuro de _candidate_selections.
    preferred=[]; rest=[]
    for label,selected in variants:
        if label=='prioridad flexible + compactas': preferred.append((label,selected))
        else: rest.append((label,selected))
    variants=preferred+rest

    attempts=[]
    # Configuración estable primero. Después rescates acotados; nunca se intenta crecer acá.
    plans=[
        (0,429,38,False,'configuración estable 429'),
        (0,429,48,False,'rescate estable 429'),
        (1,235,30,False,'compactas prioridad'),
        (2,332,26,False,'flexible área'),
        (0,701,24,True,'rotación continua final'),
    ]

    for variant_idx,seed,seconds,continuous,tag in plans:
        if variant_idx>=len(variants):
            continue
        # Límite de seguridad para que Render + certificador + relleno queden debajo del timeout del frontend.
        if time.time()-started>132:
            break
        label,selected=variants[variant_idx]
        result=ns._run_sparrow(selected,gap,seconds,seed,continuous=continuous)
        attempts.append({
            'label':f'{tag} · {label}','seed':seed,'seconds':seconds,
            'ok':result.get('ok'),'fits':result.get('fits'),
            'stripWidthMm':result.get('stripWidthMm'),
            'density':round(float(result.get('density') or 0),1),
            'solverDensity':round(float(result.get('solverDensity') or 0),1),
            'rotation':('continua' if continuous else '15°'),
            'error':result.get('error')
        })
        if result.get('ok') and result.get('fits'):
            # Devolver inmediatamente la base. fixed_hole_runtime se ocupa de rellenar huecos.
            response=ns._result_payload(selected,f'base 10 estable · {tag} · {label}',result,kits,rejected,attempts,started,None)
            try:
                payload=response.get_json()
                payload['engine']='Sparrow base 10 estable + relleno fijo + V1.7'
                payload['baseOnly']=True
                payload['baseSeed']=seed
                payload['baseProtected']=True
                return jsonify(payload)
            except Exception:
                return response

    return jsonify(
        ok=False,
        error='Sparrow no encontró las 10 con la configuración estable conocida ni sus rescates',
        engine='Sparrow base 10 estable + relleno fijo + V1.7',
        attempts=attempts,
        candidatePool=len(kits),
        rejectedCount=len(rejected),
        rejected=rejected[:8],
        elapsedSeconds=round(time.time()-started,2)
    ),422


# Monkeypatch de la función Python Y del endpoint. fixed_hole_runtime se importa después
# y captura esta función, no la versión antigua que también intentaba crecer con Sparrow.
ns.nest_sparrow=_base_only_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=_base_only_nest_sparrow
