import math
import time
from copy import deepcopy

from shapely.affinity import rotate as shp_rotate, translate as shp_translate


def _part_map(kits):
    return {str(p.get('instanceId')): p for k in kits for p in (k.get('parts') or [])}


def _geom(part, placement):
    g = shp_rotate(part['geom'], float(placement.get('angle') or 0.0), origin=(0, 0), use_radians=False)
    return shp_translate(g, xoff=float(placement.get('xCm') or 0.0)*10.0, yoff=float(placement.get('yCm') or 0.0)*10.0)


def _inside(g, w, h, tol=.35):
    a,b,c,d = g.bounds
    return a >= -tol and b >= -tol and c <= w+tol and d <= h+tol


def _clear(g, others, gap):
    return all(g.distance(o) >= gap-.001 for o in others)


def _adelta(a,b):
    d = abs((a-b) % 360.0)
    return min(d, 360.0-d)


def _candidate(part, angle, bx, by):
    rg = shp_rotate(part['geom'], angle, origin=(0,0), use_radians=False)
    minx,miny,_,_ = rg.bounds
    g = shp_translate(rg, xoff=bx-minx, yoff=by-miny)
    return {'angle':angle,'xCm':(bx-minx)/10.0,'yCm':(by-miny)/10.0}, g


def _move_one(pid, parts, poses, geoms, gap, w, h, fine=False):
    current = geoms[pid]
    cminx,cminy,cmaxx,_ = current.bounds
    a0 = float(poses[pid].get('angle') or 0.0) % 360.0
    others = [g for oid,g in geoms.items() if oid != pid]
    current_global = max(g.bounds[2] for g in geoms.values())
    offsets = [0,-5,5,-10,10,-15,15,-30,30] if fine else [0,-10,10,-20,20]
    best = None

    for off in offsets:
        angle = (a0+off) % 360.0
        rg = shp_rotate(parts[pid]['geom'], angle, origin=(0,0), use_radians=False)
        rminx,rminy,rmaxx,rmaxy = rg.bounds
        rw,rh = rmaxx-rminx, rmaxy-rminy
        if rw > w+.35 or rh > h+.35:
            continue
        xs = [0.0, max(0.0,min(w-rw,cminx)), w-rw]
        ys = [0.0, max(0.0,min(h-rh,cminy)), h-rh]
        for og in others:
            ominx,ominy,omaxx,omaxy = og.bounds
            xs += [omaxx+gap, ominx-rw-gap, ominx, omaxx-rw]
            ys += [omaxy+gap, ominy-rh-gap, ominy, omaxy-rh]
        ystep = 5.0 if fine else 10.0
        ys += [i*ystep for i in range(int(max(0.0,h-rh)//ystep)+1)]
        xstep = 5.0 if fine else 10.0
        xs += [cminx+k*xstep for k in range(-10,2)]
        xs = sorted(set(round(max(0.0,min(w-rw,x)),3) for x in xs if math.isfinite(x)))
        ys = sorted(set(round(max(0.0,min(h-rh,y)),3) for y in ys if math.isfinite(y)), key=lambda y:(abs(y-cminy),y))

        for x in xs:
            if cmaxx <= w+.35 and x > cminx+.001:
                continue
            for y in ys:
                pose,g = _candidate(parts[pid],angle,x,y)
                if not _inside(g,w,h) or not _clear(g,others,gap):
                    continue
                global_w = max([g.bounds[2]]+[o.bounds[2] for o in others])
                score = (global_w,g.bounds[2],x,abs(y-cminy),_adelta(angle,a0))
                if best is None or score < best[0]:
                    best = (score,pose,g)
                if global_w < current_global-.05:
                    break
            if best is not None and best[0][0] < current_global-.05:
                break
    return None if best is None else (best[1],best[2])


def _global_compact(kits, base_result, gap, w, h, seconds):
    parts = _part_map(kits)
    placements = base_result.get('placements') or []
    if len(placements) != len(parts):
        return None
    poses = {str(p.get('instanceId')):deepcopy(p) for p in placements}
    if any(pid not in parts for pid in poses):
        return None
    geoms = {pid:_geom(parts[pid],pose) for pid,pose in poses.items()}
    deadline = time.time()+max(20,int(seconds))
    best_width = max(g.bounds[2] for g in geoms.values())
    best_poses = deepcopy(poses)
    stagnant = 0

    for sweep in range(12):
        if time.time() >= deadline:
            break
        fine = sweep >= 3
        left = sorted(poses,key=lambda pid:geoms[pid].bounds[0])
        right = sorted(poses,key=lambda pid:geoms[pid].bounds[2],reverse=True)
        for pid in left+right:
            if time.time() >= deadline:
                break
            found = _move_one(pid,parts,poses,geoms,gap,w,h,fine)
            if not found:
                continue
            pose,g = found
            old_global = max(x.bounds[2] for x in geoms.values())
            old_x = geoms[pid].bounds[0]
            new_global = max([g.bounds[2]]+[og.bounds[2] for oid,og in geoms.items() if oid != pid])
            if new_global <= old_global+.05 and (new_global < old_global-.02 or g.bounds[0] < old_x-.05):
                poses[pid].update(pose)
                geoms[pid] = g
        width = max(g.bounds[2] for g in geoms.values())
        if width < best_width-.01:
            best_width = width
            best_poses = deepcopy(poses)
            stagnant = 0
        else:
            stagnant += 1
        if best_width <= w+.35:
            break
        if stagnant >= 3 and sweep >= 5:
            break

    out=[]
    for p in placements:
        pid=str(p.get('instanceId'))
        q=deepcopy(p)
        q.update(best_poses[pid])
        out.append(q)
    result=deepcopy(base_result)
    result['placements']=out
    result['stripWidthMm']=float(best_width)
    result['fits']=best_width <= w+.5
    result['repairApplied']=True
    result['repairMovedPieces']=sum(1 for p in placements if any(abs(float(best_poses[str(p.get('instanceId'))].get(k) or 0)-float(p.get(k) or 0))>1e-6 for k in ('xCm','yCm','angle')))
    return result


def run_exact_with_repair(kits, budget=225):
    import benchmark_routes as br
    started=time.time(); attempts=[]
    expected=sum(len(k.get('parts') or []) for k in kits)
    best=None

    for seed,seconds in [(1777,32),(907,24),(5119,24),(10429,20)]:
        remaining=budget-(time.time()-started)
        if remaining < 55:
            break
        seconds=min(seconds,max(12,int(remaining-45)))
        result=br.core._run_sparrow(kits,br.GAP_MM,seconds,seed,continuous=True)
        placements=result.get('placements') or []
        m=br._metrics(kits,result) if result.get('stripWidthMm') else {}
        attempts.append({'seed':seed,'rotation':'continua','seconds':seconds,'phase':'sparrow-v4','fits':bool(result.get('fits')),'placementCount':len(placements),'repairEligible':len(placements)==expected,'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'error':result.get('error')})
        if len(placements)!=expected:
            continue
        if result.get('fits'):
            return result,attempts,round(time.time()-started,2)
        if best is None or float(result.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18):
            best=result

    if best is None:
        return None,attempts,round(time.time()-started,2)

    remaining=budget-(time.time()-started)
    rs=time.time()
    repaired=_global_compact(kits,best,br.GAP_MM,br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM,max(35,int(remaining-3)))
    repair_seconds=round(time.time()-rs,2)
    if repaired is not None:
        m=br._metrics(kits,repaired)
        attempts.append({'seed':None,'rotation':'coordinate-global','seconds':repair_seconds,'phase':'global-coordinate-v4','fits':bool(repaired.get('fits')),'placementCount':len(repaired.get('placements') or []),'repairEligible':True,'baseStripWidthMm':round(float(best.get('stripWidthMm') or 0),3),'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'movedPieces':repaired.get('repairMovedPieces'),'error':None})
        if repaired.get('fits'):
            return repaired,attempts,round(time.time()-started,2)
    return None,attempts,round(time.time()-started,2)


__all__=['run_exact_with_repair']
