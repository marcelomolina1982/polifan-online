"""Deep neighbourhood repair for TVT V9.

This layer is intentionally used only after a certified incumbent exists and the
normal N->N+1 LNS stalls.  It frees larger groups (3-5 complete kits) so Sparrow
can change the topology instead of merely hunting for a leftover hole.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import time

from revolutionary import ensemble_v4 as v4


def _deep_plans(incumbent):
    kits=list(incumbent['candidate'].kits)
    placements=(incumbent.get('result') or {}).get('placements') or []
    by_kit={}
    for p in placements:
        kid=str(p.get('kitId') or '')
        if kid: by_kit.setdefault(kid,[]).append(p)

    def right_score(k):
        kid=str(k.get('kitId') or '')
        xs=[float(p.get('xCm') or 0.0)*10.0 for p in by_kit.get(kid,[])]
        return max(xs) if xs else -1e9

    def center_score(k):
        kid=str(k.get('kitId') or '')
        pts=by_kit.get(kid,[])
        if not pts:return 1e18
        xs=[float(p.get('xCm') or 0.0)*10.0 for p in pts]
        ys=[float(p.get('yCm') or 0.0)*10.0 for p in pts]
        cx=sum(xs)/len(xs); cy=sum(ys)/len(ys)
        return abs(cx-610.0)+0.65*abs(cy-290.0)

    right=sorted(kits,key=right_score,reverse=True)
    large=sorted(kits,key=lambda k:float(k.get('envelope') or k.get('area') or 0.0),reverse=True)
    center=sorted(kits,key=center_score)
    compact=sorted(kits,key=v4._extra_rank)

    raw=[]
    for n in (3,4,5):
        raw.append(([str(k.get('kitId')) for k in right[:n]],f'deep-right-{n}'))
        raw.append(([str(k.get('kitId')) for k in large[:n]],f'deep-large-{n}'))
        raw.append(([str(k.get('kitId')) for k in center[:n]],f'deep-center-{n}'))
        mix=[]
        for k in (right[:3]+center[:3]+large[:3]+compact[:3]):
            kid=str(k.get('kitId') or '')
            if kid and kid not in mix:mix.append(kid)
            if len(mix)>=n:break
        raw.append((mix,f'deep-mixed-{n}'))

    out=[];seen=set()
    for ids,label in raw:
        sig=tuple(sorted(x for x in ids if x))
        if len(sig)<3 or sig in seen:continue
        seen.add(sig);out.append((set(sig),label))
    return out


def deep_grow_beam(beam,all_kits,deadline,max_workers=4,extras_per_base=5):
    attempts=[];successes=[];jobs=[]
    for bidx,inc in enumerate(beam[:4]):
        used={str(k.get('kitId') or '') for k in inc['candidate'].kits}
        extras=sorted([k for k in all_kits if str(k.get('kitId') or '') not in used],key=v4._extra_rank)[:extras_per_base]
        plans=_deep_plans(inc)
        for eidx,extra in enumerate(extras):
            for pidx,(disturbed,label) in enumerate(plans):
                seed=v4.SEEDS[(bidx*17+eidx*5+pidx) % len(v4.SEEDS)]
                jobs.append((inc,extra,disturbed,label,seed))
                if len(jobs)>=36:break
            if len(jobs)>=36:break
        if len(jobs)>=36:break

    for start in range(0,len(jobs),max_workers):
        remaining=deadline-time.time()
        if remaining<6.0:break
        wave=jobs[start:start+max_workers]
        seconds=max(5.0,min(16.0,remaining/max(1.0,len(wave)/max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futs={pool.submit(v4._lns_one,inc,extra,disturbed,label,seconds,seed):(inc,extra,label,seed)
                  for inc,extra,disturbed,label,seed in wave}
            for fut in as_completed(futs):
                inc,extra,label,seed=futs[fut]
                target=len(inc['candidate'].kits)+1
                try: row=fut.result()
                except Exception as exc:
                    attempts.append({'phase':'deep-lns-grow','label':label,'seed':seed,'target':target,'certified':False,'error':str(exc)[:240]});continue
                attempts.append(v4._attempt(row,target,'deep-lns-grow'))
                if row.get('certified'):successes.append(row)
        if successes:break
    return v4._unique_beam(successes,width=4),attempts
