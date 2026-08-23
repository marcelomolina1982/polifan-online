"""TVT Revolutionary Ensemble V10.5 — adaptive proven portfolio, laboratory only.

Policy:
- Keep independently certified workshop topologies (pure Mama 12/12).
- Classify the incoming plate as homogeneous/low-diversity or mixed/high-diversity.
- Homogeneous plates use V6 (historically strongest on repeated-shape stress).
- Mixed plates use V4 beam/LNS (historically certified the real mixed plate at 11).
- If the primary path fails early, use the remaining budget on the alternate path.
- Expand the deterministic seed portfolio for more layout diversity without touching
  production code or Vercel.

Every accepted layout still passes the independent >=3 mm certificate with zero
collisions and zero outside-plate pieces.
"""
from __future__ import annotations

import re
import time

from revolutionary import ensemble_v4 as v4
from revolutionary import ensemble_v6 as v6
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Ensemble V10.5-adaptive-portfolio'
EXPANDED_SEEDS=(41,429,1701,7919,31337,65537,104729,130363,196613,262147,393241,524309)


def _best_certified(rows):
    good=[r for r in (rows or []) if r and r.get('certified')]
    return sorted(good,key=v4._score,reverse=True)[0] if good else None


def _norm_name(k):
    s=str(k.get('figure') or k.get('name') or k.get('kitId') or '').lower()
    s=re.sub(r'\b(auto|fixture|kit|pieza|manual)\b',' ',s)
    s=re.sub(r'\d+',' ',s)
    s=re.sub(r'[^a-záéíóúüñ]+',' ',s)
    return ' '.join(s.split())[:80]


def _shape_signature(k):
    # Coarse geometric fingerprint. It is intentionally tolerant: repeated copies
    # with different ids should still count as the same family.
    parts=k.get('parts') or []
    dims=[]
    for p in parts:
        g=p.get('geom')
        try:
            minx,miny,maxx,maxy=g.bounds
            dims.append((round(maxx-minx,-1),round(maxy-miny,-1)))
        except Exception:
            dims.append((0,0))
    return tuple(sorted(dims))


def _classify(kits):
    n=max(1,len(kits))
    names=[_norm_name(k) for k in kits]
    sigs=[_shape_signature(k) for k in kits]
    unique_names=len(set(names))
    unique_shapes=len(set(sigs))
    name_ratio=unique_names/n
    shape_ratio=unique_shapes/n
    homogeneous=(unique_shapes<=2 or shape_ratio<=0.28 or unique_names<=2 or name_ratio<=0.22)
    return {
        'kind':'homogeneous' if homogeneous else 'mixed',
        'kitCount':len(kits),'uniqueNames':unique_names,'uniqueShapes':unique_shapes,
        'nameDiversity':round(name_ratio,3),'shapeDiversity':round(shape_ratio,3),
    }


def _topology_result(best,topo,started,classification):
    r=best.get('result') or {};cert=best.get('certificate') or {};count=len(best['candidate'].kits)
    return {
        'ok':True,'engine':ENGINE,'completeFigures':count,
        'commercialTarget':v4.COMMERCIAL_TARGET,'probablePracticalMaximum':count,
        'selectionStrategy':best['candidate'].label,'incumbentSource':'workshop-topology',
        'seed':best.get('seed'),'density':float(r.get('density') or 0.0),
        'stripWidthMm':float(r.get('stripWidthMm') or 0.0),'placements':r.get('placements') or [],
        'productionCertificate':cert,'minimumGapMm':cert.get('minimumGapMmCertified'),
        'requiredGapMm':v4.MIN_GAP_MM,'targetDensityReached':float(r.get('density') or 0)>=v4.TARGET_DENSITY,
        'workshopTopologyTried':len(topo),'workshopTopologyCertified':sum(1 for x in topo if x.get('certified')),
        'climbHistory':[count],'attempts':[{'phase':'workshop-topology','label':best['candidate'].label,
          'target':count,'certified':True,'gapMm':cert.get('minimumGapMmCertified'),
          'collisionCount':cert.get('collisionCount'),'outsidePlateCount':cert.get('outsidePlateCount')}],
        'classification':classification,
        'searchPhilosophy':'certified topology -> adaptive proven engine routing -> alternate fallback if primary fails early',
        'elapsedSeconds':round(time.time()-started,2),
    }


def _decorate(result,classification,route,topo,started):
    out=dict(result)
    out['engine']=ENGINE
    out['incumbentSource']=route
    out['classification']=classification
    out['workshopTopologyTried']=len(topo)
    out['workshopTopologyCertified']=sum(1 for x in topo if x.get('certified'))
    out['searchPhilosophy']='certified topology -> adaptive proven engine routing -> alternate fallback if primary fails early'
    out['elapsedSeconds']=round(time.time()-started,2)
    climb=list(out.get('climbHistory') or [])
    if not climb:
        for a in out.get('attempts') or []:
            if a.get('certified'):
                try:n=int(a.get('target') or 0)
                except Exception:n=0
                if n and (not climb or climb[-1]!=n):climb.append(n)
    final=int(out.get('completeFigures') or 0)
    if final and (not climb or climb[-1]!=final):climb.append(final)
    out['climbHistory']=climb
    return out


def _better(a,b):
    def score(x):
        if not x or not x.get('ok'):return (-1,-1,-1)
        return (int(x.get('completeFigures') or 0),float(x.get('minimumGapMm') or 0),float(x.get('density') or 0))
    return a if score(a)>=score(b) else b


def revolutionary_solve_v8(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(60.0,float(total_seconds));deadline=started+budget
    # Broaden search diversity only inside this laboratory engine.
    v4.SEEDS=EXPANDED_SEEDS

    classification=_classify(prepared_kits)
    topo=workshop_seeds(prepared_kits)
    topo_best=_best_certified(topo)
    if topo_best and len(topo_best['candidate'].kits)>=v4.COMMERCIAL_TARGET:
        return _topology_result(topo_best,topo,started,classification)

    homogeneous=classification['kind']=='homogeneous'
    primary_name='v6-homogeneous' if homogeneous else 'v4-mixed'
    # Reserve only a small rescue window. The proven primary gets most of the budget.
    primary_budget=max(55.0,budget*0.86)
    if homogeneous:
        primary=v6.revolutionary_solve_v6(prepared_kits,total_seconds=primary_budget,max_workers=max_workers)
    else:
        primary=v4.revolutionary_solve(prepared_kits,total_seconds=primary_budget,max_workers=max_workers)

    best=_decorate(primary,classification,primary_name,topo,started)
    remaining=deadline-time.time()

    # Fallback is only for an early primary failure or a weak result (< commercial target).
    weak=(not primary.get('ok') or int(primary.get('completeFigures') or 0)<v4.COMMERCIAL_TARGET)
    if weak and remaining>=38.0:
        if homogeneous:
            alt=v4.revolutionary_solve(prepared_kits,total_seconds=remaining,max_workers=max_workers)
            alt=_decorate(alt,classification,'v4-fallback',topo,started)
        else:
            alt=v6.revolutionary_solve_v6(prepared_kits,total_seconds=remaining,max_workers=max_workers)
            alt=_decorate(alt,classification,'v6-fallback',topo,started)
        best=_better(best,alt)
        best['portfolioFallbackTried']=True
    else:
        best['portfolioFallbackTried']=False

    best['seedPortfolioSize']=len(EXPANDED_SEEDS)
    best['seedPortfolio']=list(EXPANDED_SEEDS)
    return best
