# Compatibilidad del laboratorio: clean_lab_async_app sigue importando este módulo.
# INTENTO 1/3: usar Sparrow como fue diseñado (exploración + compresión) y dejar de
# gastar el presupuesto en reparaciones posteriores de una tira ya mala.
import time
import benchmark_local_repair_v7  # conserva dependencias/rutas del laboratorio


def _row(br, kits, result, seed, seconds):
    placements = result.get('placements') or []
    m = br._metrics(kits, result) if result.get('stripWidthMm') else {}
    return {
        'seed': seed,
        'rotation': 'continua',
        'seconds': seconds,
        'phase': 'sparrow-native-long-compression',
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
    started = time.time()
    attempts = []
    expected = sum(len(k.get('parts') or []) for k in kits)
    best = None

    # Sparrow es un strip-packer: la altura es fija (580) y su objetivo nativo es
    # comprimir el ancho. Las corridas anteriores de 18-24 s cortaban muy pronto
    # esa compresión. Dos corridas largas independientes reducen además la
    # dependencia de una semilla afortunada.
    schedule = [(1777, 92), (10429, 88)]
    for seed, requested in schedule:
        remaining = float(budget) - (time.time() - started)
        if remaining < 24:
            break
        seconds = min(requested, max(20, int(remaining - 5)))
        result = br.core._run_sparrow(kits, br.GAP_MM, seconds, seed, continuous=True)
        row = _row(br, kits, result, seed, seconds)
        attempts.append(row)
        placements = result.get('placements') or []
        if len(placements) != expected:
            continue
        if best is None or float(result.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18):
            best = result
        if result.get('fits'):
            return result, attempts, round(time.time() - started, 2)

    # No hacemos compactación/repack artificial en este intento. Si Sparrow no
    # llega a 1230, devolvemos el mejor ancho observado para decidir el intento 2
    # con un dato limpio y comparable.
    if best is not None:
        attempts.append({
            'seed': None,
            'rotation': 'native-best',
            'seconds': 0,
            'phase': 'attempt-1-summary',
            'fits': bool(best.get('fits')),
            'placementCount': len(best.get('placements') or []),
            'repairEligible': False,
            'stripWidthMm': round(float(best.get('stripWidthMm') or 0), 3),
            'error': None,
            'diagnostic': {'strategy': 'native-long-compression', 'postRepairDisabled': True},
        })
    return None, attempts, round(time.time() - started, 2)


# Registrar las rutas de prueba V6 recién cuando clean_lab_async_app importa este
# wrapper al final de su arranque. En ese momento la app Flask ya existe.
import benchmark_async_v6  # noqa: F401,E402

__all__ = ['run_exact_with_repair']
