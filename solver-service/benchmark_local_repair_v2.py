import time

from benchmark_local_repair import _local_repair


def run_exact_with_repair(kits, budget=185):
    import benchmark_routes as br

    started = time.time()
    attempts = []
    expected = sum(len(k.get('parts') or []) for k in kits)
    best_fit = None
    best_near = None

    # Una sola búsqueda Sparrow suficientemente fuerte. En Render el tiempo real
    # suele ser bastante mayor que el solicitado; así reservamos tiempo real para
    # la reparación local en vez de consumir todo el presupuesto antes de llegar.
    schedule = [
        (1777, True, 32),
    ]

    for seed, continuous, seconds in schedule:
        result = br.core._run_sparrow(kits, br.GAP_MM, seconds, seed, continuous=continuous)
        placements = result.get('placements') or []
        placement_count = len(placements)
        m = br._metrics(kits, result) if result.get('stripWidthMm') else {}
        attempts.append({
            'seed': seed,
            'rotation': 'continua' if continuous else '15deg',
            'seconds': seconds,
            'phase': 'sparrow',
            'fits': bool(result.get('fits')),
            'placementCount': placement_count,
            'repairEligible': placement_count == expected,
            'stripWidthMm': m.get('stripWidthMm'),
            'stripWidthUsagePct': m.get('stripWidthUsagePct'),
            'geometricOccupancyPct': m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
            'error': result.get('error'),
        })

        if placement_count == expected:
            if result.get('fits'):
                if best_fit is None or float(result.get('stripWidthMm') or 1e18) < float(best_fit.get('stripWidthMm') or 1e18):
                    best_fit = result
            else:
                if best_near is None or float(result.get('stripWidthMm') or 1e18) < float(best_near.get('stripWidthMm') or 1e18):
                    best_near = result

    if best_fit is not None:
        return best_fit, attempts, round(time.time() - started, 2)

    if best_near is None:
        attempts.append({
            'seed': None,
            'rotation': 'local-backtracking',
            'seconds': 0,
            'phase': 'local-repair',
            'fits': False,
            'placementCount': 0,
            'repairEligible': False,
            'error': 'Sparrow no devolvió las 26 posiciones necesarias para reparar',
        })
        return None, attempts, round(time.time() - started, 2)

    repair_started = time.time()
    repaired = _local_repair(
        kits,
        best_near,
        br.GAP_MM,
        br.PLATE_WIDTH_MM,
        br.PLATE_HEIGHT_MM,
        seconds=70,
    )
    repair_seconds = round(time.time() - repair_started, 2)

    if repaired is None:
        attempts.append({
            'seed': None,
            'rotation': 'local-backtracking',
            'seconds': repair_seconds,
            'phase': 'local-repair',
            'fits': False,
            'placementCount': expected,
            'repairEligible': True,
            'baseStripWidthMm': round(float(best_near.get('stripWidthMm') or 0), 3),
            'error': 'La reparación local se ejecutó pero no encontró una recolocación válida',
        })
        return None, attempts, round(time.time() - started, 2)

    m = br._metrics(kits, repaired)
    attempts.append({
        'seed': None,
        'rotation': 'local-backtracking',
        'seconds': repair_seconds,
        'phase': 'local-repair',
        'fits': bool(repaired.get('fits')),
        'placementCount': len(repaired.get('placements') or []),
        'repairEligible': True,
        'baseStripWidthMm': round(float(best_near.get('stripWidthMm') or 0), 3),
        'stripWidthMm': m.get('stripWidthMm'),
        'stripWidthUsagePct': m.get('stripWidthUsagePct'),
        'geometricOccupancyPct': m.get('geometricOccupancyPct'),
        'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
        'movedPieces': repaired.get('repairMovedPieces'),
        'error': None,
    })

    if repaired.get('fits'):
        return repaired, attempts, round(time.time() - started, 2)

    return None, attempts, round(time.time() - started, 2)
