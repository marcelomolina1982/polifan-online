"""Production safety guards for Sparrow.

This module patches decision/validation points only. Geometry is never scaled
or deformed.
"""
import nest_sparrow as ns
from flask import jsonify
from shapely.affinity import rotate, translate
from shapely.geometry import box

MIN_PRODUCTION_GAP_MM = 3.0
# Sparrow trabaja con aproximaciones/serializacion; pedir un poco mas evita que
# una solucion nominal de 3 mm termine certificando 2.91-2.99 mm al reconstruir.
SOLVER_GAP_SAFETY_MM = 0.20
EDGE_MARGIN_MM = 1.0

_original_run_sparrow = ns._run_sparrow
_original_result_payload = ns._result_payload


def _run_sparrow_production(selected, gap_mm, seconds, seed, continuous=False, extra_part=None):
    requested=max(MIN_PRODUCTION_GAP_MM,float(gap_mm or 0.0))
    solver_gap=requested+SOLVER_GAP_SAFETY_MM
    return _original_run_sparrow(selected,solver_gap,seconds,seed,continuous=continuous,extra_part=extra_part)


def _score_complete_first(target, result):
    return (int(target),float(result.get('density') or 0.0),-float(result.get('stripWidthMm') or 1e18))


def _geometry_for(part, placement):
    g=rotate(part['geom'],float(placement.get('angle') or 0.0),origin=(0,0),use_radians=False)
    return translate(g,xoff=float(placement.get('xCm') or 0.0)*10.0,yoff=float(placement.get('yCm') or 0.0)*10.0)


def _validate_final_geometry(selected, result):
    safe_plate=box(EDGE_MARGIN_MM,EDGE_MARGIN_MM,ns.PLATE_WIDTH_MM-EDGE_MARGIN_MM,ns.PLATE_HEIGHT_MM-EDGE_MARGIN_MM)
    part_by_instance={}
    for kit in selected:
        for part in kit.get('parts') or []:part_by_instance[part['instanceId']]=part
    placements=list(result.get('placements') or [])
    geoms=[]
    for placement in placements:
        part=part_by_instance.get(placement.get('instanceId'))
        if part is None:
            if placement.get('partialExtra'):continue
            return False,{'reason':'placement sin geometría origen'}
        g=_geometry_for(part,placement)
        if not safe_plate.covers(g):
            return False,{'reason':'pieza fuera del margen interno de 1 mm','bounds':tuple(round(v,4) for v in g.bounds)}
        geoms.append((placement.get('instanceId'),g))
    min_gap=None; min_pair=None
    for i in range(len(geoms)):
        ida,a=geoms[i]
        for j in range(i+1,len(geoms)):
            idb,b=geoms[j]
            if a.intersects(b):return False,{'reason':'colisión geométrica','pair':[ida,idb],'gapMm':0.0}
            d=float(a.distance(b))
            if min_gap is None or d<min_gap:min_gap=d;min_pair=[ida,idb]
            # Regla dura: CERTIFICADO sólo con 3.000000 mm reales o más.
            if d<MIN_PRODUCTION_GAP_MM:
                return False,{'reason':'gap geométrico menor a 3 mm','pair':[ida,idb],'gapMm':round(d,9),'requiredGapMm':MIN_PRODUCTION_GAP_MM}
    return True,{'minimumGapMmCertified':round(min_gap,9) if min_gap is not None else None,'minimumGapPair':min_pair,'requiredGapMm':MIN_PRODUCTION_GAP_MM,'solverRequestedGapMm':MIN_PRODUCTION_GAP_MM+SOLVER_GAP_SAFETY_MM,'edgeMarginMmCertified':EDGE_MARGIN_MM,'collisionCount':0,'outsidePlateCount':0}


def _result_payload_certified(selected,label,result,kits,rejected,attempts,started,extra_part=None):
    valid,certificate=_validate_final_geometry(selected,result)
    if not valid:
        return jsonify(ok=False,error='Sparrow rechazó la solución en la certificación final de producción',productionCertificate=certificate,completeFigures=len(selected),attempts=attempts),422
    response=_original_result_payload(selected,label,result,kits,rejected,attempts,started,extra_part)
    try:
        payload=response.get_json()
        if isinstance(payload,dict):
            payload['productionCertificate']=certificate
            # La UI debe mostrar el valor MEDIDO, no el mínimo solicitado.
            payload['minimumGapMm']=certificate.get('minimumGapMmCertified')
            payload['requiredGapMm']=MIN_PRODUCTION_GAP_MM
            payload['edgeMarginMm']=EDGE_MARGIN_MM
            return jsonify(payload)
    except Exception:pass
    return response

ns._run_sparrow=_run_sparrow_production
ns._score=_score_complete_first
ns._result_payload=_result_payload_certified
ns._validate_final_geometry=_validate_final_geometry
ns.MIN_PRODUCTION_GAP_MM=MIN_PRODUCTION_GAP_MM
ns.EDGE_MARGIN_MM=EDGE_MARGIN_MM
