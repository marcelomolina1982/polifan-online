from flask import request, jsonify
import time
import nest_sparrow as ns

# /nest-sparrow hace una sola tarea: encontrar una base válida de 10.
# El crecimiento 11/12/13 lo hace fixed_hole_runtime después, sin mover la base.
# Regla crítica: NUNCA consumir el timeout total del frontend.

HARD_BASE_BUDGET_SECONDS=88


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
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception as exc:rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if len(kits)<10:
        return jsonify(ok=False,error=f'Sólo hay {len(kits)} kits geométricos utilizables',rejected=rejected[:8]),422

    variants=ns._candidate_selections(kits,10)
    preferred=[]; rest=[]
    for label,selected in variants:
        if label=='prioridad flexible + compactas':preferred.append((label,selected))
        else:rest.append((label,selected))
    variants=preferred+rest

    attempts=[]
    # Presupuesto total ~82 s. El intento que ya dio una placa real recibe la mayor parte.
    # Si falla, hacemos UN rescate diferente. No repetimos cinco corridas hasta provocar timeout.
    plans=[
        (0,429,50,False,'estable 429'),
        (1,235,28,False,'rescate compacto'),
    ]

    for variant_idx,seed,seconds,continuous,tag in plans:
        elapsed=time.time()-started
        remaining=HARD_BASE_BUDGET_SECONDS-elapsed
        if remaining<12:break
        if variant_idx>=len(variants):continue
        run_seconds=max(10,min(seconds,int(remaining-6)))
        label,selected=variants[variant_idx]
        result=ns._run_sparrow(selected,gap,run_seconds,seed,continuous=continuous)
        attempts.append({'label':f'{tag} · {label}','seed':seed,'seconds':run_seconds,'ok':result.get('ok'),'fits':result.get('fits'),'stripWidthMm':result.get('stripWidthMm'),'density':round(float(result.get('density') or 0),1),'solverDensity':round(float(result.get('solverDensity') or 0),1),'rotation':('continua' if continuous else '15°'),'error':result.get('error')})
        if result.get('ok') and result.get('fits'):
            response=ns._result_payload(selected,f'base 10 · {tag} · {label}',result,kits,rejected,attempts,started,None)
            payload=response.get_json()
            payload['engine']='Sparrow base protegida + relleno fijo + V1.7'
            payload['baseOnly']=True
            payload['baseSeed']=seed
            payload['baseProtected']=True
            payload['baseBudgetSeconds']=HARD_BASE_BUDGET_SECONDS
            return jsonify(payload)

    return jsonify(ok=False,error='Sparrow terminó dentro del límite seguro pero no encontró 10 completas en estas dos combinaciones',engine='Sparrow base protegida + relleno fijo + V1.7',attempts=attempts,candidatePool=len(kits),rejectedCount=len(rejected),rejected=rejected[:8],elapsedSeconds=round(time.time()-started,2)),422


ns.nest_sparrow=_base_only_nest_sparrow
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=_base_only_nest_sparrow
