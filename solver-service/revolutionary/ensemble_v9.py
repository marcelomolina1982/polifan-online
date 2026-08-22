"""TVT Revolutionary Ensemble V9.0 — certified-topology first.

V8 proved a useful idea but still spent most of its time rebuilding a lower V6
solution even when a 12-kit workshop topology had already passed the independent
3 mm certifier. V9 treats a certified topology as a fully valid incumbent immediately
and spends the budget on the only interesting question: can N+1 fit after moving
several complete kits? If no learned topology applies, V6 remains the generic base.
Production is untouched.
"""
from __future__ import annotations
import time
from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Ensemble V9.0'
MAX_COMPLETE=18


def _row_from_result(result,prepared_kits):
    ids=[];seen=set()
    for p in result.get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid and kid not in seen:seen.add(kid);ids.append(kid)
    by={str(k.get('kitId') or ''):k for k in prepared_kits};kits=[by[x] for x in ids if x in by]
    if not kits:return None
    candidate=type('V9BaseCandidate',(),{'label':str(result.get('selectionStrategy') or 'v6-base'),'kits':kits})()
    return {'candidate':candidate,'seed':result.get('seed'),'result':{'ok':True,'fits':True,'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),'elapsedSeconds':float(result.get('elapsedSeconds') or 0)},'certified':True,'certificate':result.get('productionCertificate') or {}}


def _best(rows):
    good=[r for r in rows if r and r.get('certified')]
    return sorted(good,key=v4._score,reverse=True)[0] if good else None


def _attempt_row(row,phase):
    r=row.get('result') or {};c=row.get('certificate') or {}
    return {'phase':phase,'label':row['candidate'].label,'target':len(row['candidate'].kits),'certified':bool(row.get('certified')),'density':round(float(r.get('density') or 0),2),'gapMm':c.get('minimumGapMmCertified'),'collisionCount':c.get('collisionCount'),'outsidePlateCount':c.get('outsidePlateCount'),'reason':c.get('reason')}


def revolutionary_solve_v9(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(45.0,float(total_seconds));deadline=started+budget;attempts=[]
    topo=workshop_seeds(prepared_kits)
    attempts.extend(_attempt_row(r,'workshop-topology-v9') for r in topo)
    topo_best=_best(topo)
    fast_path=topo_best is not None

    if fast_path:
        best=topo_best
        beam=v4._unique_beam([r for r in topo if r.get('certified')],width=4)
        climb=[len(best['candidate'].kits)]
        # The topology is already independently certified. Do not waste 45-70 s
        # reproducing a smaller answer. Attack N+1 directly with local rebuilds.
        ceiling=min(MAX_COMPLETE,len(prepared_kits))
        while len(best['candidate'].kits)<ceiling and deadline-time.time()>8:
            count=len(best['candidate'].kits)
            remain=deadline-time.time()
            step=min(34.0,max(12.0,remain*0.72))
            step_deadline=min(deadline,time.time()+step)
            grown,rows=v4.lns_grow_beam(beam,prepared_kits,step_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=12 if count<=12 else 8)
            attempts.extend(rows)
            if not grown:
                attempts.append({'phase':'v9-n-plus-one-exhausted','target':count+1,'certified':False,'reason':'certified topology preserved; local rebuild could not prove N+1 within budget'})
                break
            candidate=grown[0]
            if v4._score(candidate)>v4._score(best):best=candidate
            beam=v4._unique_beam(grown+beam,width=4)
            new_count=len(best['candidate'].kits)
            if climb[-1]!=new_count:climb.append(new_count)
    else:
        # Generic unknown geometry: keep the strongest adaptive engine so 8/9 can
        # be valid when large figures physically cannot reach ten.
        base_budget=max(40.0,min(budget,145.0))
        base=v6.revolutionary_solve_v6(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
        attempts.extend(base.get('attempts') or [])
        if not base.get('ok'):
            return {'ok':False,'engine':ENGINE,'error':base.get('error') or 'generic base failed','attempts':attempts,'elapsedSeconds':round(time.time()-started,2),'productionUntouched':True}
        best=_row_from_result(base,prepared_kits)
        if best is None:return {'ok':False,'engine':ENGINE,'error':'generic base could not be reconstructed','attempts':attempts,'elapsedSeconds':round(time.time()-started,2),'productionUntouched':True}
        beam=[best];climb=list(base.get('climbHistory') or [len(best['candidate'].kits)])
        # Use any remaining time for one direct growth phase.
        if deadline-time.time()>10 and len(best['candidate'].kits)<min(MAX_COMPLETE,len(prepared_kits)):
            grown,rows=v4.lns_grow_beam(beam,prepared_kits,deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=10)
            attempts.extend(rows)
            if grown and v4._score(grown[0])>v4._score(best):
                best=grown[0];climb.append(len(best['candidate'].kits))

    r=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits)
    return {'ok':True,'engine':ENGINE,'completeFigures':final,'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':final,'selectionStrategy':best['candidate'].label,'incumbentSource':'workshop-topology' if fast_path else 'generic-v6','usedTopologyFastPath':fast_path,'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),'placements':r.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),'searchPhilosophy':'certified topology -> direct N+1 LNS; otherwise adaptive V6 -> residual N+1','climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2),'productionUntouched':True}
