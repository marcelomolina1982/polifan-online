import math
import time
from copy import deepcopy

from shapely.affinity import rotate as shp_rotate, translate as shp_translate


def _part_map(kits):
    return {str(p.get('instanceId')): p for k in kits for p in (k.get('parts') or [])}


def _geom(part, placement):
    g = shp_rotate(part['geom'], float(placement.get('angle') or 0.0), origin=(0, 0), use_radians=False)
    return shp_translate(g, xoff=float(placement.get('xCm') or 0.0) * 10.0, yoff=float(placement.get('yCm') or 0.0) * 10.0)


def _inside(g, w, h, tol=.35):
    a, b, c, d = g.bounds
    return a >= -tol and b >= -tol and c <= w + tol and d <= h + tol


def _clear(g, placed, gap):
    return all(g.distance(other) >= gap - .001 for other in placed)


def _dense_candidates(part, placed, gap, w, h, original, max_keep=120):
    original_angle = float(original.get('angle') or 0.0) % 360.0
    angles = []
    for a in [original_angle] + [float(x) for x in range(0, 360, 15)]:
        a %= 360.0
        if all(abs(a-b) > 1e-6 for b in angles):
            angles.append(a)

    xanchors = [0.0, w]
    yanchors = [0.0, h]
    for g in placed:
        minx, miny, maxx, maxy = g.bounds
        xanchors.extend([minx-gap, minx, maxx, maxx+gap])
        yanchors.extend([miny-gap, miny, maxy, maxy+gap])

    rows = []
    seen = set()
    for angle in angles:
        rg = shp_rotate(part['geom'], angle, origin=(0,0), use_radians=False)
        rminx, rminy, rmaxx, rmaxy = rg.bounds
        rw, rh = rmaxx-rminx, rmaxy-rminy
        if rw > w + .35 or rh > h + .35:
            continue

        ox = float(original.get('xCm') or 0.0)*10.0 + rminx
        oy = float(original.get('yCm') or 0.0)*10.0 + rminy
        xs = [0.0, w-rw, max(0.0,min(w-rw,ox))]
        ys = [0.0, h-rh, max(0.0,min(h-rh,oy))]

        for x in xanchors:
            xs.extend([x, x-rw, x+gap, x-rw-gap])
        for y in yanchors:
            ys.extend([y, y-rh, y+gap, y-rh-gap])

        # Malla moderada: permite aprovechar huecos interiores que no coinciden
        # exactamente con bordes de bounding boxes. Se concentra en los primeros
        # 1230 mm y mantiene el coste acotado para Render.
        step = 20.0
        xs.extend(i*step for i in range(int(max(0.0,w-rw)//step)+1))
        ys.extend(i*step for i in range(int(max(0.0,h-rh)//step)+1))

        xs = sorted(set(round(max(0.0,min(w-rw,x)),3) for x in xs if math.isfinite(x)))
        ys = sorted(set(round(max(0.0,min(h-rh,y)),3) for y in ys if math.isfinite(y)))

        for x in xs:
            for y in ys:
                key=(round(angle,3),x,y)
                if key in seen:
                    continue
                seen.add(key)
                tx=x-rminx; ty=y-rminy
                g=shp_translate(rg,xoff=tx,yoff=ty)
                if not _inside(g,w,h) or not _clear(g,placed,gap):
                    continue
                minx,miny,maxx,maxy=g.bounds
                # Primero reducir ancho total; luego preferir posiciones bajas y
                # próximas a la pose original para evitar movimientos innecesarios.
                score=(maxx, y, abs(x-max(0.0,min(w-rw,ox)))+abs(y-max(0.0,min(h-rh,oy))), x)
                rows.append((score,{'angle':angle,'xCm':tx/10.0,'yCm':ty/10.0},g))

    rows.sort(key=lambda r:r[0])
    return rows[:max_keep]


def _repair_subset(kits, base_result, movable_ids, gap, w, h, deadline):
    parts=_part_map(kits)
    original={str(p.get('instanceId')):deepcopy(p) for p in (base_result.get('placements') or [])}
    if not original or any(pid not in original or pid not in parts for pid in movable_ids):
        return None

    fixed_ids=[pid for pid in original if pid not in movable_ids]
    fixed=[_geom(parts[pid],original[pid]) for pid in fixed_ids]
    if any(not _inside(g,w,h) for g in fixed):
        return None

    # Colocar primero las piezas que ya sobresalen y después las más grandes.
    def order_key(pid):
        g=_geom(parts[pid],original[pid])
        return (0 if g.bounds[2] > w+.35 else 1, -float(parts[pid].get('area') or 0.0), -g.bounds[2])
    order=sorted(movable_ids,key=order_key)
    chosen={}

    def backtrack(idx, placed):
        if time.time() >= deadline:
            return False
        if idx >= len(order):
            return True
        pid=order[idx]
        candidates=_dense_candidates(parts[pid],placed,gap,w,h,original[pid])
        for _,pose,g in candidates:
            chosen[pid]=(pose,g)
            if backtrack(idx+1,placed+[g]):
                return True
            chosen.pop(pid,None)
        return False

    if not backtrack(0,fixed):
        return None

    placements=[]; maxx=0.0
    for p in base_result.get('placements') or []:
        pid=str(p.get('instanceId')); q=deepcopy(p)
        if pid in chosen:
            pose,g=chosen[pid]; q.update(pose)
        else:
            g=_geom(parts[pid],q)
        maxx=max(maxx,float(g.bounds[2])); placements.append(q)
    result=deepcopy(base_result)
    result['placements']=placements
    result['stripWidthMm']=maxx
    result['fits']=maxx <= w+.5
    result['repairApplied']=True
    result['repairMovedPieces']=len(movable_ids)
    return result


def _repair(kits, base_result, gap, w, h, seconds=105):
    placements=base_result.get('placements') or []
    parts=_part_map(kits)
    if not placements or len(placements)!=len(parts):
        return None
    rows=[]
    for p in placements:
        pid=str(p.get('instanceId') or '')
        if pid not in parts: return None
        g=_geom(parts[pid],p)
        rows.append((pid,g,float(parts[pid].get('area') or 0.0)))

    offenders=[pid for pid,g,_ in rows if g.bounds[2] > w+.35]
    rightmost=[pid for pid,_,_ in sorted(rows,key=lambda r:r[1].bounds[2],reverse=True)]
    if not offenders:
        return base_result

    deadline=time.time()+max(12,int(seconds))
    subsets=[]
    # El intento anterior se detenía en 8 piezas. Este caso real puede requerir
    # liberar un hueco moviendo más vecinos, por eso escalamos hasta 12.
    for target in (len(offenders), len(offenders)+2, len(offenders)+4, len(offenders)+6, 10, 12):
        target=max(len(offenders),min(12,target))
        s=[]
        for pid in offenders+rightmost:
            if pid not in s: s.append(pid)
            if len(s)>=target: break
        if s and s not in subsets: subsets.append(s)

    best=None
    for movable in subsets:
        if time.time()>=deadline: break
        repaired=_repair_subset(kits,base_result,movable,gap,w,h,deadline)
        if repaired is None: continue
        if repaired.get('fits'): return repaired
        if best is None or float(repaired.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18): best=repaired
    return best


def run_exact_with_repair(kits, budget=210):
    import benchmark_routes as br
    started=time.time(); attempts=[]; expected=sum(len(k.get('parts') or []) for k in kits)
    best_fit=None; best_near=None

    # Dos semillas: una búsqueda continua fuerte y una segunda distinta antes de
    # entrar a la reparación local. Conservamos tiempo para el backtracking.
    for seed,continuous,seconds in [(1777,True,34),(3911,True,26)]:
        remaining=budget-(time.time()-started)
        if remaining<35: break
        seconds=min(seconds,max(10,int(remaining-25)))
        result=br.core._run_sparrow(kits,br.GAP_MM,seconds,seed,continuous=continuous)
        placements=result.get('placements') or []
        m=br._metrics(kits,result) if result.get('stripWidthMm') else {}
        attempts.append({'seed':seed,'rotation':'continua','seconds':seconds,'phase':'sparrow','fits':bool(result.get('fits')),'placementCount':len(placements),'repairEligible':len(placements)==expected,'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'error':result.get('error')})
        if len(placements)==expected:
            if result.get('fits'):
                if best_fit is None or float(result.get('stripWidthMm') or 1e18)<float(best_fit.get('stripWidthMm') or 1e18): best_fit=result
            elif best_near is None or float(result.get('stripWidthMm') or 1e18)<float(best_near.get('stripWidthMm') or 1e18): best_near=result

    if best_fit is not None:
        return best_fit,attempts,round(time.time()-started,2)
    if best_near is None:
        return None,attempts,round(time.time()-started,2)

    repair_started=time.time()
    remaining=budget-(time.time()-started)
    repaired=_repair(kits,best_near,br.GAP_MM,br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM,seconds=min(115,max(20,int(remaining-3))))
    repair_seconds=round(time.time()-repair_started,2)
    if repaired is not None:
        m=br._metrics(kits,repaired)
        attempts.append({'seed':None,'rotation':'dense-local-backtracking','seconds':repair_seconds,'phase':'local-repair-v3','fits':bool(repaired.get('fits')),'placementCount':len(repaired.get('placements') or []),'repairEligible':True,'baseStripWidthMm':round(float(best_near.get('stripWidthMm') or 0),3),'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'movedPieces':repaired.get('repairMovedPieces'),'error':None})
        if repaired.get('fits'):
            return repaired,attempts,round(time.time()-started,2)
    else:
        attempts.append({'seed':None,'rotation':'dense-local-backtracking','seconds':repair_seconds,'phase':'local-repair-v3','fits':False,'placementCount':expected,'repairEligible':True,'baseStripWidthMm':round(float(best_near.get('stripWidthMm') or 0),3),'error':'La reparación V3 no encontró recolocación válida'})
    return None,attempts,round(time.time()-started,2)
