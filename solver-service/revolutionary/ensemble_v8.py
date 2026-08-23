"""TVT Revolutionary Ensemble V10.2 — certified portfolio, laboratory only.

U-Nesting is isolated in a killable child process. It can never consume the whole
case budget again. Sparrow/V6 keeps the proven V8.1 budget; U-Nesting only gets a
short direct/full-pool probe and a bounded N+1 rescue. Every proposal must still
pass the normal TVT certificate: >=3 mm, zero collisions, zero border violations.
"""
from __future__ import annotations

import multiprocessing as mp
import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds
from revolutionary.deep_lns_v9 import deep_grow_beam
from revolutionary import unesting_v9

ENGINE='TVT Revolutionary Ensemble V10.2-hard-timeout'
MAX_COMPLETE=18


def _row_from_result(result,prepared_kits):
    ids=[];seen=set()
    for p in result.get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid and kid not in seen:seen.add(kid);ids.append(kid)
    by={str(k.get('kitId') or ''):k for k in prepared_kits}
    kits=[by[x] for x in ids if x in by]
    if not kits:return None
    candidate=type('V10BaseCandidate',(),{'label':str(result.get('selectionStrategy') or 'v6-base'),'kits':kits})()
    return {'candidate':candidate,'seed':result.get('seed'),'result':{'ok':True,'fits':True,'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),'elapsedSeconds':float(result.get('elapsedSeconds') or 0)},'certified':True,'certificate':result.get('productionCertificate') or {}}


def _best(rows):
    good=[r for r in rows if r and r.get('certified')]
    return sorted(good,key=v4._score,reverse=True)[0] if good else None


def _unesting_worker(selected,strategy,milliseconds,q):
    try:q.put(('ok',unesting_v9.solve(selected,strategy=strategy,time_limit_ms=int(milliseconds))))
    except BaseException as exc:
        try:q.put(('err',repr(exc)))
        except BaseException:pass


def _bounded_unesting(selected,strategy,milliseconds,wall_seconds):
    """Run native U-Nesting out-of-process so a slow native call is killable."""
    ctx=mp.get_context('fork')
    q=ctx.Queue(maxsize=1)
    p=ctx.Process(target=_unesting_worker,args=(selected,strategy,milliseconds,q),daemon=True)
    p.start();p.join(max(0.5,float(wall_seconds)))
    if p.is_alive():
        p.terminate();p.join(1.0)
        return {'ok':False,'engine':'u-nesting','error':f'hard timeout after {wall_seconds:.1f}s','hardTimedOut':True}
    try:
        status,payload=q.get_nowait()
        return payload if status=='ok' else {'ok':False,'engine':'u-nesting','error':str(payload)}
    except Exception:
        return {'ok':False,'engine':'u-nesting','error':f'child exited {p.exitcode} without response'}


def _unesting_row(selected,strategy,milliseconds,phase='u-nesting-rescue',wall_seconds=4.5):
    started=time.time();proposal=_bounded_unesting(selected,strategy,max(1200,int(milliseconds)),wall_seconds)
    placements=list(proposal.get('placements') or []);expected=sum(len(k.get('parts') or []) for k in selected)
    density=100.0*sum(float(k.get('area') or 0.0) for k in selected)/(1220.0*580.0)
    result={'ok':bool(proposal.get('ok')),'fits':bool(proposal.get('ok')) and len(placements)==expected,'placements':placements,
            'density':density,'stripWidthMm':1220.0,'elapsedSeconds':round(time.time()-started,2),'externalEngine':proposal.get('engine'),'externalStrategy':strategy}
    ok,cert=v4._certified(selected,result)
    candidate=type('V10UNestingCandidate',(),{'label':f'u-nesting-{strategy}-{len(selected)}','kits':selected})()
    row={'candidate':candidate,'seed':None,'result':result,'certified':ok,'certificate':cert}
    attempt={'phase':phase,'strategy':strategy,'target':len(selected),'certified':bool(ok),'proposalOk':bool(proposal.get('ok')),
             'hardTimedOut':bool(proposal.get('hardTimedOut')),'placedParts':len(placements),'expectedParts':expected,
             'gapMm':cert.get('minimumGapMmCertified'),'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount'),
             'elapsedSeconds':result['elapsedSeconds'],'error':str(proposal.get('error') or '')[:300]}
    return row,attempt


def _full_pool_unesting(prepared_kits,deadline):
    attempts=[]
    if not unesting_v9.available() or len(prepared_kits)<6 or len(prepared_kits)>14:return None,attempts
    # Maximum ~8 seconds total; never steal Sparrow's proven search budget.
    for strategy in ('alns','gdrr'):
        remain=deadline-time.time()
        if remain<2:break
        wall=min(4.0,max(1.5,remain-0.5))
        row,attempt=_unesting_row(list(prepared_kits),strategy,int(wall*850),phase='u-nesting-full-pool',wall_seconds=wall)
        attempts.append(attempt)
        if row and row.get('certified'):return row,attempts
    return None,attempts


def _unesting_rescue(beam,prepared_kits,target,deadline):
    if not unesting_v9.available() or deadline-time.time()<3:return [],[]
    rows=[];attempts=[]
    # One strongest incumbent, two best extras, one strategy each: strict rescue cap.
    for base in beam[:1]:
        current=list(base['candidate'].kits);current_ids={str(k.get('kitId') or '') for k in current}
        extras=sorted([k for k in prepared_kits if str(k.get('kitId') or '') not in current_ids],key=v4._extra_rank)[:2]
        for extra in extras:
            remain=deadline-time.time()
            if remain<3:break
            selected=current+[extra]
            if len(selected)!=target:continue
            wall=min(4.0,max(1.5,remain-1.0))
            row,attempt=_unesting_row(selected,'alns',int(wall*850),wall_seconds=wall)
            attempts.append(attempt)
            if row and row.get('certified'):
                rows.append(row);break
    return v4._unique_beam(rows,width=2),attempts


def _finish(best,topo,climb,attempts,started):
    r=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits);label=str(best['candidate'].label)
    source='workshop-topology' if label.startswith('workshop-topology') else ('u-nesting' if label.startswith('u-nesting-') else ('deep-lns' if label.startswith('lns-deep-') else 'v6-or-lns'))
    return {'ok':True,'engine':ENGINE,'completeFigures':final,'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':final,
            'selectionStrategy':label,'incumbentSource':source,'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),
            'placements':r.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,
            'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,'workshopTopologyTried':len(topo),
            'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),'uNestingAvailable':unesting_v9.available(),
            'searchPhilosophy':'certified topology -> bounded U-Nesting probe -> proven V8.1 Sparrow -> deep repair -> bounded N+1 rescue',
            'climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(60.0,float(total_seconds));deadline=started+budget;attempts=[]
    topo=workshop_seeds(prepared_kits)
    for row in topo:
        r=row.get('result') or {};cert=row.get('certificate') or {}
        attempts.append({'phase':'workshop-topology','label':row['candidate'].label,'target':len(row['candidate'].kits),'certified':bool(row.get('certified')),
                         'density':round(float(r.get('density') or 0),2),'gapMm':cert.get('minimumGapMmCertified'),'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount')})
    topo_best=_best(topo)

    early=None
    if not topo_best or len(topo_best['candidate'].kits)<len(prepared_kits):
        probe_deadline=min(deadline,time.time()+8.5)
        early,urows=_full_pool_unesting(prepared_kits,probe_deadline);attempts.extend(urows)
        if early and len(early['candidate'].kits)==len(prepared_kits):return _finish(early,topo,[len(prepared_kits)],attempts,started)

    topo_count=len(topo_best['candidate'].kits) if topo_best else 0
    # Proven V8.1 allocation that reached Cactus 10 and homogeneous 10.
    if topo_count>=12:base_budget=max(42.0,min(64.0,budget*0.34))
    else:base_budget=max(48.0,min(78.0,budget*0.48))
    base=v6.revolutionary_solve_v6(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
    base_row=_row_from_result(base,prepared_kits) if base.get('ok') else None
    if base.get('attempts'):attempts.extend(base.get('attempts') or [])
    best=_best([topo_best,early,base_row])
    if best is None:return {'ok':False,'engine':ENGINE,'error':'No certified incumbent','attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}

    climb=list(base.get('climbHistory') or []);count=len(best['candidate'].kits)
    if not climb or climb[-1]!=count:climb.append(count)
    beam=v4._unique_beam([x for x in [topo_best,early,base_row] if x and x.get('certified')],width=4);ceiling=min(MAX_COMPLETE,len(prepared_kits))

    while count<ceiling and deadline-time.time()>10:
        remaining=deadline-time.time();local_cap=24.0 if count>=9 else 34.0
        step_deadline=min(deadline-8.0,time.time()+min(local_cap,max(9.0,remaining*0.42)))
        if step_deadline<=time.time():break
        grown,rows=v4.lns_grow_beam(beam,prepared_kits,step_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=10 if count<=12 else 6);attempts.extend(rows)
        if not grown and count>=9 and deadline-time.time()>18:
            deep_deadline=min(deadline-8.0,time.time()+min(26.0,max(8.0,(deadline-time.time())*0.45)))
            attempts.append({'phase':'deep-lns-trigger','target':count+1,'certified':False,'reason':'bounded 3-5 kit topology repair'})
            grown,deep_rows=deep_grow_beam(beam,prepared_kits,deep_deadline,max_workers=max(1,min(4,max_workers)),extras_per_base=7 if count<=11 else 5);attempts.extend(deep_rows)
        if not grown and deadline-time.time()>5:
            grown,urows=_unesting_rescue(beam,prepared_kits,count+1,deadline);attempts.extend(urows)
        if not grown:
            attempts.append({'phase':'v10.2-practical-maximum','target':count+1,'certified':False,'reason':'bounded search families exhausted; incumbent preserved'});break
        candidate=grown[0]
        if v4._score(candidate)>v4._score(best):best=candidate
        beam=v4._unique_beam(grown+beam,width=4);count=len(best['candidate'].kits)
        if climb[-1]!=count:climb.append(count)
    return _finish(best,topo,climb,attempts,started)
