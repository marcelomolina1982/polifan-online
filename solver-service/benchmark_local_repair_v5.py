import time
import benchmark_local_repair_v4 as v4


def run_exact_with_repair(kits, budget=245):
    import benchmark_routes as br
    started=time.time(); attempts=[]
    expected=sum(len(k.get('parts') or []) for k in kits)
    best=None

    for seed,seconds in [(1777,28),(2713,26),(6151,26)]:
        remaining=budget-(time.time()-started)
        if remaining<155: break
        result=br.core._run_sparrow(kits,br.GAP_MM,seconds,seed,continuous=False)
        placements=result.get('placements') or []
        m=br._metrics(kits,result) if result.get('stripWidthMm') else {}
        attempts.append({'seed':seed,'rotation':'15deg','seconds':seconds,'phase':'sparrow-v5-discrete','fits':bool(result.get('fits')),'placementCount':len(placements),'repairEligible':len(placements)==expected,'stripWidthMm':m.get('stripWidthMm'),'stripWidthUsagePct':m.get('stripWidthUsagePct'),'geometricOccupancyPct':m.get('geometricOccupancyPct'),'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),'error':result.get('error')})
        if len(placements)==expected:
            if result.get('fits'):
                return result,attempts,round(time.time()-started,2)
            if best is None or float(result.get('stripWidthMm') or 1e18)<float(best.get('stripWidthMm') or 1e18): best=result

    remaining=max(90,int(budget-(time.time()-started)))
    result,v4_attempts,_=v4.run_exact_with_repair(kits,budget=remaining)
    attempts.extend(v4_attempts)
    if result is not None:
        return result,attempts,round(time.time()-started,2)
    return None,attempts,round(time.time()-started,2)


__all__=['run_exact_with_repair']
