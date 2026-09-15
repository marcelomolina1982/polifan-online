# INTENTO 3/3: generar una buena base y reconstruir en conjunto la franja derecha.
import time
from copy import deepcopy
import benchmark_local_repair_v7 as v7
import benchmark_local_repair_v6 as v6
import benchmark_local_repair_v4 as v4


def _row(br,kits,r,phase,seconds,seed=None):
    m=br._metrics(kits,r) if r and r.get('stripWidthMm') else {}
    return {'seed':seed,'rotation':'continua' if seed else 'regional','seconds':seconds,'phase':phase,'fits':bool(r and r.get('fits')),'placementCount':len((r or {}).get('placements') or []),'repairEligible':True,'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'error':(r or {}).get('error')}


def _regional(kits,base,br,seconds):
    parts=v4._part_map(kits); placements=base.get('placements') or []
    poses={str(p.get('instanceId')):deepcopy(p) for p in placements}
    geoms={pid:v4._geom(parts[pid],q) for pid,q in poses.items()}
    offenders=[p for p,g in geoms.items() if g.bounds[2]>br.PLATE_WIDTH_MM+.35]
    if not offenders: return base,{'reason':'already-inside'}
    neighbors,direct=v7._direct_blockers(offenders,geoms,br.GAP_MM,br.PLATE_WIDTH_MM)
    ranked=sorted(geoms,key=lambda p:geoms[p].bounds[2],reverse=True)
    pool=[]
    for p in offenders+direct+ranked:
        if p not in pool: pool.append(p)
        if len(pool)>=12: break
    deadline=time.time()+max(40,int(seconds)); best=None; tested=0
    # Probar subconjuntos crecientes: esto libera varias piezas simultaneamente.
    for n in range(max(len(offenders)+2,6),len(pool)+1):
        if time.time()>=deadline: break
        subset=pool[:n]; fixed={p:g for p,g in geoms.items() if p not in subset}
        if any(g.bounds[2]>br.PLATE_WIDTH_MM+.35 for g in fixed.values()): continue
        orders=[sorted(subset,key=lambda p:-geoms[p].area),offenders+[p for p in subset if p not in offenders]]
        for order in orders:
            if time.time()>=deadline: break
            beam=[(0,{},fixed)]
            for pid in order:
                nxt=[]
                for move,placed,occupied in beam[:16]:
                    if time.time()>=deadline: break
                    cand=v7._bounded_insert_candidates(pid,parts,geoms,poses,occupied,br.GAP_MM,br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM,limit=10)
                    tested+=len(cand)
                    for score,pose,g in cand:
                        np=dict(placed); np[pid]=(pose,g); no=dict(occupied); no[pid]=g
                        width=max(x.bounds[2] for x in no.values())
                        nxt.append((move+score[1]+width*.001,np,no))
                nxt.sort(key=lambda z:z[0]); beam=nxt[:16]
                if not beam: break
            if beam and len(beam[0][1])==len(subset):
                _,placed,occupied=beam[0]; width=max(g.bounds[2] for g in occupied.values())
                if width<=br.PLATE_WIDTH_MM+.5:
                    out=[]
                    for p in placements:
                        q=deepcopy(p); pid=str(p.get('instanceId'))
                        if pid in placed: q.update(placed[pid][0])
                        out.append(q)
                    r=deepcopy(base); r['placements']=out; r['stripWidthMm']=width; r['fits']=True; r['repairApplied']=True; r['repairMovedPieces']=len(placed); r['repairStrategy']='regional-hard-bound'
                    return r,{'reason':'success','destroyCount':len(subset),'testedCandidates':tested,'widthMm':round(width,3)}
    return None,{'reason':'regional-no-solution','poolSize':len(pool),'offenders':len(offenders),'directBlockers':len(direct),'testedCandidates':tested}


def run_exact_with_repair(kits,budget=190):
    import benchmark_routes as br
    started=time.time(); attempts=[]; expected=sum(len(k.get('parts') or []) for k in kits)
    base=br.core._run_sparrow(kits,br.GAP_MM,78,1777,continuous=True)
    attempts.append(_row(br,kits,base,'sparrow-attempt-3-base',78,1777))
    if len(base.get('placements') or [])!=expected: return None,attempts,round(time.time()-started,2)
    if base.get('fits'): return base,attempts,round(time.time()-started,2)
    rs=time.time(); remaining=max(45,int(budget-(time.time()-started)-4)); rebuilt,diag=_regional(kits,base,br,remaining); secs=round(time.time()-rs,2)
    if rebuilt:
        row=_row(br,kits,rebuilt,'regional-hard-bound-rebuild',secs); row['baseStripWidthMm']=round(float(base.get('stripWidthMm') or 0),3); row['diagnostic']=diag; row['movedPieces']=rebuilt.get('repairMovedPieces'); attempts.append(row)
        if rebuilt.get('fits'): return rebuilt,attempts,round(time.time()-started,2)
    else:
        attempts.append({'seed':None,'rotation':'regional','seconds':secs,'phase':'regional-hard-bound-rebuild','fits':False,'placementCount':0,'repairEligible':False,'baseStripWidthMm':round(float(base.get('stripWidthMm') or 0),3),'diagnostic':diag,'error':None})
    return None,attempts,round(time.time()-started,2)


import benchmark_async_v6
__all__=['run_exact_with_repair']
