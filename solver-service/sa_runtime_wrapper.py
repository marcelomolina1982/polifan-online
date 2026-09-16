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
# El presupuesto extra total NO aumenta. Se reparte entre SA y un barrido corto
# de relleno compacto pensado para atacar el espacio residual del borde derecho.
EXTRA_BUDGET_SECONDS=34
SA_BUDGET_SECONDS=22
RIGHT_FILL_BUDGET_SECONDS=12
RIGHT_FILL_MAX_ATTEMPTS=4


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
        'build':'best-effort-multipass-v4-safe-1214x568-right-fill-lab-2026-09-04',
        'engine':'Sparrow V4 safe-area · SA + relleno residual acotado',
        'widthCm':SAFE_WIDTH_MM/10.0,
        'heightCm':SAFE_HEIGHT_MM/10.0,
        'runtimePlateWidthMm':SAFE_WIDTH_MM,
        'runtimePlateHeightMm':SAFE_HEIGHT_MM,
        'runtimePhysicalOffsetMm':6,
        'runtimeHardCertMaxXmm':1220,
        'rightFillLab':True,
        'rightFillBudgetSeconds':RIGHT_FILL_BUDGET_SECONDS,
    })
    return data


def _kit_compactness_key(kit):
    """Prioriza kits con componentes de poca luz horizontal y poco sobre envolvente.

    No modifica geometría ni separaciones: sólo ordena qué candidatos probar primero.
    """
    widths=[]; heights=[]; envelope=0.0; area=0.0
    for part in (kit.get('parts') or []):
        g=part.get('geom')
        if g is None or g.is_empty:continue
        minx,miny,maxx,maxy=g.bounds
        w=maxx-minx;h=maxy-miny
        widths.append(min(w,h))  # la rotación continua puede intercambiar el eje útil
        heights.append(max(w,h))
        envelope+=max(1.0,w*h)
        area+=float(g.area or 0.0)
    return (
        max(widths) if widths else 1e18,
        envelope,
        -area,
        int(kit.get('priority') or 999999),
    )


def _rightmost_x(selected,result):
    """Mide el borde derecho realmente usado por la placa válida."""
    parts={str(p.get('instanceId') or ''):p for k in selected for p in (k.get('parts') or [])}
    right=0.0
    for placement in (result or {}).get('placements') or []:
        part=parts.get(str(placement.get('instanceId') or ''))
        if part is None:continue
        right=max(right,float(_placed_geom(part,placement).bounds[2]))
    return right


def _right_strip_key(kit,free_width_mm):
    """Ordena primero kits completos cuyos componentes caben en la franja libre.

    El motor sigue repacando y certificando toda la placa; esta puntuación sólo
    evita gastar los cuatro intentos cortos en candidatos anchos que no pueden
    aprovechar el margen derecho observado.
    """
    dimensions=[];envelope=0.0;area=0.0
    for part in (kit.get('parts') or []):
        g=part.get('geom')
        if g is None or g.is_empty:continue
        minx,miny,maxx,maxy=g.bounds
        w=maxx-minx;h=maxy-miny
        narrow=min(w,h)
        long=max(w,h)
        dimensions.append((narrow,long))
        envelope+=max(1.0,w*h)
        area+=float(g.area or 0.0)
    if not dimensions:return (2,1e18,1e18,1e18,999999)
    widest_narrow=max(row[0] for row in dimensions)
    fits_strip=widest_narrow<=free_width_mm+0.05
    leftover=max(0.0,free_width_mm-widest_narrow) if fits_strip else widest_narrow-free_width_mm
    return (
        0 if fits_strip else 1,
        leftover,
        envelope,
        -area,
        int(kit.get('priority') or 999999),
    )


def _right_fill_candidates(selected,kits,base_result,limit=RIGHT_FILL_MAX_ATTEMPTS):
    selected_ids={str(k.get('kitId') or '') for k in selected}
    remaining=[k for k in kits if str(k.get('kitId') or '') not in selected_ids]
    used_right=_rightmost_x(selected,base_result)
    free_width=max(0.0,v4.PLATE_WIDTH_MM-used_right-v4.GAP_MM)
    ranked=sorted(remaining,key=lambda kit:_right_strip_key(kit,free_width))
    return ranked[:limit],free_width


