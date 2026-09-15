import math
import time
from copy import deepcopy

from shapely.affinity import rotate as shp_rotate

import benchmark_local_repair_v4 as v4
import benchmark_local_repair_v6 as v6

PER_CALL_SECONDS = 1.15
MAX_TESTED_POSES = 5200
MAX_X = 72
MAX_Y = 84


def _bounded_insert_candidates(pid, parts, original_geoms, original_poses, occupied, gap, w, h, limit=18):
    deadline = time.time() + PER_CALL_SECONDS
    part = parts[pid]
    current = original_geoms[pid]
    cminx, cminy, _, _ = current.bounds
    a0 = float(original_poses[pid].get('angle') or 0.0) % 360.0
    obstacles = list(occupied.values())
    offsets = [0, -3, 3, -5, 5, -8, 8, -10, 10, -15, 15, -22.5, 22.5, -30, 30, -45, 45, -60, 60, -90, 90, 180]
    angles = []
    for off in offsets:
        a = round((a0 + off) % 360.0, 3)
        if a not in angles:
            angles.append(a)
    found, seen, tested = [], set(), 0
    for angle in angles:
        if time.time() >= deadline or tested >= MAX_TESTED_POSES:
            break
        rg = shp_rotate(part['geom'], angle, origin=(0, 0), use_radians=False)
        rminx, rminy, rmaxx, rmaxy = rg.bounds
        rw, rh = rmaxx-rminx, rmaxy-rminy
        if rw > w + .35 or rh > h + .35:
            continue
        maxx, maxy = max(0.0, w-rw), max(0.0, h-rh)
        xs = [0.0, maxx, max(0.0, min(maxx, cminx))]
        ys = [0.0, maxy, max(0.0, min(maxy, cminy))]
        for step in (2.5, 5.0, 10.0):
            for k in range(25): xs.append(cminx-k*step)
            for k in range(-14, 15): ys.append(cminy+k*step)
        for og in obstacles:
            ominx, ominy, omaxx, omaxy = og.bounds
            xs.extend([omaxx+gap, ominx-rw-gap, ominx, omaxx-rw, omaxx+gap-rw, ominx-gap])
            ys.extend([omaxy+gap, ominy-rh-gap, ominy, omaxy-rh, omaxy+gap-rh, ominy-gap])
        ys.extend(i*10.0 for i in range(int(maxy//10.0)+1))
        xs = sorted(set(round(max(0.0,min(maxx,x)),3) for x in xs if math.isfinite(x)), key=lambda x:(abs(x-cminx),x))[:MAX_X]
        ys = sorted(set(round(max(0.0,min(maxy,y)),3) for y in ys if math.isfinite(y)), key=lambda y:(abs(y-cminy),y))[:MAX_Y]
        angle_hits = 0
        for x in xs:
            if time.time() >= deadline or tested >= MAX_TESTED_POSES: break
            for y in ys:
                tested += 1
                if (tested & 31) == 0 and time.time() >= deadline: break
                key=(angle,x,y)
                if key in seen: continue
                seen.add(key)
                pose,g=v6._candidate_pose(part,angle,x,y)
                if not v4._inside(g,w,h) or not v4._clear(g,obstacles,gap): continue
                movement=abs(g.bounds[0]-cminx)+abs(g.bounds[1]-cminy)
                found.append(((g.bounds[2],movement,abs(g.bounds[1]-cminy),v6._angle_delta(angle,a0)),pose,g))
                angle_hits += 1
                if angle_hits >= 8: break
            if angle_hits >= 8: break
        if len(found) >= limit*5: break
    found.sort(key=lambda row:row[0])
    return found[:limit]


def _order_variants(subset, geoms, offenders):
    variants=[]
    def add(seq):
        t=tuple(seq)
        if t and t not in variants: variants.append(t)
    add(sorted(subset,key=lambda p:(-geoms[p].bounds[2],-(geoms[p].area or 0))))
    add(sorted(subset,key=lambda p:(geoms[p].area or 0,-geoms[p].bounds[2])))
    add(sorted(subset,key=lambda p:(geoms[p].bounds[2],geoms[p].area or 0)))
    add(list(offenders)+[p for p in subset if p not in offenders])
    add([p for p in subset if p not in offenders]+list(offenders))
    return variants


def _frontier_repack_v7(kits, base_result, gap, w, h, seconds):
    parts=v4._part_map(kits); placements=base_result.get('placements') or []
    if len(placements)!=len(parts): return None,{'reason':'placement-count-mismatch'}
    poses={str(p.get('instanceId')):deepcopy(p) for p in placements}
    geoms={pid:v4._geom(parts[pid],pose) for pid,pose in poses.items()}
    deadline=time.time()+max(28,int(seconds))
    offenders=[pid for pid,g in geoms.items() if g.bounds[2]>w+.35]
    if not offenders: return None,{'reason':'no-offenders'}
    if len(offenders)>8: return None,{'reason':'too-many-offenders','offenders':len(offenders)}
    neighbors=[p for p in geoms if p not in offenders]
    neighbors.sort(key=lambda p:v6._neighbor_rank(p,offenders,geoms,gap))
    # Free a wider physical neighborhood: the previous repair left too many blockers fixed.
    subsets=[]
    for extra in range(1,min(9,len(neighbors))+1):
        s=tuple(offenders+neighbors[:extra])
        if len(s)<=12: subsets.append(s)
    best=None; best_width=float('inf'); tested=0; orders_tried=0; empty=[]
    for subset in subsets:
        if time.time()>=deadline: break
        fixed={p:g for p,g in geoms.items() if p not in set(subset)}
        if any(g.bounds[2]>w+.35 for g in fixed.values()): continue
        for order in _order_variants(subset,geoms,offenders):
            if time.time()>=deadline: break
            orders_tried+=1
            beam=[(max((g.bounds[2] for g in fixed.values()),default=0.0),{},fixed)]
            for pid in order:
                nxt=[]
                for _,placed,occupied in beam[:10]:
                    if time.time()>=deadline: break
                    cand=_bounded_insert_candidates(pid,parts,geoms,poses,occupied,gap,w,h,limit=14)
                    tested+=len(cand)
                    if not cand and not placed: empty.append(pid)
                    for score,pose,g in cand:
                        np=dict(placed); np[pid]=(pose,g)
                        no=dict(occupied); no[pid]=g
                        width=max((x.bounds[2] for x in no.values()),default=0.0)
                        move=abs(g.bounds[0]-geoms[pid].bounds[0])+abs(g.bounds[1]-geoms[pid].bounds[1])
                        nxt.append(((width,move,score[0]),np,no))
                nxt.sort(key=lambda r:r[0]); beam=[(r[0][0],r[1],r[2]) for r in nxt[:10]]
                if not beam: break
            if not beam: continue
            width,placed,_=min(beam,key=lambda r:r[0])
            if len(placed)==len(subset) and width<best_width:
                best_width=width; best=placed
            if best_width<=w+.35: break
        if best_width<=w+.35: break
    if best is None:
        return None,{'reason':'multi-order-no-solution','offenders':len(offenders),'subsetsTried':len(subsets),'ordersTried':orders_tried,'testedCandidates':tested,'emptyFirstPieces':list(dict.fromkeys(empty))[:6]}
    out=[]; moved=0
    for p in placements:
        q=deepcopy(p); pid=str(p.get('instanceId'))
        if pid in best: q.update(best[pid][0]); moved+=1
        out.append(q)
    result=deepcopy(base_result); result['placements']=out; result['stripWidthMm']=float(best_width); result['fits']=best_width<=w+.5
    result['repairApplied']=True; result['repairMovedPieces']=moved; result['repairStrategy']='frontier-blockers-multi-order-v7'
    return result,{'reason':'success' if result['fits'] else 'best-still-wide','widthMm':round(best_width,3),'subsetsTried':len(subsets),'ordersTried':orders_tried,'testedCandidates':tested}


v6._insert_candidates_v6=_bounded_insert_candidates
# V5 calls the patched V6 frontier through module globals; replace it with the multi-order variant.
v6.v5._frontier_repack=_frontier_repack_v7


def run_exact_with_repair(kits,budget=185):
    requested=int(budget or 185)
    effective_budget=max(185,min(195,requested))
    return v6.run_exact_with_repair(kits,budget=effective_budget)


__all__=['run_exact_with_repair']
