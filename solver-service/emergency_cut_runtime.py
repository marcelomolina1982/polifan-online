from flask import jsonify
import nest_sparrow as ns

# PRODUCCION V1.17 — SPARROW REAL, CANTIDAD FLEXIBLE DE VERDAD
# El bug anterior: aunque agregabamos candidatos 9/8/7, nest_sparrow solo prueba
# base_variants[:3] y luego [:6]. Como primero entraban TODAS las variantes de
# 10, los tamaños menores nunca llegaban a ejecutarse. Este adaptador intercala
# cantidades para que Sparrow pruebe 10, 9, 8 y 7 dentro del presupuesto real.

_original_candidate_selections = ns._candidate_selections
_original_solver = ns.nest_sparrow


def _area_first_candidate_selections(kits, _requested_target):
    by_target={}
    for target in (10,9,8,7):
        if len(kits) < target:
            continue
        rows=_original_candidate_selections(kits,target)
        if rows:
            by_target[target]=rows

    out=[]; seen=set()
    # IMPORTANTE: primero una estrategia de cada cantidad. Así los slices
    # históricos [:3]/[:6] ya no bloquean 9/8/7 detrás de seis intentos de 10.
    max_variants=max((len(v) for v in by_target.values()),default=0)
    for variant_idx in range(max_variants):
        for target in (10,9,8,7):
            variants=by_target.get(target) or []
            if variant_idx>=len(variants): continue
            label,rows=variants[variant_idx]
            sig=tuple(k.get('kitId') for k in rows)
            if sig in seen: continue
            seen.add(sig)
            out.append((f'{target} kits · {label}',rows))
    return out


def _area_first_production_ready(target,result):
    return bool(result.get('ok')) and bool(result.get('fits')) and target>=1

ns._candidate_selections=_area_first_candidate_selections
ns._production_ready=_area_first_production_ready
ns.MIN_COMPLETE=1
ns.HIGH_DENSITY_COMPLETE=0
ns.HIGH_DENSITY_MIN=0.0


def emergency_cut_solver():
    response=_original_solver()
    status=200; obj=response
    if isinstance(response,tuple):
        obj=response[0]
        if len(response)>1: status=int(response[1])
    try: payload=obj.get_json() or {}
    except Exception: payload={}
    if payload:
        payload.update({
            'areaFirst':True,
            'noArtificialMinimum':True,
            'shelfPackingDisabled':True,
            'flexibleCandidateOrder':True,
            'optimizationPriority':'sparrow-real-nesting-area-first',
            'motorPolicy':'probar 10/9/8/7 realmente; elegir mejor placa Sparrow válida',
        })
        if payload.get('ok'):
            payload['message']='Placa generada por Sparrow real con cantidad flexible.'
        return jsonify(payload),status
    return obj,status

ns.nest_sparrow=emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=emergency_cut_solver
