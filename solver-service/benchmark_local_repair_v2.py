# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# INTENTO 2/3: el intento largo confirmó que Sparrow converge cerca de 1258 mm.
# Ahora usamos el mismo presupuesto en búsquedas independientes para explorar
# órdenes/rotaciones diferentes, sin contaminar el dato con reparaciones posteriores.
import time
import benchmark_local_repair_v7  # conserva dependencias/rutas del laboratorio


def _row(br, kits, result, seed, seconds):
    placements = result.get('placements') or []
    m = br._metrics(kits, result) if result.get('stripWidthMm') else {}
    return {
        'seed': seed,
        'rotation': 'continua',
        'seconds': seconds,
        'phase': 'sparrow-diversified-search',
        'fits': bool(result.get('fits')),
        'placementCount': len(placements),
        'repairEligible': False,
        'stripWidthMm': m.get('stripWidthMm'),
        'stripWidthUsagePct': m.get('stripWidthUsagePct'),
        'geometricOccupancyPct': m.get('geometricOccupancyPct'),
        'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
        'error': result.get('error'),
    }


def run_exact_with_repair(kits, budget=190):
    import benchmark_routes as br
    started = time.time(); attempts = []
    expected = sum(len(k.get('parts') or []) for k in kits)
    best = None

    # Intento 1 mostró que 90 s sobre una misma trayectoria no supera el plateau.
    # Cinco reinicios dan cinco poblaciones/órdenes distintos y conservan rotación
    # continua. Se reserva margen para serialización/validación del benchmark.
    schedule = [(2713, 35), (6151, 35), (1777, 35), (10429, 35), (23801, 35)]
    for seed, requested in schedule:
        remaining = float(budget) - (time.time() - started)
        if remaining < 22: break
        seconds = min(requested, max(18, int(remaining - 5)))
        result = br.core._run_sparrow(kits, br.GAP_MM, seconds, seed, continuous=True)
        attempts.append(_row(br, kits, result, seed, seconds))
        placements = result.get('placements') or []
        if len(placements) != expected: continue
        if best is None or float(result.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18): best = result
        if result.get('fits'): return result, attempts, round(time.time()-started,2)

    if best is not None:
        attempts.append({
            'seed': None, 'rotation':'diversified-best', 'seconds':0,
            'phase':'attempt-2-summary', 'fits':bool(best.get('fits')),
            'placementCount':len(best.get('placements') or []), 'repairEligible':False,
            'stripWidthMm':round(float(best.get('stripWidthMm') or 0),3), 'error':None,
            'diagnostic':{
                'strategy':'five-independent-continuous-searches',
                'postRepairDisabled':True,
                'targetWidthMm':1230.0,
                'remainingMm':round(max(0.0,float(best.get('stripWidthMm') or 0)-1230.0),3)
            }
        })
    return None, attempts, round(time.time()-started,2)


import benchmark_async_v6  # noqa: F401,E402

__all__ = ['run_exact_with_repair']
