"""Production wrapper: run V4 inside the certified safe rectangle, then spend a bounded extra budget escaping local minima.

The physical plate is 1230 x 580 mm. The browser composes the final SVG with a
6 mm X/Y offset. The hard V4 certifier currently validates against 1220 x 580,
so the runtime intentionally caps the nesting bin at 1214 x 568 mm. After the
6 mm composition offset, every solver placement remains inside x<=1220 and
y<=574, while preserving the 3 mm inter-piece gap.
"""
from flask import jsonify, request
import time
from shapely.affinity import rotate, translate

import clean_lab_v4 as v4
from sa_nesting_optimizer import anneal_plus_one

# IMPORTANT: clean_lab_v4 historically hard-coded 1230 x 580 and therefore
# ignored the dimensions sent by Vercel. Patch the module globals at import
# time; solve_v4 reads these globals at runtime, including prep, cavity fill and
# metrics. The Render service has one Gunicorn worker, so this is deterministic.
SAFE_WIDTH_MM=1214.0
SAFE_HEIGHT_MM=568.0
v4.PLATE_WIDTH_MM=SAFE_WIDTH_MM
v4.PLATE_HEIGHT_MM=SAFE_HEIGHT_MM
v4.PLATE_AREA_MM2=SAFE_WIDTH_MM*SAFE_HEIGHT_MM
v4.base.PLATE_WIDTH_MM=SAFE_WIDTH_MM
v4.base.PLATE_HEIGHT_MM=SAFE_HEIGHT_MM
v4.base.PLATE_AREA_MM2=v4.PLATE_AREA_MM2
v4.core.PLATE_WIDTH_MM=SAFE_WIDTH_MM
v4.core.PLATE_HEIGHT_MM=SAFE_HEIGHT_MM
v4.core.PLATE_AREA_MM2=v4.PLATE_AREA_MM2
v4.BUILD='best-effort-multipass-v4-safe-1214x568-2026-09-01'

ORIGINAL_SOLVE=v4.solve_v4
# No additional internal edge is required here: the browser applies 6 mm when
# composing the physical 1230 x 580 SVG. We still independently reject any SA
# placement outside the 1214 x 568 solver rectangle.
EDGE_MM=0.0
EXTRA_BUDGET_SECONDS=34


def _placed_geom(part, placement):
    return translate(
        rotate(part['geom'], float(placement.get('angle') or 0.0), origin=(0,0), use_radians=False),
        xoff=float(placement.get('xCm') or 0.0)*10.0,
        yoff=float(placement.get('yCm') or 0.0)*10.0,
    )


def _certify(rows, result, gap_mm, edge_mm=EDGE_MM):
    if not result or not result.get('fits'):
        return False, 'solver-not-fit'
    parts={str(p.get('instanceId') or ''):p for k in rows for p in (k.get('parts') or [])}
    placements=list(result.get('placements') or [])
    if len(placements)!=sum(len(k.get('parts') or []) for k in rows):
        return False, 'placement-count'
    geoms=[]
    for pl in placements:
        p=parts.get(str(pl.get('instanceId') or ''))
        if p is None:return False,'unknown-part'
        g=_placed_geom(p,pl);minx,miny,maxx,maxy=g.bounds
        if minx<edge_mm-0.05 or miny<edge_mm-0.05 or maxx>v4.PLATE_WIDTH_MM-edge_mm+0.05 or maxy>v4.PLATE_HEIGHT_MM-edge_mm+0.05:
            return False,'edge'
        geoms.append(g)
    for i,g in enumerate(geoms):
        for h in geoms[i+1:]:
            if g.intersects(h) or g.distance(h)<float(gap_mm)-0.05:
                return False,'gap-or-collision'
    return True,'ok'


def _stamp_safe_runtime(data):
    if not isinstance(data,dict):return data
    data.update({
        'build':'best-effort-multipass-v4-safe-1214x568-2026-09-01',
        'engine':'Sparrow V4 safe-area · 1214×568 + offset físico 6 mm',
        'widthCm':SAFE_WIDTH_MM/10.0,
        'heightCm':SAFE_HEIGHT_MM/10.0,
        'runtimePlateWidthMm':SAFE_WIDTH_MM,
        'runtimePlateHeightMm':SAFE_HEIGHT_MM,
        'runtimePhysicalOffsetMm':6,
        'runtimeHardCertMaxXmm':1220,
    })
    return data


def solve_v4_sa():
    payload=request.get_json(silent=True) or {}
    response=ORIGINAL_SOLVE()
    status=200;body=response
    if isinstance(response,tuple):
        body,status=response[0],int(response[1])
    data=body.get_json(silent=True) if hasattr(body,'get_json') else body
    if status!=200 or not isinstance(data,dict) or not data.get('ok'):
        return response
    _stamp_safe_runtime(data)
    if int(data.get('completeFigures') or 0)>=int(data.get('candidatePool') or 0):
        data.update({'saEscapeRan':False,'saEscapeReason':'all-candidates-fit'})
        return jsonify(data),status

    raw=sorted(payload.get('kits') or [],key=lambda k:(v4.core._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:v4.MAX_POOL_V4]
    kits=[]
    for k in raw:
        try:kits.append(v4.core._prep_kit(k,v4.PLATE_WIDTH_MM,v4.PLATE_HEIGHT_MM))
        except Exception:pass
    by_id={str(k.get('kitId') or ''):k for k in kits}
    selected=[by_id[kid] for kid in (data.get('selectedKitIds') or []) if kid in by_id]
    if len(selected)!=int(data.get('completeFigures') or 0):
        data.update({'saEscapeRan':False,'saEscapeReason':'selected-reconstruction-failed'})
        return jsonify(data),status

    attempts=list(data.get('attempts') or [])
    started=time.time();deadline=started+EXTRA_BUDGET_SECONDS
    def run_attempt(rows,label,seed,seconds):
        result=v4.core._run_sparrow(rows,v4.GAP_MM,seconds,seed,continuous=True)
        v4._attempt(attempts,'simulated-annealing-escape',label,rows,result,seed,True)
        return result

    found,diag=anneal_plus_one(
        selected,kits,int(data.get('urgentAnchorsKept') or 0),run_attempt,deadline,
        max_iterations=7,seconds_per_attempt=4,seed=119003+len(selected)*313,
    )
    data.update({
        'attempts':attempts,
        'saEscapeRan':True,
        'saIterations':int(diag.get('iterations') or 0),
        'saAcceptedWorse':int(diag.get('acceptedWorse') or 0),
        'saTarget':diag.get('target'),
        'saElapsedSeconds':round(time.time()-started,2),
        'saSuccess':False,
    })
    if found is None:
        return jsonify(data),status

    rows,result=found
    certified,reason=_certify(rows,result,v4.GAP_MM,EDGE_MM)
    data['saCertified']=bool(certified);data['saCertificationReason']=reason
    if not certified:
        return jsonify(data),status

    data.update({
        'build':'best-effort-multipass-v4-safe-1214x568-sa-certified-2026-09-01',
        'engine':'Sparrow V4 safe-area + simulated annealing + Shapely',
        'completeFigures':len(rows),
        'placements':result.get('placements') or [],
        'selectedKitIds':[k.get('kitId') for k in rows],
        'saSuccess':True,
        'stoppedBecause':'sa-plus-one-certified',
    })
    data.update(v4._metrics(rows,result))
    _stamp_safe_runtime(data)
    return jsonify(data),status
