"""Area-first override for the clean Sparrow lab.

Keeps the exact benchmark namespace hotfix from clean_lab_fixed, but replaces only
/solve selection logic: the winner is the valid candidate with the greatest real
material area. Figure count is only a tiebreaker; strip width compacts equal-area
solutions. No artificial minimum count.
"""
import time, uuid
from flask import jsonify, request
import clean_lab_fixed as fixed
import clean_lab_app as base
import nest_sparrow as core

app = fixed.app


def _area(selected):
    return sum(float(k.get('area') or 0) for k in selected)


def _candidate_pool(kits):
    """Bounded pool across different quantities, ranked by real material area."""
    max_target = min(14, len(kits))
    pool, seen = [], set()
    for target in range(1, max_target + 1):
        for label, selected in core._candidate_selections(kits, target)[:3]:
            key = tuple(sorted(str(k.get('kitId') or '') for k in selected))
            if not key or key in seen:
                continue
            seen.add(key)
            pool.append((float(_area(selected)), len(selected), label, selected))
    # Real occupied material first. Count only breaks equal-area ties.
    pool.sort(key=lambda row: (-row[0], -row[1], row[2]))
    return pool[:18]


def solve_area_first():
    data = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()
    gap_mm = 3.0

    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (core._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:32]
    if not raw:
        return jsonify(ok=False, error='No llegaron figuras al laboratorio', traceId=trace_id), 400

    kits, rejected = [], []
    for k in raw:
        try:
            kits.append(core._prep_kit(k, base.PLATE_WIDTH_MM, base.PLATE_HEIGHT_MM))
        except Exception as exc:
            rejected.append({
                'kitId': str(k.get('kitId') or ''),
                'figure': str(k.get('figure') or ''),
                'reason': str(exc),
            })
    if not kits:
        return jsonify(ok=False, error='No hay kits geométricos utilizables', rejected=rejected[:10], traceId=trace_id), 422

    attempts = []
    feasible = []
    pool = _candidate_pool(kits)

    # Test the most material-rich subsets first, but do not stop at the first fit.
    # A lower-count subset can legitimately win if it occupies more real material.
    for rank, (material_area, count, label, selected) in enumerate(pool):
        runs = [
            (2201 + rank * 157, False, 9),
            (3301 + rank * 211, True, 12),
        ]
        candidate_best = None
        for seed, continuous, seconds in runs:
            result = core._run_sparrow(selected, gap_mm, seconds, seed, continuous=continuous)
            m = base._metrics(selected, result) if result.get('ok') else None
            attempts.append({
                'target': count,
                'label': label,
                'phase': 'area-feasibility',
                'fits': bool(result.get('fits')),
                'seed': seed,
                'rotation': 'continua' if continuous else '15°',
                'geometricOccupancyPct': m.get('geometricOccupancyPct') if m else None,
                'stripWidthMm': m.get('stripWidthMm') if m else result.get('stripWidthMm'),
                'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct') if m else None,
                'error': result.get('error'),
            })
            if result.get('ok') and result.get('fits'):
                score = (-float(result.get('stripWidthMm') or 1e18), float(result.get('solverDensity') or 0))
                if candidate_best is None or score > candidate_best[0]:
                    candidate_best = (score, result, seed, continuous)
        if candidate_best:
            _, result, seed, continuous = candidate_best
            feasible.append((material_area, count, label, selected, result, seed, continuous))

        # Once we already have a valid solution, candidates with materially less area
        # cannot beat it. Allow a tiny 0.05% tolerance for equal-area alternatives.
        if feasible and rank + 1 < len(pool):
            best_area = max(row[0] for row in feasible)
            next_area = pool[rank + 1][0]
            if next_area < best_area * 0.9995:
                break

    if not feasible:
        return jsonify(
            ok=False,
            error='Sparrow limpio no encontró una placa válida en este conjunto',
            build=base.BUILD,
            traceId=trace_id,
            attempts=attempts,
            rejected=rejected[:10],
            elapsedSeconds=round(time.time() - started, 2),
        ), 422

    # AREA FIRST. Count second. For same material/count, choose smaller strip.
    feasible.sort(key=lambda row: (-row[0], -row[1], float(row[4].get('stripWidthMm') or 1e18)))
    material_area, _, label, selected, best_result, best_seed, best_continuous = feasible[0]

    # Refine exactly the winning material set using continuous rotation.
    for seed in (1777, 3911, 5119):
        result = core._run_sparrow(selected, gap_mm, 22, seed, continuous=True)
        m = base._metrics(selected, result) if result.get('ok') else None
        attempts.append({
            'target': len(selected), 'label': label, 'phase': 'continuous-refine',
            'fits': bool(result.get('fits')), 'seed': seed, 'rotation': 'continua',
            'geometricOccupancyPct': m.get('geometricOccupancyPct') if m else None,
            'stripWidthMm': m.get('stripWidthMm') if m else result.get('stripWidthMm'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct') if m else None,
            'error': result.get('error'),
        })
        if result.get('ok') and result.get('fits') and float(result.get('stripWidthMm') or 1e18) < float(best_result.get('stripWidthMm') or 1e18):
            best_result, best_seed, best_continuous = result, seed, True

    metrics = base._metrics(selected, best_result)
    return jsonify(
        ok=True,
        build='clean-lab-v8-true-area-first-2026-08-23',
        traceId=trace_id,
        engine='Sparrow clean TRUE area-first',
        historicalRuntimesLoaded=False,
        completeFigures=len(selected),
        placements=best_result.get('placements') or [],
        geometricOccupancyPct=metrics['geometricOccupancyPct'],
        stripWidthUsagePct=metrics['stripWidthUsagePct'],
        materialInsideUsedStripPct=metrics['materialInsideUsedStripPct'],
        sparrowReportedDensityPct=metrics['sparrowReportedDensityPct'],
        materialAreaMm2=metrics['materialAreaMm2'],
        plateAreaMm2=metrics['plateAreaMm2'],
        stripWidthMm=metrics['stripWidthMm'],
        gapMm=3.0, widthCm=122, heightCm=58,
        selectionStrategy=label,
        seed=best_seed,
        rotation='continua' if best_continuous else '15°',
        scoring='REAL MATERIAL AREA FIRST; figure count second; strip width third',
        noArtificialMinimum=True,
        attempts=attempts,
        rejected=rejected[:10],
        elapsedSeconds=round(time.time() - started, 2),
    )


# clean_lab_app registered endpoint name is "solve"; swap only its view function.
base.app.view_functions['solve'] = solve_area_first
