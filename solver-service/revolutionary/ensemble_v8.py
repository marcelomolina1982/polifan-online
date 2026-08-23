"""TVT Revolutionary Ensemble V8.1 — workshop topology + deep repair.

V8.1 keeps the certified workshop/V6 incumbent but changes the stalled N->N+1
phase: after the normal local LNS, it can free 3-5 complete kits and rebuild that
region.  This matches the real workshop observation that the extra figure often
requires moving several existing figures, not merely filling the last visible hole.
"""
from __future__ import annotations

import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds
from revolutionary.deep_lns_v9 import deep_grow_beam

ENGINE='TVT Revolutionary Ensemble V8.1-deep'
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

    topo=workshop_seeds(prepared_kits)
    for row in topo:
        r=row.get('result') or {};cert=row.get('certificate') or {}
        attempts.append({'phase':'workshop-topology','label':row['candidate'].label,'target':len(row['candidate'].kits),'certified':bool(row.get('certified')),'density':round(float(r.get('density') or 0),2),'gapMm':cert.get('minimumGapMmCertified'),'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount')})
    topo_best=_best(topo)

    topo_count=len(topo_best['candidate'].kits) if topo_best else 0
    if topo_count>=12:
        base_budget=max(42.0,min(64.0,budget*0.34))
    else:
        # V8.0 spent up to 62% here.  On Cactus that left too little time to
        # escape the certified 10->11 local optimum.  Preserve a larger repair budget.
        base_budget=max(48.0,min(78.0,budget*0.48))
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

    ceiling=min(MAX_COMPLETE,len(prepared_kits))
    while count<ceiling and deadline-time.time()>10:
        remaining=deadline-time.time()
        # First use the cheaper 0/1/2-kit repair, but do not let it consume the
        # entire remaining budget when we are already at a strong 9+ incumbent.
        local_cap=24.0 if count>=9 else 34.0
        step_deadline=min(deadline,time.time()+min(local_cap,max(9.0,remaining*0.42)))
        grown,rows=v4.lns_grow_beam(beam,prepared_kits,step_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=10 if count<=12 else 6)
        attempts.extend(rows)

        # If local repair stalls near the target, change topology by freeing 3-5
        # whole kits.  The incumbent is never lost: only independently certified
        # N+1 results can replace it.
        if not grown and count>=9 and deadline-time.time()>8:
            attempts.append({'phase':'deep-lns-trigger','target':count+1,'certified':False,'reason':'local LNS stalled; freeing 3-5 complete kits for topology change'})
            deep_deadline=min(deadline,time.time()+max(8.0,deadline-time.time()-2.0))
            grown,deep_rows=deep_grow_beam(beam,prepared_kits,deep_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=7 if count<=11 else 5)
            attempts.extend(deep_rows)

        if not grown:
            attempts.append({'phase':'v8-deep-practical-maximum','target':count+1,'certified':False,'reason':'local and deep 3-5-kit rebuild exhausted; best certified incumbent preserved'})
            break

        candidate=grown[0]
        if v4._score(candidate)>v4._score(best):best=candidate
        beam=v4._unique_beam(grown+beam,width=4)
        count=len(best['candidate'].kits)
        if climb[-1]!=count:climb.append(count)

    r=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits)
    source='workshop-topology' if str(best['candidate'].label).startswith('workshop-topology') else ('deep-lns' if str(best['candidate'].label).startswith('lns-deep-') else 'v6-or-lns')
    return {'ok':True,'engine':ENGINE,'completeFigures':final,'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':final,'selectionStrategy':best['candidate'].label,'incumbentSource':source,'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),'placements':r.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),'searchPhilosophy':'certified topology -> V6 incumbent -> local repair -> deep 3-5-kit topology repair','deepNeighborhoodSizes':[3,4,5],'climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}
