"""TVT Revolutionary Ensemble V10.7 — sequential proven portfolio, laboratory only.

Pure Mama keeps the certified 12 topology. For every other plate, proven solvers
run sequentially so each gets the full machine instead of competing for CPU.
The best independently certified result is preserved throughout.
"""
from __future__ import annotations

import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Ensemble V10.7-sequential-portfolio'
SEED_BANKS=(
    (41,429,1701,7919,31337,65537,104729,130363),
    (17,97,257,1021,4099,16381,65539,131071),
)


def _best_topology(rows):
    good=[r for r in (rows or []) if r and r.get('certified')]
    return sorted(good,key=v4._score,reverse=True)[0] if good else None


def _valid(x):
    if not x or not x.get('ok'): return False
    cert=x.get('productionCertificate') or {}
    try: gap=float(x.get('minimumGapMm') or cert.get('minimumGapMmCertified') or 0)
    except Exception: gap=0
    return gap>=v4.MIN_GAP_MM and int(cert.get('collisionCount') or 0)==0 and int(cert.get('outsidePlateCount') or 0)==0 and int(x.get('completeFigures') or 0)>0


def _score(x):
    if not _valid(x): return (-1,-1,-1)
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


def _run_with_seeds(fn,kits,seconds,seeds,label,max_workers=4):
    old=v4.SEEDS
    try:
        v4.SEEDS=tuple(seeds)
        out=fn(kits,total_seconds=seconds,max_workers=max_workers)
    finally:
        v4.SEEDS=old
    out=dict(out); out['_portfolioLabel']=label
    return out


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time(); budget=max(60.0,float(total_seconds)); deadline=started+budget
    topo=workshop_seeds(prepared_kits); tb=_best_topology(topo)
    if tb and len(tb['candidate'].kits)>=v4.COMMERCIAL_TARGET:
        return _topology_out(tb,topo,started)

    results=[]; best=None

    # First route: V4 has repeatedly shown the strongest mixed/Cactus results.
    first_budget=min(max(70.0,budget*0.62),max(70.0,budget-45.0))
    r1=_run_with_seeds(v4.revolutionary_solve,prepared_kits,first_budget,SEED_BANKS[0],'v4-primary',max_workers)
    results.append(r1)
    if _valid(r1): best=r1

    remaining=deadline-time.time()
    # If primary already reaches 11+, preserve it and stop. Otherwise give V6 a
    # meaningful full-CPU rescue window, never replacing a better certified plate.
    if (best is None or int(best.get('completeFigures') or 0)<11) and remaining>=42.0:
        r2=_run_with_seeds(v6.revolutionary_solve_v6,prepared_kits,remaining,SEED_BANKS[1],'v6-rescue',max_workers)
        results.append(r2)
        if _valid(r2) and (best is None or _score(r2)>_score(best)): best=r2

    if best is None:
        return {'ok':False,'engine':ENGINE,'error':'No sequential portfolio candidate certified',
          'portfolioCandidates':[{'engine':r.get('_portfolioLabel'),'ok':bool(r.get('ok')),'error':r.get('error')} for r in results],
          'elapsedSeconds':round(time.time()-started,2)}

    out=dict(best); out['engine']=ENGINE; out['incumbentSource']=best.get('_portfolioLabel')
    out['workshopTopologyTried']=len(topo); out['workshopTopologyCertified']=sum(1 for x in topo if x.get('certified'))
    out['portfolioCandidates']=[{'engine':r.get('_portfolioLabel'),'ok':bool(r.get('ok')),'certified':_valid(r),
      'completeFigures':int(r.get('completeFigures') or 0),'gapMm':r.get('minimumGapMm'),
      'density':r.get('density'),'elapsedSeconds':r.get('elapsedSeconds')} for r in results]
    out['searchPhilosophy']='sequential full-CPU proven solvers; preserve best independently certified plate'
    out['elapsedSeconds']=round(time.time()-started,2)
    return out
