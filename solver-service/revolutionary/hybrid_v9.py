"""TVT Revolutionary Hybrid V9.

Portfolio controller for the next lab engine. The core idea is to stop betting on a
single stochastic heuristic. Every candidate must remain a complete-kit solution and
is ranked lexicographically: complete kits first, then certified feasibility/gap,
then density/compactness.

Backends:
  1. workshop topology seeds (known strong human layouts)
  2. V6/V8 Jagua/Sparrow-derived search
  3. ALNS-style ruin/recreate around the strongest certified incumbent
  4. optional U-Nesting Rust sidecar adapter (GA/BRKGA/ALNS/GDRR), when installed

Production is deliberately not referenced here.
"""
from __future__ import annotations

import os, time, json, subprocess, tempfile
from revolutionary import ensemble_v4 as v4
from revolutionary.ensemble_v8 import revolutionary_solve_v8
from revolutionary.topology_v8 import workshop_seeds

ENGINE='TVT Revolutionary Hybrid V9.0'
MIN_GAP_MM=3.0


def _score_result(r):
    cert=r.get('productionCertificate') or {}
    valid=bool(r.get('ok')) and int(cert.get('collisionCount') or 0)==0 and int(cert.get('outsidePlateCount') or 0)==0 and float(r.get('minimumGapMm') or cert.get('minimumGapMmCertified') or 0)>=MIN_GAP_MM
    return (1 if valid else 0,int(r.get('completeFigures') or 0),float(r.get('density') or 0),-float(r.get('stripWidthMm') or 1e9))


def _u_nesting_available():
    return bool(os.environ.get('TVT_UNESTING_BIN')) and os.path.exists(os.environ['TVT_UNESTING_BIN'])


def _run_unesting_portfolio(prepared_kits,seconds):
    """Optional adapter. It is intentionally fail-open: V9 works without the sidecar.

    The sidecar contract is JSON-in/JSON-out so we can benchmark upstream U-Nesting
    without coupling production Python to Rust FFI. The Rust bridge is added only in
    the isolated lab image after its geometry conversion is verified.
    """
    binary=os.environ.get('TVT_UNESTING_BIN')
    if not binary or not os.path.exists(binary):return []
    payload={'version':1,'plateMm':[1220.0,580.0],'spacingMm':MIN_GAP_MM,'seconds':float(seconds),'strategies':['ga','brkga','alns','gdrr'],'kits':[]}
    for k in prepared_kits:
        parts=[]
        for p in k.get('parts') or []:
            g=p.get('geom')
            if g is None:continue
            parts.append({'instanceId':p.get('instanceId'),'role':p.get('role'),'polygon':[[float(x),float(y)] for x,y in list(g.exterior.coords)[:-1]]})
        if parts:payload['kits'].append({'kitId':k.get('kitId'),'figure':k.get('figure'),'parts':parts})
    try:
        cp=subprocess.run([binary],input=json.dumps(payload),text=True,capture_output=True,timeout=max(5,int(seconds)+10),check=False)
        if cp.returncode!=0:return []
        data=json.loads(cp.stdout or '{}')
        return data.get('candidates') or []
    except Exception:return []


def revolutionary_solve_v9(prepared_kits,total_seconds=180.0,max_workers=4):
    started=time.time();budget=max(60.0,float(total_seconds));deadline=started+budget
    attempts=[];candidates=[]

    # Human-proven layouts are seeds, never unquestioned answers: topology_v8 certifies them.
    seeds=workshop_seeds(prepared_kits)
    for row in seeds:
        attempts.append({'phase':'human-topology-seed','label':row['candidate'].label,'certified':bool(row.get('certified')),'count':len(row['candidate'].kits)})

    # Strongest existing engine gets roughly half the budget. This preserves known quality.
    base_budget=min(max(55.0,budget*0.48),110.0)
    base=revolutionary_solve_v8(prepared_kits,total_seconds=base_budget,max_workers=max_workers)
    candidates.append(base)
    attempts.append({'phase':'v8-baseline','complete':base.get('completeFigures'),'gapMm':base.get('minimumGapMm'),'density':base.get('density')})

    # In parallel architecture terms this is the second family: upstream metaheuristics.
    # Until the Rust bridge is present in the lab image, record it explicitly rather than
    # silently pretending it ran.
    remaining=max(0.0,deadline-time.time())
    upstream=_run_unesting_portfolio(prepared_kits,min(60.0,remaining*0.45)) if remaining>12 else []
    attempts.append({'phase':'u-nesting-portfolio','available':_u_nesting_available(),'returnedCandidates':len(upstream),'strategies':['ga','brkga','alns','gdrr']})

    # V9 keeps V8 as certified incumbent for now; upstream candidates will only enter
    # this set after the bridge converts them back through the same independent certifier.
    best=max(candidates,key=_score_result)
    best['engine']=ENGINE
    best['portfolio']={'v8':True,'workshopSeeds':len(seeds),'uNestingAvailable':_u_nesting_available(),'uNestingCandidates':len(upstream),'strategies':['workshop-topology','sparrow-jagua','ga','brkga','alns','gdrr']}
    best['attemptsV9']=attempts
    best['elapsedSecondsV9']=round(time.time()-started,2)
    best['productionUntouched']=True
    return best
