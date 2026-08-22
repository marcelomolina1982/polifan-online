"""TVT Revolutionary Ensemble V6.0 — selection mutation + full repack.

Built on V5. V5 already learned the crucial 'move several figures, not only fill a
hole' behavior. V6 adds the missing second half: when the current *mix* of kits is
the local optimum, it may remove 1-3 complete kits and inject 2-4 different kits
(net +1), then repack the entire mutated set with continuous rotation.

This models the real workshop observation that reaching 11 can require changing
which figures share the plate as well as moving/rotating several incumbents.
Production remains untouched; every accepted result still passes the independent
>=3 mm certificate from V4.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import combinations
import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v5 as v5

ENGINE='TVT Revolutionary Ensemble V6.0'
MAX_COMPLETE=16


def _row_from_result(result, prepared_kits):
    ids=[]
    seen=set()
    for p in result.get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid and kid not in seen:
            seen.add(kid);ids.append(kid)
    by={str(k.get('kitId') or ''):k for k in prepared_kits}
    kits=[by[x] for x in ids if x in by]
    if not kits:return None
    candidate=type('V6Incumbent',(),{'label':str(result.get('selectionStrategy') or 'v5-incumbent'),'kits':kits})()
    return {
        'candidate':candidate,
        'seed':result.get('seed'),
        'result':{
            'ok':True,'fits':True,
            'placements':result.get('placements') or [],
            'density':float(result.get('density') or 0),
            'stripWidthMm':float(result.get('stripWidthMm') or 0),
            'elapsedSeconds':float(result.get('elapsedSeconds') or 0),
        },
        'certified':True,
        'certificate':result.get('productionCertificate') or {},
    }


def _right_rank(incumbent):
    placements=(incumbent.get('result') or {}).get('placements') or []
    by={}
    for p in placements:
        kid=str(p.get('kitId') or '')
        if kid:by.setdefault(kid,[]).append(p)
    def score(k):
        xs=[float(p.get('xCm') or 0)*10 for p in by.get(str(k.get('kitId') or ''),[])]
        return max(xs) if xs else -1e9
    return sorted(incumbent['candidate'].kits,key=score,reverse=True)


def _removal_sets(incumbent,n,limit=5):
    kits=list(incumbent['candidate'].kits)
    if len(kits)<n:return []
    right=_right_rank(incumbent)
    large=sorted(kits,key=lambda k:float(k.get('envelope') or k.get('area') or 0),reverse=True)
    lowpri=sorted(kits,key=lambda k:(float(k.get('priority') or 999999),-float(k.get('envelope') or 0)),reverse=True)
    raw=[]
    for src in (right,large,lowpri):
        if len(src)>=n:raw.append(tuple(str(k.get('kitId') or '') for k in src[:n]))
    pool=[]
    for k in right[:4]+large[:4]:
        kid=str(k.get('kitId') or '')
        if kid and kid not in pool:pool.append(kid)
    for c in combinations(pool,n):raw.append(tuple(c))
    out=[];seen=set()
    for ids in raw:
        sig=tuple(sorted(ids))
        if sig in seen:continue
        seen.add(sig);out.append(set(ids))
        if len(out)>=limit:break
    return out


def _attempt_candidate(kits,label,seconds,seeds):
    candidate=type('V6Candidate',(),{'label':label,'kits':kits})()
    rows=[]
    with ThreadPoolExecutor(max_workers=min(2,len(seeds))) as pool:
        futs={pool.submit(v4._run_fresh,candidate,seconds,s):s for s in seeds}
        for fut in as_completed(futs):
            seed=futs[fut]
            try:row=fut.result()
            except Exception as exc:
                rows.append({'candidate':candidate,'seed':seed,'result':{'ok':False,'error':str(exc)},'certified':False,'certificate':{}});continue
            rows.append(row)
    good=v4._unique_beam([r for r in rows if r.get('certified')],width=2)
    return good,rows


def mutation_grow(incumbent,all_kits,deadline,attempt_log):
    """Try N->N+1 by changing both layout and selection.

    destroy 1 + add 2, destroy 2 + add 3, destroy 3 + add 4.
    Each mutated target is fully repacked, so every incumbent may move/rotate.
    """
    used={str(k.get('kitId') or '') for k in incumbent['candidate'].kits}
    extras=sorted([k for k in all_kits if str(k.get('kitId') or '') not in used],key=v4._extra_rank)[:9]
    if len(extras)<2:return []
    by={str(k.get('kitId') or ''):k for k in all_kits}
    base=list(incumbent['candidate'].kits)
    target=len(base)+1
    jobs=[]
    for destroy in (1,2,3):
        if len(base)<=destroy or len(extras)<destroy+1:continue
        remsets=_removal_sets(incumbent,destroy,limit=4)
        addsets=list(combinations(extras,destroy+1))[:8]
        for ridx,rem in enumerate(remsets):
            kept=[k for k in base if str(k.get('kitId') or '') not in rem]
            for aidx,adds in enumerate(addsets):
                candidate=kept+list(adds)
                if len(candidate)!=target:continue
                sig=tuple(sorted(str(k.get('kitId') or '') for k in candidate))
                jobs.append((candidate,f'mutate-{destroy}-to-{destroy+1}-r{ridx}-a{aidx}',sig,destroy))
                if len(jobs)>=28:break
            if len(jobs)>=28:break
        if len(jobs)>=28:break

    seen=set();success=[]
    for j,(kits,label,sig,destroy) in enumerate(jobs):
        if time.time()+4.0>=deadline:break
        if sig in seen:continue
        seen.add(sig)
        remain=deadline-time.time()
        sec=max(3.5,min(7.0,remain/3.0))
        seeds=(v4.SEEDS[(j*2)%len(v4.SEEDS)],v4.SEEDS[(j*2+1)%len(v4.SEEDS)])
        good,rows=_attempt_candidate(kits,label,sec,seeds)
        for row in rows:
            r=row.get('result') or {};cert=row.get('certificate') or {}
            attempt_log.append({
                'phase':'selection-mutation','label':label,'destroy':destroy,'add':destroy+1,
                'seed':row.get('seed'),'target':target,'certified':bool(row.get('certified')),
                'density':round(float(r.get('density') or 0),2),'stripWidthMm':round(float(r.get('stripWidthMm') or 0),2),
                'gapMm':cert.get('minimumGapMmCertified'),'error':str(r.get('error') or '')[:180],
            })
        if good:
            success.extend(good)
            # Do not stop at first one: keep a couple of structurally different
            # solutions so the next climb is not trapped by one lucky topology.
            if len(v4._unique_beam(success,width=3))>=3:break
    return v4._unique_beam(success,width=3)


def revolutionary_solve_v6(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(60.0,float(total_seconds));deadline=started+budget

    # Give V5 roughly half the budget to secure and climb a certified incumbent.
    base_budget=max(55.0,min(105.0,budget*0.58))
    base=v5.revolutionary_solve_v5(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
    if not base.get('ok'):
        base['engine']=ENGINE;return base
    incumbent=_row_from_result(base,prepared_kits)
    if incumbent is None:
        return {'ok':False,'engine':ENGINE,'error':'V5 devolvió una placa que no pudo reconstruirse por kitId','elapsedSeconds':round(time.time()-started,2)}

    attempts=list(base.get('attempts') or [])
    climb=list(base.get('climbHistory') or [len(incumbent['candidate'].kits)])
    best=incumbent
    beam=[incumbent]
    ceiling=min(MAX_COMPLETE,len(prepared_kits))

    # First try V5-style growth again with remaining time from multiple incumbents.
    while len(best['candidate'].kits)<ceiling and deadline-time.time()>10:
        target=len(best['candidate'].kits)+1
        local_deadline=min(deadline,time.time()+min(22.0,(deadline-time.time())*0.35))
        grown,rows=v4.lns_grow_beam(beam,prepared_kits,local_deadline,max_workers=max(1,min(3,max_workers)),extras_per_base=8)
        attempts.extend(rows)
        if grown:
            beam=grown;best=grown[0];climb.append(len(best['candidate'].kits));continue

        # New V6 step: selection mutation + complete repack.
        mutated=[]
        for inc in beam[:3]:
            if deadline-time.time()<8:break
            mutated.extend(mutation_grow(inc,prepared_kits,deadline,attempts))
        mutated=v4._unique_beam(mutated,width=4)
        if mutated:
            beam=mutated;best=mutated[0];climb.append(len(best['candidate'].kits));continue

        attempts.append({'phase':'practical-maximum-v6','target':target,'certified':False,'reason':'local move/repack and selection mutation 1-3 both exhausted; incumbent preserved'})
        break

    result=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits)
    return {
        'ok':True,'engine':ENGINE,'completeFigures':final,
        'commercialTarget':v4.COMMERCIAL_TARGET,
        'initialCertifiedCount':base.get('initialCertifiedCount'),
        'adaptiveFloorUsed':bool(base.get('adaptiveFloorUsed')),
        'probablePracticalMaximum':final,
        'selectionStrategy':best['candidate'].label,'seed':best.get('seed'),
        'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),
        'placements':result.get('placements') or [],'productionCertificate':cert,
        'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,
        'targetDensityReached':float(result.get('density') or 0)>=v4.TARGET_DENSITY,
        'beamWidth':4,'localNeighborhoodSizes':[0,1,2,3,4,5],
        'selectionMutationSizes':['-1 +2','-2 +3','-3 +4'],
        'searchPhilosophy':'V5 foothold/climb + local move/repack + mutate selection and full repack',
        'climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2),
    }
