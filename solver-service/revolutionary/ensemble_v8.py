"""TVT Revolutionary Ensemble V10.4 — production-candidate portfolio, laboratory only.

Policy:
- If an independently certified workshop topology exists (e.g. pure Mama 12), use it.
- Otherwise use the proven V4 beam/LNS solver with the full case budget.

This deliberately removes experimental layers that regressed Cactus/mixed cases.
Every accepted layout is independently certified: >=3 mm, zero collisions,
zero outside-plate pieces.
"""
from __future__ import annotations

import time

from revolutionary import ensemble_v4 as v4
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Ensemble V10.4-proven-portfolio'


def _best_certified(rows):
    good=[r for r in (rows or []) if r and r.get('certified')]
    return sorted(good,key=v4._score,reverse=True)[0] if good else None


def _topology_result(best,topo,started):
    r=best.get('result') or {}
    cert=best.get('certificate') or {}
    count=len(best['candidate'].kits)
    return {
        'ok':True,'engine':ENGINE,'completeFigures':count,
        'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':count,
        'selectionStrategy':best['candidate'].label,'incumbentSource':'workshop-topology',
        'seed':best.get('seed'),'density':float(r.get('density') or 0.0),
        'stripWidthMm':float(r.get('stripWidthMm') or 0.0),'placements':r.get('placements') or [],
        'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),
        'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,
        'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),
        'climbHistory':[count],'attempts':[{
            'phase':'workshop-topology','label':best['candidate'].label,'target':count,'certified':True,
            'gapMm':cert.get('minimumGapMmCertified'),'collisionCount':cert.get('collisionCount'),
            'outsidePlateCount':cert.get('outsidePlateCount')}],
        'searchPhilosophy':'certified workshop topology first; otherwise proven V4 beam/LNS',
        'elapsedSeconds':round(time.time()-started,2),
    }


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time()
    topo=workshop_seeds(prepared_kits)
    topo_best=_best_certified(topo)

    # A topology is only an immediate winner when it already reaches/exceeds the
    # commercial target. This preserves the proven pure-Mama 12/12 shortcut.
    if topo_best and len(topo_best['candidate'].kits)>=v4.COMMERCIAL_TARGET:
        return _topology_result(topo_best,topo,started)

    # General production path: the earlier V4 solver repeatedly certified
    # Cactus 10, homogeneous 10 and the historical mixed plate at 11.
    base=v4.revolutionary_solve(prepared_kits,total_seconds=float(total_seconds),max_workers=max_workers)
    if not base.get('ok'):
        return {
            'ok':False,'engine':ENGINE,'error':base.get('error') or 'V4 produced no certified layout',
            'attempts':base.get('attempts') or [],'workshopTopologyTried':len(topo),
            'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),
            'elapsedSeconds':round(time.time()-started,2),
        }

    out=dict(base)
    out['engine']=ENGINE
    out['incumbentSource']='v4-proven-beam-lns'
    out['workshopTopologyTried']=len(topo)
    out['workshopTopologyCertified']=sum(1 for x in topo if x.get('certified'))
    out['searchPhilosophy']='certified workshop topology first; otherwise proven V4 beam/LNS'
    out['elapsedSeconds']=round(time.time()-started,2)
    # V4 does not expose climb history; derive the certified endpoints from attempts.
    climb=[]
    for a in out.get('attempts') or []:
        if a.get('certified'):
            try:n=int(a.get('target') or 0)
            except Exception:n=0
            if n and (not climb or climb[-1]!=n):climb.append(n)
    if int(out.get('completeFigures') or 0) and (not climb or climb[-1]!=int(out['completeFigures'])):
        climb.append(int(out['completeFigures']))
    out['climbHistory']=climb
    return out
