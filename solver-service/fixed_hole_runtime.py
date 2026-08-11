from flask import request, jsonify
import nest_sparrow as ns
from fixed_hole_fill import try_add_complete_fixed

_original_nest_sparrow=ns.nest_sparrow


def _unwrap_response(value):
    status=200
    resp=value
    if isinstance(value,tuple):
        resp=value[0]
        if len(value)>1 and isinstance(value[1],int):status=value[1]
    try:data=resp.get_json()
    except Exception:data=None
    try:status=int(getattr(resp,'status_code',status) or status)
    except Exception:pass
    return resp,status,data


def nest_sparrow_with_fixed_holes():
    original=_original_nest_sparrow()
    resp,status,payload=_unwrap_response(original)
    if status>=400 or not isinstance(payload,dict) or not payload.get('ok'):
        return original
    if int(payload.get('completeFigures') or 0)!=10 or payload.get('partialExtra'):
        return original

    validator=getattr(ns,'_validate_final_geometry',None)
    if not callable(validator):
        return jsonify(ok=False,error='Falta certificador final de producción para el relleno fijo'),500

    data=request.get_json(silent=True) or {}
    width_mm=max(1.0,ns._n(data.get('widthCm'),122)*10)
    height_mm=max(1.0,ns._n(data.get('heightCm'),58)*10)
    gap=max(3.0,ns._n(data.get('gapCm'),.3)*10)
    raw=sorted(data.get('kits') or [],key=lambda k:(ns._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:64]
    kits=[]
    for k in raw:
        try:kits.append(ns._prep_kit(k,width_mm,height_mm))
        except Exception:pass
    if len(kits)<11:return original

    selected_ids=[]
    for pl in payload.get('placements') or []:
        kid=str(pl.get('kitId') or '')
        if kid and kid not in selected_ids:selected_ids.append(kid)
    kit_map={k['kitId']:k for k in kits}
    selected=[kit_map[k] for k in selected_ids if k in kit_map]
    if len(selected)!=10:return original

    result={
        'fits':True,
        'density':float(payload.get('density') or 0),
        'stripWidthMm':float(payload.get('stripWidthMm') or 1220),
        'placements':list(payload.get('placements') or []),
        'solverDensity':payload.get('solverDensity'),
        'continuousRotation':False,
    }

    # La base ya fue certificada por production_safety_runtime. A partir de aquí
    # cada incremento se certifica ANTES de reemplazar la mejor solución.
    best_selected=list(selected)
    best_result=dict(result)
    best_added=[]
    best_certificate=payload.get('productionCertificate')
    rejected_growth=None

    for _ in range(6):
        if len(best_selected)>=min(16,len(kits)):break
        grown=try_add_complete_fixed(best_selected,best_result,kits,gap,max_candidates=16)
        if not grown:break
        candidate_selected,candidate_result,kit=grown
        valid,certificate=validator(candidate_selected,candidate_result)
        if not valid:
            rejected_growth={
                'figure':kit.get('figure'),
                'targetCompleteFigures':len(candidate_selected),
                'productionCertificate':certificate,
            }
            break
        best_selected=candidate_selected
        best_result=candidate_result
        best_added=best_added+[kit['figure']]
        best_certificate=certificate

    if not best_added:return original

    out=dict(payload)
    out.update({
        'engine':'Sparrow + relleno fijo backtracking + V1.7',
        'completeFigures':len(best_selected),
        'placements':best_result['placements'],
        'density':best_result['density'],
        'stripWidthMm':best_result['stripWidthMm'],
        'selectionStrategy':str(payload.get('selectionStrategy') or '')+' · relleno fijo: '+', '.join(best_added),
        'targetDensityReached':float(best_result.get('density') or 0)>=80.0,
        'fixedHoleFill':True,
        'fixedHoleBacktracking':True,
        'fixedHoleFillAdded':best_added,
        'minimumGapMm':(best_certificate or {}).get('minimumGapMmCertified'),
        'requiredGapMm':3.0,
        'edgeMarginMm':float((best_certificate or {}).get('edgeMarginMmCertified') or 1.0),
        'productionCertificate':best_certificate,
        'bestSolutionPreserved':True,
        'rejectedGrowth':rejected_growth,
    })
    return jsonify(out)


if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=nest_sparrow_with_fixed_holes
