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
    # Sólo actuar sobre una placa base de 10 completa, sin parcial previo.
    if int(payload.get('completeFigures') or 0)!=10 or payload.get('partialExtra'):
        return original

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

    added=[]
    # Mantener inmutables las 10 originales y crecer por figuras completas.
    for _ in range(6):
        if len(selected)>=min(16,len(kits)):break
        grown=try_add_complete_fixed(selected,result,kits,gap,max_candidates=16)
        if not grown:break
        selected,result,kit=grown
        added.append(kit['figure'])

    if not added:return original

    # IMPORTANTE: el certificado de la base 10 ya no sirve después de agregar
    # piezas. Revalidamos TODA la placa final con la misma geometría exacta.
    validator=getattr(ns,'_validate_final_geometry',None)
    if not callable(validator):
        return jsonify(ok=False,error='Falta certificador final de producción después del relleno fijo'),500
    valid,certificate=validator(selected,result)
    if not valid:
        return jsonify(
            ok=False,
            error='Relleno fijo rechazado por certificación final de producción',
            completeFigures=len(selected),
            fixedHoleFillAdded=added,
            productionCertificate=certificate,
        ),422

    out=dict(payload)
    out.update({
        'engine':'Sparrow + relleno fijo backtracking + V1.7',
        'completeFigures':len(selected),
        'placements':result['placements'],
        'density':result['density'],
        'stripWidthMm':result['stripWidthMm'],
        'selectionStrategy':str(payload.get('selectionStrategy') or '')+' · relleno fijo: '+', '.join(added),
        'targetDensityReached':float(result.get('density') or 0)>=80.0,
        'fixedHoleFill':True,
        'fixedHoleBacktracking':True,
        'fixedHoleFillAdded':added,
        'minimumGapMm':gap,
        'edgeMarginMm':float(result.get('edgeMarginMm') or 1.0),
        'productionCertificate':certificate,
    })
    return jsonify(out)


# Reemplaza sólo la función del endpoint ya registrado. La URL /nest-sparrow no cambia.
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow']=nest_sparrow_with_fixed_holes
