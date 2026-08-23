"""TVT Revolutionary Ensemble V10.6 — competitive portfolio, laboratory only.

No pre-classification. Proven solvers compete on the same plate and the best
independently certified result wins. Pure Mama keeps its certified 12 topology.
Production/Vercel remain untouched.
"""
from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Ensemble V10.6-competitive-portfolio'
SEED_BANKS=(
    (41,429,1701,7919,31337,65537),
    (104729,130363,196613,262147,393241,524309),
    (17,97,257,1021,4099,16381),
)


def _best_topology(rows):
    good=[r for r in (rows or []) if r and r.get('certified')]
    return sorted(good,key=v4._score,reverse=True)[0] if good else None


def _valid_result(x):
    if not x or not x.get('ok'): return False
    cert=x.get('productionCertificate') or {}
    try: gap=float(x.get('minimumGapMm') or cert.get('minimumGapMmCertified') or 0)
    except Exception: gap=0
    collisions=int(cert.get('collisionCount') or 0)
    outside=int(cert.get('outsidePlateCount') or 0)
    return gap>=v4.MIN_GAP_MM and collisions==0 and outside==0 and int(x.get('completeFigures') or 0)>0


def _score_result(x):
    if not _valid_result(x): return (-1,-1,-1)
    return (int(x.get('completeFigures') or 0),float(x.get('density') or 0),float(x.get('minimumGapMm') or 0))


def _topology_out(best,topo,started):
    r=best.get('result') or {}; cert=best.get('certificate') or {}; n=len(best['candidate'].kits)
    return {'ok':True,'engine':ENGINE,'completeFigures':n,'commercialTarget':v4.COMMERCIAL_TARGET,
      'probablePracticalMaximum':n,'selectionStrategy':best['candidate'].label,'incumbentSource':'workshop-topology',
      'seed':best.get('seed'),'density':float(r.get('density') or 0),'stripWidthMm':float(r.get('stripWidthMm') or 0),
      'placements':r.get('placements') or [],'productionCertificate':cert,
      'minimumGapMm':cert.get('minimumGapMmCertified'),'requiredGapMm':v4.MIN_GAP_MM,
      'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),
      'climbHistory':[n],'portfolioCandidates':[{'engine':'workshop-topology','completeFigures':n,'certified':True}],
      'elapsedSeconds':round(time.time()-started,2)}


def _run_v4(kits,seconds,seeds,label):
    old=v4.SEEDS
    try:
        v4.SEEDS=tuple(seeds)
        out=v4.revolutionary_solve(kits,total_seconds=seconds,max_workers=2)
    finally:
        v4.SEEDS=old
    out=dict(out); out['_portfolioLabel']=label
    return out


def _run_v6(kits,seconds,seeds,label):
    old=v4.SEEDS
    try:
        v4.SEEDS=tuple(seeds)
        out=v6.revolutionary_solve_v6(kits,total_seconds=seconds,max_workers=2)
    finally:
        v4.SEEDS=old
    out=dict(out); out['_portfolioLabel']=label
    return out


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time(); budget=max(60.0,float(total_seconds))
    topo=workshop_seeds(prepared_kits); tb=_best_topology(topo)
    if tb and len(tb['candidate'].kits)>=v4.COMMERCIAL_TARGET:
        return _topology_out(tb,topo,started)

    # Three independent proven searches. Parallel execution prevents one unlucky
    # route from consuming the whole plate budget. Each gets a meaningful window.
    per=max(55.0,min(115.0,budget*0.72))
    jobs=[
      ('v4-a',_run_v4,SEED_BANKS[0]),
      ('v4-b',_run_v4,SEED_BANKS[1]),
      ('v6-c',_run_v6,SEED_BANKS[2]),
    ]
    results=[]
    with ThreadPoolExecutor(max_workers=3) as pool:
        futs={pool.submit(fn,prepared_kits,per,seeds,label):label for label,fn,seeds in jobs}
        for fut in as_completed(futs):
            try: results.append(fut.result())
            except Exception as exc: results.append({'ok':False,'error':str(exc),'_portfolioLabel':futs[fut]})

    valid=[r for r in results if _valid_result(r)]
    if not valid:
        return {'ok':False,'engine':ENGINE,'error':'No competitive portfolio candidate certified',
          'portfolioCandidates':[{'engine':r.get('_portfolioLabel'),'ok':r.get('ok'),'error':r.get('error')} for r in results],
          'elapsedSeconds':round(time.time()-started,2)}
    best=max(valid,key=_score_result)
    out=dict(best); out['engine']=ENGINE; out['incumbentSource']=best.get('_portfolioLabel')
    out['workshopTopologyTried']=len(topo); out['workshopTopologyCertified']=sum(1 for x in topo if x.get('certified'))
    out['portfolioCandidates']=[{'engine':r.get('_portfolioLabel'),'ok':bool(r.get('ok')),
      'certified':_valid_result(r),'completeFigures':int(r.get('completeFigures') or 0),
      'gapMm':r.get('minimumGapMm'),'density':r.get('density'),'elapsedSeconds':r.get('elapsedSeconds')} for r in results]
    out['searchPhilosophy']='race multiple proven solvers; keep best independently certified plate'
    out['elapsedSeconds']=round(time.time()-started,2)
    return out