def _right_fill_sweep(selected,kits,base_result,attempts,deadline):
    """Intenta +1 figura compacta sin poner en riesgo la solución ya válida.

    Cada intento parte de la placa válida existente, repaca con Sparrow y sólo se
    acepta si entra completa y además pasa la certificación Shapely. Si todos fallan,
    el llamador conserva sin cambios la placa original.
    """
    candidates,free_width=_right_fill_candidates(selected,kits,base_result)
    diagnostics=[]
    for idx,candidate in enumerate(candidates):
        remaining_seconds=deadline-time.time()
        if remaining_seconds<2.5:break
        trial=list(selected)+[candidate]
        seconds=max(2,min(3,int(remaining_seconds)))
        seed=224011+len(selected)*271+idx*37
        result=v4.core._run_sparrow(trial,v4.GAP_MM,seconds,seed,continuous=True)
        label=f'relleno margen derecho +1 · {candidate.get("figure") or candidate.get("kitId")}'
        v4._attempt(attempts,'right-edge-fill',label,trial,result,seed,True)
        diag={'kitId':candidate.get('kitId'),'figure':candidate.get('figure'),'fits':bool(result.get('fits')),'seconds':seconds,'observedRightFreeMm':round(free_width,2)}
        if result.get('ok') and result.get('fits'):
            certified,reason=_certify(trial,result,v4.GAP_MM,EDGE_MM)
            diag.update({'certified':bool(certified),'certificationReason':reason})
            diagnostics.append(diag)
            if certified:return (trial,result),diagnostics
        else:
            diagnostics.append(diag)
    return None,diagnostics


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
        data.update({'saEscapeRan':False,'saEscapeReason':'all-candidates-fit','rightFillRan':False,'rightFillReason':'all-candidates-fit'})
        return jsonify(data),status

    raw=sorted(payload.get('kits') or [],key=lambda k:(v4.core._priority(k),str(k.get('date') or ''),str(k.get('figure') or '')))[:v4.MAX_POOL_V4]
    kits=[]
    for k in raw:
        try:kits.append(v4.core._prep_kit(k,v4.PLATE_WIDTH_MM,v4.PLATE_HEIGHT_MM))
        except Exception:pass
    by_id={str(k.get('kitId') or ''):k for k in kits}
    selected=[by_id[kid] for kid in (data.get('selectedKitIds') or []) if kid in by_id]
    if len(selected)!=int(data.get('completeFigures') or 0):
        data.update({'saEscapeRan':False,'saEscapeReason':'selected-reconstruction-failed','rightFillRan':False,'rightFillReason':'selected-reconstruction-failed'})
        return jsonify(data),status

    attempts=list(data.get('attempts') or [])
    started=time.time()
    total_deadline=started+EXTRA_BUDGET_SECONDS
    sa_deadline=min(total_deadline,started+SA_BUDGET_SECONDS)
    def run_attempt(rows,label,seed,seconds):
        result=v4.core._run_sparrow(rows,v4.GAP_MM,seconds,seed,continuous=True)
        v4._attempt(attempts,'simulated-annealing-escape',label,rows,result,seed,True)
        return result

    found,diag=anneal_plus_one(
        selected,kits,int(data.get('urgentAnchorsKept') or 0),run_attempt,sa_deadline,
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

    # Si SA no consiguió +1, usamos únicamente el presupuesto que queda para
    # probar kits compactos. La placa original queda intacta como fallback.
    if found is None:
        fill_found,fill_diag=_right_fill_sweep(selected,kits,data,attempts,total_deadline)
        data.update({
            'attempts':attempts,
            'rightFillRan':True,
            'rightFillAttempts':fill_diag,
            'rightFillSuccess':bool(fill_found),
            'rightFillElapsedSeconds':round(max(0.0,time.time()-started-float(data.get('saElapsedSeconds') or 0.0)),2),
        })
        if fill_found is None:
            data['rightFillFallbackUsed']=True
            return jsonify(data),status
        found=fill_found
        data['rightFillFallbackUsed']=False
    else:
        data.update({'rightFillRan':False,'rightFillReason':'sa-plus-one-succeeded','rightFillSuccess':False})

    rows,result=found
    certified,reason=_certify(rows,result,v4.GAP_MM,EDGE_MM)
    data['saCertified']=bool(certified);data['saCertificationReason']=reason
    if not certified:
        data['rightFillFallbackUsed']=True
        return jsonify(data),status

    data.update({
        'build':'best-effort-multipass-v4-safe-1214x568-right-fill-certified-2026-09-04',
        'engine':'Sparrow V4 safe-area + mejora residual acotada + Shapely',
        'completeFigures':len(rows),
        'placements':result.get('placements') or [],
        'selectedKitIds':[k.get('kitId') for k in rows],
        'saSuccess':found is not None and not data.get('rightFillSuccess'),
        'stoppedBecause':'right-fill-plus-one-certified' if data.get('rightFillSuccess') else 'sa-plus-one-certified',
    })
    data.update(v4._metrics(rows,result))
    _stamp_safe_runtime(data)
    return jsonify(data),status
