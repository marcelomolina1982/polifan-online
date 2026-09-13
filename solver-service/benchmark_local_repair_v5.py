import time
import benchmark_local_repair_v4 as v4


def _attempt(br, kits, result, seed, seconds, continuous, phase):
    placements=result.get('placements') or []
    m=br._metrics(kits,result) if result.get('stripWidthMm') else {}
    return {
        'seed':seed,
        'rotation':'continua' if continuous else '15deg',
        'seconds':seconds,
        'phase':phase,
        'fits':bool(result.get('fits')),
        'placementCount':len(placements),
        'repairEligible':True,
        'stripWidthMm':m.get('stripWidthMm'),
        'stripWidthUsagePct':m.get('stripWidthUsagePct'),
        'geometricOccupancyPct':m.get('geometricOccupancyPct'),
        'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),
        'error':result.get('error')
    }


def run_exact_with_repair(kits, budget=185):
    import benchmark_routes as br
    started=time.time(); attempts=[]
    expected=sum(len(k.get('parts') or []) for k in kits)
    best=None

    # V5 real: el endpoint del benchmark entrega 185 s, por eso repartimos
    # explícitamente el presupuesto entre semillas discretas, continuas y reparación.
    schedule=[
        (2713,False,18,'sparrow-v5-discrete'),
        (6151,False,18,'sparrow-v5-discrete'),
        (9341,False,18,'sparrow-v5-discrete'),
        (1777,True,24,'sparrow-v5-continuous'),
        (10429,True,22,'sparrow-v5-continuous'),
    ]

    for seed,continuous,seconds,phase in schedule:
        remaining=budget-(time.time()-started)
        # Reservar al menos ~50 s para la compactación global final.
        if remaining < 58:
            break
        seconds=min(seconds,max(10,int(remaining-50)))
        result=br.core._run_sparrow(kits,br.GAP_MM,seconds,seed,continuous=continuous)
        placements=result.get('placements') or []
        row=_attempt(br,kits,result,seed,seconds,continuous,phase)
        row['repairEligible']=len(placements)==expected
        attempts.append(row)
        if len(placements)!=expected:
            continue
        if result.get('fits'):
            return result,attempts,round(time.time()-started,2)
        if best is None or float(result.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18):
            best=result

    if best is None:
        return None,attempts,round(time.time()-started,2)

    remaining=budget-(time.time()-started)
    rs=time.time()
    repaired=v4._global_compact(
        kits,best,br.GAP_MM,br.PLATE_WIDTH_MM,br.PLATE_HEIGHT_MM,
        max(25,int(remaining-2))
    )
    repair_seconds=round(time.time()-rs,2)
    if repaired is not None:
        m=br._metrics(kits,repaired)
        attempts.append({
            'seed':None,
            'rotation':'coordinate-global',
            'seconds':repair_seconds,
            'phase':'global-coordinate-v5',
            'fits':bool(repaired.get('fits')),
            'placementCount':len(repaired.get('placements') or []),
            'repairEligible':True,
            'baseStripWidthMm':round(float(best.get('stripWidthMm') or 0),3),
            'stripWidthMm':m.get('stripWidthMm'),
            'stripWidthUsagePct':m.get('stripWidthUsagePct'),
            'geometricOccupancyPct':m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct':m.get('materialInsideUsedStripPct'),
            'movedPieces':repaired.get('repairMovedPieces'),
            'error':None
        })
        if repaired.get('fits'):
            return repaired,attempts,round(time.time()-started,2)

    return None,attempts,round(time.time()-started,2)


__all__=['run_exact_with_repair']
