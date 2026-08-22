"""TVT Revolutionary Ensemble V7.0 — deep escape search above a certified V6 incumbent.

V7 keeps every V6 safety invariant and only attacks the exact failure mode seen in
manual workshop layouts: N fits, N+1 needs several existing kits to move and sometimes
a different kit mix. It therefore expands the destroy/rebuild neighborhood to 1..4
complete kits, a larger extra pool, more removal/addition combinations and several
independent seed pairs. The best certified incumbent is never discarded.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from itertools import combinations
import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6

ENGINE='TVT Revolutionary Ensemble V7.0'
MAX_COMPLETE=18


def _row_from_result(result, prepared_kits):
    ids=[];seen=set()
    for p in result.get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid and kid not in seen:seen.add(kid);ids.append(kid)
    by={str(k.get('kitId') or ''):k for k in prepared_kits}
    kits=[by[x] for x in ids if x in by]
    if not kits:return None
    candidate=type('V7Incumbent',(),{'label':str(result.get('selectionStrategy') or 'v6-incumbent'),'kits':kits})()
    return {'candidate':candidate,'seed':result.get('seed'),'result':{'ok':True,'fits':True,'placements':result.get('placements') or [],'density':float(result.get('density') or 0),'stripWidthMm':float(result.get('stripWidthMm') or 0),'elapsedSeconds':float(result.get('elapsedSeconds') or 0)},'certified':True,'certificate':result.get('productionCertificate') or {}}


def _rank_right(inc):
    by={}
    for p in (inc.get('result') or {}).get('placements') or []:
        kid=str(p.get('kitId') or '')
        if kid:by.setdefault(kid,[]).append(p)
    def score(k):
        xs=[float(p.get('xCm') or 0)*10 for p in by.get(str(k.get('kitId') or ''),[])]
        return max(xs) if xs else -1e9
    return sorted(inc['candidate'].kits,key=score,reverse=True)


def _removal_sets(inc,n,limit=10):
    kits=list(inc['candidate'].kits)
    if len(kits)<n:return []
    right=_rank_right(inc)
    large=sorted(kits,key=lambda k:float(k.get('envelope') or k.get('area') or 0),reverse=True)
    small=sorted(kits,key=lambda k:float(k.get('envelope') or k.get('area') or 0))
    lowpri=sorted(kits,key=lambda k:(float(k.get('priority') or 999999),-float(k.get('envelope') or 0)),reverse=True)
    raw=[]
    for src in (right,large,small,lowpri):
        if len(src)>=n:raw.append(tuple(str(k.get('kitId') or '') for k in src[:n]))
    pool=[]
    for k in right[:6]+large[:6]+small[:4]:
        kid=str(k.get('kitId') or '')
        if kid and kid not in pool:pool.append(kid)
    for c in combinations(pool,n):
        raw.append(tuple(c))
        if len(raw)>=80:break
    out=[];seen=set()
    for ids in raw:
        sig=tuple(sorted(ids))
        if sig in seen:continue
        seen.add(sig);out.append(set(ids))
        if len(out)>=limit:break
    return out


def _run_candidate(kits,label,seconds,seeds):
    candidate=type('V7Candidate',(),{'label':label,'kits':kits})()
    rows=[]
    with ThreadPoolExecutor(max_workers=min(3,len(seeds))) as pool:
        futs={pool.submit(v4._run_fresh,candidate,seconds,s):s for s in seeds}
        for fut in as_completed(futs):
            seed=futs[fut]
            try:rows.append(fut.result())
            except Exception as exc:rows.append({'candidate':candidate,'seed':seed,'result':{'ok':False,'error':str(exc)},'certified':False,'certificate':{}})
    return v4._unique_beam([r for r in rows if r.get('certified')],width=4),rows


def deep_mutation_grow(incumbent,all_kits,deadline,attempt_log):
    used={str(k.get('kitId') or '') for k in incumbent['candidate'].kits}
    extras=sorted([k for k in all_kits if str(k.get('kitId') or '') not in used],key=v4._extra_rank)[:14]
    base=list(incumbent['candidate'].kits);target=len(base)+1
    if len(extras)<2:return []
    jobs=[];seen=set()
    for destroy in (1,2,3,4):
        if len(base)<=destroy or len(extras)<destroy+1:continue
        remsets=_removal_sets(incumbent,destroy,limit=10)
        addsets=list(combinations(extras,destroy+1))[:18]
        for ridx,rem in enumerate(remsets):
            kept=[k for k in base if str(k.get('kitId') or '') not in rem]
            for aidx,adds in enumerate(addsets):
                cand=kept+list(adds)
                if len(cand)!=target:continue
                sig=tuple(sorted(str(k.get('kitId') or '') for k in cand))
                if sig in seen:continue
                seen.add(sig);jobs.append((cand,f'deep-mutate-{destroy}-to-{destroy+1}-r{ridx}-a{aidx}',destroy))
                if len(jobs)>=96:break
            if len(jobs)>=96:break
        if len(jobs)>=96:break
    success=[]
    for j,(kits,label,destroy) in enumerate(jobs):
        if deadline-time.time()<5.0:break
        remain=deadline-time.time();sec=max(3.5,min(9.0,remain/4.0))
        seeds=(v4.SEEDS[(j*3)%len(v4.SEEDS)],v4.SEEDS[(j*3+1)%len(v4.SEEDS)],v4.SEEDS[(j*3+2)%len(v4.SEEDS)])
        good,rows=_run_candidate(kits,label,sec,seeds)
        for row in rows:
            r=row.get('result') or {};cert=row.get('certificate') or {}
            attempt_log.append({'phase':'deep-selection-mutation','label':label,'destroy':destroy,'add':destroy+1,'seed':row.get('seed'),'target':target,'certified':bool(row.get('certified')),'density':round(float(r.get('density') or 0),2),'stripWidthMm':round(float(r.get('stripWidthMm') or 0),2),'gapMm':cert.get('minimumGapMmCertified'),'error':str(r.get('error') or '')[:160]})
        if good:
            success.extend(good)
            if len(v4._unique_beam(success,width=4))>=4:break
    return v4._unique_beam(success,width=4)


def revolutionary_solve_v7(prepared_kits,total_seconds=240.0,max_workers=4):
    started=time.time();budget=max(75.0,float(total_seconds));deadline=started+budget
    base_budget=max(65.0,min(150.0,budget*0.60))
    base=v6.revolutionary_solve_v6(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
    if not base.get('ok'):
        base['engine']=ENGINE;return base
    incumbent=_row_from_result(base,prepared_kits)
    if incumbent is None:return {'ok':False,'engine':ENGINE,'error':'V6 incumbent could not be reconstructed','elapsedSeconds':round(time.time()-started,2)}
    attempts=list(base.get('attempts') or []);climb=list(base.get('climbHistory') or [len(incumbent['candidate'].kits)])
    best=incumbent;beam=[incumbent];ceiling=min(MAX_COMPLETE,len(prepared_kits))
    while len(best['candidate'].kits)<ceiling and deadline-time.time()>10:
        target=len(best['candidate'].kits)+1
        grown=[]
        for inc in beam[:4]:
            if deadline-time.time()<8:break
            grown.extend(deep_mutation_grow(inc,prepared_kits,deadline,attempts))
        grown=v4._unique_beam(grown,width=4)
        if grown:
            beam=grown;best=grown[0];climb.append(len(best['candidate'].kits));continue
        attempts.append({'phase':'practical-maximum-v7','target':target,'certified':False,'reason':'deep mutation -1/+2 through -4/+5 exhausted; certified incumbent preserved'})
        break
    r=best.get('result') or {};cert=best.get('certificate') or {};final=len(best['candidate'].kits)
    return {'ok':True,'engine':ENGINE,'completeFigures':final,'commercialTarget':v4.COMMERCIAL_TARGET,'initialCertifiedCount':base.get('initialCertifiedCount'),'adaptiveFloorUsed':bool(base.get('adaptiveFloorUsed')),'probablePracticalMaximum':final,'selectionStrategy':best['candidate'].label,'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),'placements':r.get('placements') or [],'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,'beamWidth':4,'selectionMutationSizes':['-1 +2','-2 +3','-3 +4','-4 +5'],'searchPhilosophy':'V6 certified incumbent + deep multi-kit selection mutation and full repack','climbHistory':climb,'attempts':attempts,'elapsedSeconds':round(time.time()-started,2)}
