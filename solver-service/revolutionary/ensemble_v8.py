"""TVT Revolutionary Ensemble V8.0 — workshop-topology learning.

V7 proved that merely making mutation search wider is not enough.  V8 changes the
approach: before stochastic packing it tries spatial topologies measured from layouts
that were actually achieved by hand.  Incoming geometry is mapped onto those slots
and independently re-certified; no manual layout is trusted blindly.

If a topology seed certifies, it becomes an incumbent/beam member and Sparrow may
still locally rebuild it to seek N+1.  If no topology applies, V8 falls back to V6,
which was empirically stronger than V7 on the fixed suite.
"""
from __future__ import annotations

import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Ensemble V8.0'
MAX_COMPLETE=18


def _row_from_result(result,prepared_kits):
    ids=[];seen=set()
    for p in result.get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid and kid not in seen:seen.add(kid);ids.append(kid)
    by={str(k.get('kitId') or ''):k for k in prepared_kits}
    kits=[by[x] for x in ids if x in by]
    if not kits:return None
    candidate=type('V8BaseCandidate',(),{'label':str(result.get('selectionStrategy') or 'v6-base'),'kits':kits})()
    return {'candidate':candidate,'seed':result.get('seed'),'result':{'ok':True,'fits':True,'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),'elapsedSeconds':float(result.get('elapsedSeconds') or 0)},'certified':True,'certificate':result.get('productionCertificate') or {}}


def _best(rows):
    good=[r for r in rows if r and r.get('certified')]
    if not good:return None
    return sorted(good,key=v4._score,reverse=True)[0]


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(60.0,float(total_seconds));deadline=started+budget
    attempts=[]

    # 1) Learned workshop topology first.  This is cheap and deterministic.
    topo=workshop_seeds(prepared_kits)
    for row in topo:
        r=row.get('result') or {};cert=row.get('certificate') or {}
        attempts.append({'phase':'workshop-topology','label':row['candidate'].label,'target':len(row['candidate'].kits),'certified':bool(row.get('certified')),'density':round(float(r.get('density') or 0),2),'gapMm':cert.get('minimumGapMmCertified'),'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount')})
    topo_best=_best(topo)

    # 2) Keep V6 as the stochastic baseline because it beat V7 in the real Mama gate.
    # If topology already gives >=12, spend only a modest budget on independent V6
    # corroboration and use the remaining time to probe N+1 from the learned layout.
    topo_count=len(topo_best['candidate'].kits) if topo_best else 0
    if topo_count>=12:base_budget=max(45.0,min(70.0,budget*0.38))
    else:base_budget=max(55.0,min(115.0,budget*0.62))
    base=v6.revolutionary_solve_v6(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
    base_row=_row_from_result(base,prepared_kits) if base.get('ok') else None
    if base.get('attempts'):attempts.extend(base.get('attempts') or [])

    best=_best([topo_best,base_row])
    if best is None:
        return {'ok':False,'engine':ENGINE,'error':'Neither workshop topology nor V6 produced a certified incumbent','attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}

    climb=[]
    if base.get('climbHistory'):climb.extend(base.get('climbHistory') or [])
    count=len(best['candidate'].kits)
    if not climb or climb[-1]!=count:climb.append(count)
    beam=v4._unique_beam([x for x in [topo_best,base_row] if x and x.get('certified')],width=4)

    # 3) Grow from the strongest certified topology/base.  Unlike V7, do not waste
    # the whole budget rebuilding from 6 when a 10/12 workshop foothold is known.
    ceiling=min(MAX_COMPLETE,len(prepared_kits))
    while count<ceiling and deadline-time.time()>10:
        step_deadline=min(deadline,time.time()+min(38.0,max(10.0,(deadline-time.time())*0.62)))
        grown,rows=v4.lns_grow_beam(beam,prepared_kits,step_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=10 if count<=12 else 6)
        attempts.extend(rows)
        if not grown:
            attempts.append({'phase':'v8-topology-practical-maximum','target':count+1,'certified':False,'reason':'workshop-seeded local rebuild exhausted; best certified incumbent preserved'})
            break
        candidate=grown[0]
        if v4._score(candidate)>v4._score(best):best=candidate
        beam=v4._unique_beam(grown+beam,width=4)
        count=len(best['candidate'].kits)
        if climb[-1]!=count:climb.append(count)

    r=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits)
    source='workshop-topology' if str(best['candidate'].label).startswith('workshop-topology') else 'v6-or-lns'
    return {'ok':True,'engine':ENGINE,'completeFigures':final,'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':final,'selectionStrategy':best['candidate'].label,'incumbentSource':source,'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),'placements':r.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),'searchPhilosophy':'certified workshop topology -> V6 corroboration -> N+1 local rebuild','climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}
