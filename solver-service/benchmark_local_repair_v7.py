import math
import time
from copy import deepcopy
from shapely.affinity import rotate as shp_rotate, translate as shp_translate
import benchmark_local_repair_v4 as v4
import benchmark_local_repair_v6 as v6

PER_CALL_SECONDS=.42
MAX_TESTED_POSES=2300
MAX_X=50
MAX_Y=58

def _bounded_insert_candidates(pid,parts,original_geoms,original_poses,occupied,gap,w,h,limit=10):
    deadline=time.time()+PER_CALL_SECONDS; part=parts[pid]; current=original_geoms[pid]
    cminx,cminy,_,_=current.bounds; a0=float(original_poses[pid].get('angle') or 0)%360; obstacles=list(occupied.values())
    offsets=[0,-3,3,-5,5,-8,8,-10,10,-15,15,-22.5,22.5,-30,30,-45,45,-90,90,180]; angles=[]
    for off in offsets:
        a=round((a0+off)%360,3)
        if a not in angles: angles.append(a)
    found=[]; seen=set(); tested=0
    for angle in angles:
        if time.time()>=deadline or tested>=MAX_TESTED_POSES: break
        rg=shp_rotate(part['geom'],angle,origin=(0,0),use_radians=False); rminx,rminy,rmaxx,rmaxy=rg.bounds; rw=rmaxx-rminx; rh=rmaxy-rminy
        if rw>w+.35 or rh>h+.35: continue
        maxx=max(0,w-rw); maxy=max(0,h-rh); xs=[0,maxx,max(0,min(maxx,cminx))]; ys=[0,maxy,max(0,min(maxy,cminy))]
        for step in (2.5,5,10):
            for k in range(20): xs.append(cminx-k*step)
            for k in range(-11,12): ys.append(cminy+k*step)
        for og in obstacles:
            x1,y1,x2,y2=og.bounds; xs += [x2+gap,x1-rw-gap,x1,x2-rw]; ys += [y2+gap,y1-rh-gap,y1,y2-rh]
        ys += [i*10 for i in range(int(maxy//10)+1)]
        xs=sorted(set(round(max(0,min(maxx,x)),3) for x in xs if math.isfinite(x)),key=lambda x:(abs(x-cminx),x))[:MAX_X]
        ys=sorted(set(round(max(0,min(maxy,y)),3) for y in ys if math.isfinite(y)),key=lambda y:(abs(y-cminy),y))[:MAX_Y]
        hits=0
        for x in xs:
            if time.time()>=deadline or tested>=MAX_TESTED_POSES: break
            for y in ys:
                tested+=1
                if (tested&31)==0 and time.time()>=deadline: break
                key=(angle,x,y)
                if key in seen: continue
                seen.add(key); pose,g=v6._candidate_pose(part,angle,x,y)
                if not v4._inside(g,w,h) or not v4._clear(g,obstacles,gap): continue
                move=abs(g.bounds[0]-cminx)+abs(g.bounds[1]-cminy)
                found.append(((g.bounds[2],move,abs(g.bounds[1]-cminy),v6._angle_delta(angle,a0)),pose,g)); hits+=1
                if hits>=5: break
            if hits>=5: break
        if len(found)>=limit*4: break
    found.sort(key=lambda r:r[0]); return found[:limit]

def _direct_blockers(offenders,geoms,gap,w):
    scores={}
    for opid in offenders:
        og=geoms[opid]; over=max(0,og.bounds[2]-w); travel=over+gap+2.5
        # Swept corridor from current position to the position that would put this offender inside the plate.
        target=shp_translate(og,xoff=-travel); corridor=og.union(target).convex_hull.buffer(gap+.15)
        for pid,g in geoms.items():
            if pid==opid or pid in offenders: continue
            if corridor.intersects(g):
                inter=corridor.intersection(g).area
                scores[pid]=scores.get(pid,0)+100000+inter
            else:
                d=target.distance(g)
                if d<gap+12: scores[pid]=scores.get(pid,0)+max(0,5000-d*100)
    ranked=sorted(scores,key=lambda p:(-scores[p],v6._neighbor_rank(p,offenders,geoms,gap)))
    fallback=[p for p in geoms if p not in offenders and p not in ranked]
    fallback.sort(key=lambda p:v6._neighbor_rank(p,offenders,geoms,gap))
    return ranked+fallback, ranked

def _orders(subset,geoms,offenders,blockers):
    out=[]
    def add(s):
        t=tuple(s)
        if t and t not in out: out.append(t)
    bs=[p for p in blockers if p in subset]; os=[p for p in offenders if p in subset]; rest=[p for p in subset if p not in bs and p not in os]
    add(bs+os+rest); add(os+bs+rest)
    add(sorted(subset,key=lambda p:(geoms[p].area,-geoms[p].bounds[2])))
    return out

def _frontier_repack_v7(kits,base_result,gap,w,h,seconds):
    parts=v4._part_map(kits); placements=base_result.get('placements') or []
    if len(placements)!=len(parts): return None,{'reason':'placement-count-mismatch'}
    poses={str(p.get('instanceId')):deepcopy(p) for p in placements}; geoms={p:v4._geom(parts[p],q) for p,q in poses.items()}
    offenders=[p for p,g in geoms.items() if g.bounds[2]>w+.35]
    if not offenders or len(offenders)>8: return None,{'reason':'bad-offender-count','offenders':len(offenders)}
    neighbors,direct=_direct_blockers(offenders,geoms,gap,w); deadline=time.time()+max(28,int(seconds))
    best=None; best_width=float('inf'); tested=0; orders_tried=0; stages=0
    # Prefer exact swept-corridor blockers. Try several small neighborhoods instead of spending the budget on one large beam.
    starts=[]
    direct_count=min(4,len(direct))
    for n in range(1,direct_count+1): starts.append(tuple(offenders+direct[:n]))
    for n in range(max(1,direct_count+1),min(7,len(neighbors))+1): starts.append(tuple(offenders+neighbors[:n]))
    seen_subsets=set()
    for subset in starts:
        if time.time()>=deadline: break
        if subset in seen_subsets or len(subset)>10: continue
        seen_subsets.add(subset); stages+=1; evac=set(subset); fixed={p:g for p,g in geoms.items() if p not in evac}
        if any(g.bounds[2]>w+.35 for g in fixed.values()): continue
        for order in _orders(subset,geoms,offenders,direct):
            if time.time()>=deadline: break
            orders_tried+=1; beam=[(max((g.bounds[2] for g in fixed.values()),default=0),0,{},fixed)]
            for pid in order:
                nxt=[]
                for _,base_move,placed,occupied in beam[:10]:
                    if time.time()>=deadline: break
                    cand=_bounded_insert_candidates(pid,parts,geoms,poses,occupied,gap,w,h,limit=8)
                    tested+=len(cand)
                    for score,pose,g in cand:
                        np=dict(placed); np[pid]=(pose,g); no=dict(occupied); no[pid]=g
                        width=max((x.bounds[2] for x in no.values()),default=0); move=base_move+abs(g.bounds[0]-geoms[pid].bounds[0])+abs(g.bounds[1]-geoms[pid].bounds[1])
                        nxt.append((width,move,np,no))
                nxt.sort(key=lambda r:(r[0],r[1])); beam=nxt[:10]
                if not beam: break
            if beam:
                width,_,placed,_=beam[0]
                if len(placed)==len(subset) and width<best_width: best_width=width; best=placed
                if best_width<=w+.35: break
        if best_width<=w+.35: break
    diag={'offenders':len(offenders),'directBlockers':len(direct),'directBlockerIds':direct[:6],'stagesTried':stages,'ordersTried':orders_tried,'testedCandidates':tested}
    if best is None: diag['reason']='blocker-aware-no-solution'; return None,diag
    out=[]; moved=0
    for p in placements:
        q=deepcopy(p); pid=str(p.get('instanceId'))
        if pid in best: q.update(best[pid][0]); moved+=1
        out.append(q)
    result=deepcopy(base_result); result['placements']=out; result['stripWidthMm']=float(best_width); result['fits']=best_width<=w+.5; result['repairApplied']=True; result['repairMovedPieces']=moved; result['repairStrategy']='swept-blocker-frontier-v7'
    diag.update({'reason':'success' if result['fits'] else 'best-still-wide','widthMm':round(best_width,3),'movedPieces':moved})
    return result,diag

v6._insert_candidates_v6=_bounded_insert_candidates
v6.v5._frontier_repack=_frontier_repack_v7

def run_exact_with_repair(kits,budget=185):
    return v6.run_exact_with_repair(kits,budget=max(185,min(195,int(budget or 185))))

__all__=['run_exact_with_repair']
