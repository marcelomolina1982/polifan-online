"""TVT Revolutionary Ensemble V2.

Experimental only. Production is untouched.
Changes vs V1:
- no hard minimum of 10 (large figures may max out at 8/9)
- starts near 12 to attack known manual benchmarks directly
- climbs if feasible, descends if not
- preserves the best certified lower solution
- allocates more search budget to 11/12 instead of spending it all reaching 10
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from itertools import combinations
import time

import nest_sparrow as ns

MIN_COMPLETE = 1
MAX_COMPLETE = 16
PIVOT_COMPLETE = 12
MIN_GAP_MM = 3.0
TARGET_DENSITY = 70.0
SEEDS = (41, 429, 1701, 7919, 31337, 65537, 104729, 130363, 161803, 271828)


@dataclass
class Candidate:
    label: str
    kits: list


def _key(k): return str(k.get('kitId') or '')
def _priority(k): return float(k.get('priority') or 999999)

def _compact(k):
    env=max(1.0,float(k.get('envelope') or 1.0)); area=max(1.0,float(k.get('area') or 1.0))
    solidity=max(0.01,float(k.get('solidity') or area/env))
    return (env/solidity,-area,_priority(k))

def _area(k): return (-float(k.get('area') or 0.0),-float(k.get('solidity') or 0.0),_priority(k))
def _mixed(k):
    env=max(1.0,float(k.get('envelope') or 1.0)); area=max(1.0,float(k.get('area') or 1.0))
    return (max(0.0,env-area)/area,env,-area,_priority(k))

def _unique(rows):
    out=[]; seen=set()
    for row in rows:
        kid=_key(row)
        if kid and kid not in seen:
            seen.add(kid); out.append(row)
    return out

def _priority_boundary(kits,target):
    ordered=sorted(kits,key=lambda k:(_priority(k),str(k.get('date') or ''),_key(k)))
    if len(ordered)<target: return [],[]
    p=_priority(ordered[target-1])
    return [k for k in ordered if _priority(k)<p],[k for k in ordered if _priority(k)==p]

def candidate_portfolios(kits,target,limit=36):
    mandatory,frontier=_priority_boundary(kits,target)
    slots=target-len(mandatory)
    if slots<0 or len(frontier)<slots: return []
    outputs=[]; seen=set()
    def add(label,chosen):
        rows=_unique(mandatory+list(chosen))
        if len(rows)!=target: return
        sig=tuple(sorted(_key(k) for k in rows))
        if sig in seen: return
        seen.add(sig); outputs.append(Candidate(label,rows))
    orderings=(('priority',frontier),('compact',sorted(frontier,key=_compact)),('area',sorted(frontier,key=_area)),('mixed',sorted(frontier,key=_mixed)))
    for label,source in orderings:
        add(label,source[:slots])
        for off in range(1,min(14,max(0,len(source)-slots))+1):
            add(f'{label}-window-{off}',source[off:off+slots])
            if len(outputs)>=limit: return outputs[:limit]
    compact=sorted(frontier,key=_compact)
    if slots>=2:
        fixed=compact[:max(0,slots-2)]
        tail=compact[max(0,slots-2):max(0,slots-2)+12]
        for idx,pair in enumerate(combinations(tail,2)):
            add(f'compact-pair-{idx}',fixed+list(pair))
            if len(outputs)>=limit: break
    return outputs[:limit]

def solution_score(selected,result):
    count=len(selected); density=float((result or {}).get('density') or 0.0)
    width=float((result or {}).get('stripWidthMm') or 1e18); seconds=float((result or {}).get('elapsedSeconds') or 1e18)
    return (count,density,-width,-seconds)

def certified(selected,result):
    if not result or not result.get('ok') or not result.get('fits'): return False,{}
    validator=getattr(ns,'_validate_final_geometry',None)
    if validator is None: return False,{'reason':'certifier unavailable'}
    valid,cert=validator(selected,result); gap=cert.get('minimumGapMmCertified')
    return bool(valid and gap is not None and float(gap)>=MIN_GAP_MM),cert

def _run_one(candidate,seconds,seed):
    result=ns._run_sparrow(candidate.kits,MIN_GAP_MM,seconds,seed,continuous=True)
    ok,cert=certified(candidate.kits,result)
    return {'candidate':candidate,'seed':seed,'result':result,'certified':ok,'certificate':cert}

def run_level(kits,target,seconds_per_run=8.0,max_portfolios=16,max_workers=4):
    portfolios=candidate_portfolios(kits,target,max_portfolios)
    jobs=[]
    for idx,c in enumerate(portfolios):
        seed_count=3 if target in (11,12) else 2
        for j in range(seed_count): jobs.append((c,SEEDS[(idx*3+j)%len(SEEDS)]))
    best=None; attempts=[]
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures={pool.submit(_run_one,c,seconds_per_run,seed):(c,seed) for c,seed in jobs}
        for fut in as_completed(futures):
            row=fut.result(); c=row['candidate']; r=row['result'] or {}
            attempts.append({'label':c.label,'seed':row['seed'],'target':target,'certified':row['certified'],'density':round(float(r.get('density') or 0.0),2),'stripWidthMm':round(float(r.get('stripWidthMm') or 0.0),2),'elapsedSeconds':r.get('elapsedSeconds'),'gapMm':row['certificate'].get('minimumGapMmCertified')})
            if row['certified'] and (best is None or solution_score(c.kits,r)>solution_score(best['candidate'].kits,best['result'])): best=row
    return best,attempts

def _level_plan(target,remaining,max_workers):
    if target==12: base,ports=10.0,18
    elif target==11: base,ports=9.0,16
    elif target==13: base,ports=8.0,12
    elif target>=14: base,ports=6.0,8
    elif target==10: base,ports=7.0,12
    else: base,ports=5.0,8
    approx_jobs=ports*(3 if target in (11,12) else 2)
    affordable=max(2.5,remaining*max_workers/max(approx_jobs,1)*0.82)
    return min(base,affordable),ports

def revolutionary_solve(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time(); all_attempts=[]; best=None; tested=[]
    n=len(prepared_kits)
    if n<1: return {'ok':False,'error':'No usable kits','attempts':[]}

    pivot=min(PIVOT_COMPLETE,MAX_COMPLETE,n)
    # Probe 12 first. If it works, climb. If it fails, descend until a certified
    # maximum-like solution is found. This avoids wasting most of the budget on 10.
    targets=[pivot]
    targets += list(range(pivot+1,min(MAX_COMPLETE,n)+1))
    targets += list(range(pivot-1,MIN_COMPLETE-1,-1))

    pivot_failed=False
    for target in targets:
        remaining=total_seconds-(time.time()-started)
        if remaining<6: break
        # Once pivot failed we skip upward targets and immediately descend.
        if pivot_failed and target>pivot: continue
        per_run,ports=_level_plan(target,remaining,max_workers)
        level,attempts=run_level(prepared_kits,target,per_run,ports,max_workers)
        all_attempts.extend(attempts); tested.append({'target':target,'certified':bool(level),'attempts':len(attempts)})
        if level is not None:
            if best is None or solution_score(level['candidate'].kits,level['result'])>solution_score(best['candidate'].kits,best['result']): best=level
            # If descending after a failed pivot, first success is the best count we
            # have proved within this search budget; stop to preserve time.
            if pivot_failed and target<pivot: break
        else:
            if target==pivot: pivot_failed=True
            elif best is not None and target>len(best['candidate'].kits):
                # Failed N+1 after success at N: keep N and stop climbing.
                break

    if best is None:
        return {'ok':False,'error':'No certified placement found','attempts':all_attempts,'testedTargets':tested,'elapsedSeconds':round(time.time()-started,2)}
    result=dict(best['result'])
    return {'ok':True,'engine':'TVT Revolutionary Ensemble V2','completeFigures':len(best['candidate'].kits),'selectionStrategy':best['candidate'].label,'seed':best['seed'],'density':float(result.get('density') or 0.0),'stripWidthMm':float(result.get('stripWidthMm') or 0.0),'placements':result.get('placements') or [],'productionCertificate':best['certificate'],'minimumGapMm':best['certificate'].get('minimumGapMmCertified'),'requiredGapMm':MIN_GAP_MM,'targetDensityReached':float(result.get('density') or 0.0)>=TARGET_DENSITY,'testedTargets':tested,'attempts':all_attempts,'elapsedSeconds':round(time.time()-started,2),'adaptiveCount':True,'hardMinimumDisabled':True}
