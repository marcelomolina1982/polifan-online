"""TVT Revolutionary V10.12 — clean certified low-CPU Sparrow.

Single-lane, independently certified >=3 mm. Production can return immediately
once 10 complete certified figures are found; deep optimization remains available
for benchmarks/plates where 11+ is explicitly desired.
"""
from __future__ import annotations
import time
from revolutionary import ensemble_v4 as v4
from revolutionary.selector_v2 import portfolios as select_portfolios
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary V10.12 clean-certified-fast'
SEEDS=(41,1701,31337,104729,429,65537)


def _valid(row):
    if not row or not row.get('certified'): return False
    cert=row.get('certificate') or {}
    try: gap=float(cert.get('minimumGapMmCertified') or 0)
    except Exception: gap=0.0
    return gap>=3.0 and int(cert.get('collisionCount') or 0)==0 and int(cert.get('outsidePlateCount') or 0)==0


def _score(row):
    if not _valid(row): return (-1,-1,-1)
    r=row.get('result') or {}
    return (len(row['candidate'].kits),float(r.get('density') or 0),-float(r.get('stripWidthMm') or 1e18))


def _best(rows):
    good=[r for r in rows if _valid(r)]
    return max(good,key=_score) if good else None


def _row_payload(best,started,attempts,topology_count=0,early_exit=False):
    r=best.get('result') or {}; cert=best.get('certificate') or {}; count=len(best['candidate'].kits)
    return {'ok':True,'engine':ENGINE,'completeFigures':count,'commercialTarget':10,
      'probablePracticalMaximum':count,'selectionStrategy':best['candidate'].label,'seed':best.get('seed'),
      'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),
      'placements':r.get('placements') or [],'productionCertificate':cert,
      'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':3.0,'attempts':attempts,
      'workshopTopologyTried':topology_count,'runtimeWorkers':1,
      'earlyCommercialExit':bool(early_exit),
      'searchPhilosophy':'few long deterministic Sparrow runs + certified warm-start growth',
      'elapsedSeconds':round(time.time()-started,2)}


def _topology_best(prepared_kits):
    rows=workshop_seeds(prepared_kits); good=[x for x in rows if x.get('certified')]
    if not good:return None,rows
    return max(good,key=lambda x:(len(x['candidate'].kits),float((x.get('result') or {}).get('density') or 0))),rows


def _attempt_record(phase,label,seed,target,seconds,row):
    rr=row.get('result') or {}; cert=row.get('certificate') or {}
    return {'phase':phase,'label':label,'seed':seed,'target':target,'seconds':round(seconds,1),
      'certified':bool(row.get('certified')),'gapMm':cert.get('minimumGapMmCertified') if cert else None,
      'certificateReason':cert.get('reason') if cert else None,'certificatePair':cert.get('pair') if cert else None,
      'certificateBounds':cert.get('bounds') if cert else None,'certificateGapMm':cert.get('gapMm') if cert else None,
      'density':rr.get('density'),'stripWidthMm':rr.get('stripWidthMm'),'fits':rr.get('fits'),
      'placedParts':rr.get('placedParts'),'expectedParts':rr.get('expectedParts'),
      'error':str(rr.get('error') or '')[:220]}


def _fresh_long(kits,target,deadline,attempt_log,max_candidates=5):
    candidates=select_portfolios(kits,target,limit=max_candidates)
    if not candidates:return None
    successes=[]
    for idx,candidate in enumerate(candidates[:max_candidates]):
        remaining=deadline-time.time()
        if remaining<18:break
        left=max(1,min(max_candidates,len(candidates))-idx)
        seconds=max(20.0,min(48.0,remaining/max(1.0,min(2,left))))
        seed=SEEDS[idx%len(SEEDS)]
        row=v4._run_fresh(candidate,seconds,seed)
        attempt_log.append(_attempt_record(f'long-fresh-{target}',candidate.label,seed,target,seconds,row))
        if _valid(row):
            successes.append(row)
            if target>=10:break
    return _best(successes)


def _grow_once(incumbent,all_kits,deadline,attempt_log):
    used={str(k.get('kitId') or '') for k in incumbent['candidate'].kits}
    extras=sorted([k for k in all_kits if str(k.get('kitId') or '') not in used],key=v4._extra_rank)[:4]
    plans=v4._blocker_plans(incumbent)
    selected=[p for p in plans if p[1] in ('mixed-2','right-2','large-2','mixed-3','right-3','large-3')] or plans[:4]
    job=0
    for extra in extras:
        for disturbed,label in selected[:4]:
            remaining=deadline-time.time()
            if remaining<20:return None
            seconds=max(20.0,min(42.0,remaining/2.0)); seed=SEEDS[(job+2)%len(SEEDS)]; job+=1
            row=v4._lns_one(incumbent,extra,disturbed,label,seconds,seed)
            attempt_log.append(_attempt_record('long-warm-grow',label,seed,len(incumbent['candidate'].kits)+1,seconds,row))
            if _valid(row):return row
    return None


def revolutionary_solve(prepared_kits,total_seconds=240.0,max_workers=1,stop_at_commercial=False):
    started=time.time(); deadline=started+max(120.0,float(total_seconds)); attempts=[]
    topo_best,topo_rows=_topology_best(prepared_kits)
    if topo_best and len(topo_best['candidate'].kits)>=10:
        return _row_payload(topo_best,started,attempts,len(topo_rows),early_exit=stop_at_commercial)

    ceiling=min(16,len(prepared_kits)); desired=min(10,ceiling); incumbent=None
    for target in range(desired,max(5,desired-2)-1,-1):
        incumbent=_fresh_long(prepared_kits,target,deadline,attempts,max_candidates=5 if target>=10 else 3)
        if incumbent:break
        if deadline-time.time()<30:break

    if incumbent is None:
        return {'ok':False,'engine':ENGINE,'error':'No certified layout found in low-CPU long-run search',
          'attempts':attempts,'runtimeWorkers':1,'elapsedSeconds':round(time.time()-started,2)}

    if stop_at_commercial and len(incumbent['candidate'].kits)>=10:
        return _row_payload(incumbent,started,attempts,len(topo_rows),early_exit=True)

    best=incumbent
    while len(best['candidate'].kits)<ceiling and deadline-time.time()>=24:
        grown=_grow_once(best,prepared_kits,deadline,attempts)
        if not grown:break
        best=grown
        if len(best['candidate'].kits)>=12:break
    return _row_payload(best,started,attempts,len(topo_rows),early_exit=False)
