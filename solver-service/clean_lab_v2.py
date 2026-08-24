"""Best-effort v2: prioriza urgentes y busca relleno en toda la cola, no solo 4 candidatos."""
from flask import jsonify, request
import time, uuid

from clean_lab_app import (
    app, core, BUILD as BASE_BUILD, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, PLATE_AREA_MM2,
    GAP_MM, MAX_POOL, _metrics, _attempt, _best_same_set, _material_area,
)

BUILD = "best-effort-multipass-v2-wide-fill-2026-08-23"
DEFAULT_BUDGET_SECONDS = 105


def _rank_remaining(selected, kits):
    used = {k.get('kitId') for k in selected}
    remain = [k for k in kits if k.get('kitId') not in used]
    if not remain:
        return []
    # Intercalamos cuatro criterios para no perder piezas chicas que calzan en huecos.
    orders = [
        sorted(remain, key=lambda k: (k.get('priority', 999999), -k.get('area', 0))),
        sorted(remain, key=lambda k: (-k.get('area', 0), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (k.get('envelope', 1e18), -k.get('solidity', 0), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (-k.get('solidity', 0), k.get('envelope', 1e18), k.get('priority', 999999))),
    ]
    out, seen = [], set()
    i = 0
    while True:
        added = False
        for rows in orders:
            if i < len(rows):
                k = rows[i]
                kid = k.get('kitId')
                if kid not in seen:
                    seen.add(kid)
                    out.append(k)
                added = True
        if not added:
            break
        i += 1
    return out


def _score_candidate(selected, cand, result):
    # Material real primero; prioridad y compactacion desempatan.
    return (
        _material_area(selected) + float(cand.get('area') or 0),
        -float(cand.get('priority') or 999999),
        -float(result.get('stripWidthMm') or 1e18),
        float(result.get('solverDensity') or 0),
    )


def solve_v2():
    data = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()
    budget = max(35, min(150, int(data.get('budgetSeconds') or DEFAULT_BUDGET_SECONDS)))
    anchor_requested = max(1, min(10, int(data.get('urgentAnchorCount') or 6)))

    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (core._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:MAX_POOL]
    if not raw:
        return jsonify(ok=False, error='No llegaron figuras al motor', traceId=trace_id), 400

    kits, rejected = [], []
    for k in raw:
        try:
            kits.append(core._prep_kit(k, PLATE_WIDTH_MM, PLATE_HEIGHT_MM))
        except Exception as exc:
            rejected.append({'kitId': str(k.get('kitId') or ''), 'figure': str(k.get('figure') or ''), 'reason': str(exc)})
    if not kits:
        return jsonify(ok=False, error='No hay geometria SVG utilizable', traceId=trace_id, rejected=rejected[:12]), 422

    attempts = []
    selected = None
    best_result = None
    anchor_kept = 0

    # PASS 1 — mantener el mayor bloque urgente posible.
    for count in range(min(anchor_requested, len(kits)), 0, -1):
        if time.time() - started > budget - 20:
            break
        rows = kits[:count]
        seed = 1201 + count * 101
        result = core._run_sparrow(rows, GAP_MM, 6, seed, continuous=False)
        _attempt(attempts, 'urgent-anchor', f'top-{count}', rows, result, seed, False)
        if result.get('ok') and result.get('fits'):
            selected, best_result, anchor_kept = list(rows), result, count
            break

    # Si el bloque urgente falla, buscamos la primera pieza individual valida.
    if selected is None:
        for idx, row in enumerate(kits[:12]):
            if time.time() - started > budget - 15:
                break
            seed = 1801 + idx * 59
            result = core._run_sparrow([row], GAP_MM, 4, seed, continuous=False)
            _attempt(attempts, 'single-fallback', str(row.get('figure') or ''), [row], result, seed, False)
            if result.get('ok') and result.get('fits'):
                selected, best_result = [row], result
                anchor_kept = 1 if idx == 0 else 0
                break
    if selected is None:
        return jsonify(ok=False, error='No se pudo colocar ninguna pieza valida', build=BUILD, traceId=trace_id,
                       rejected=rejected[:12], attempts=attempts, elapsedSeconds=round(time.time()-started, 2)), 422

    # PASS 2 — relleno ancho. Recorre candidatos diversos de TODA la cola hasta que
    # una vuelta completa no pueda agregar nada o se termine el presupuesto.
    fill_round = 0
    while time.time() - started < budget - 24:
        ranked = _rank_remaining(selected, kits)
        if not ranked:
            break
        fitted = []
        tested = 0
        # Hasta 12 candidatos por ronda. No abandonamos porque fallen los primeros 4.
        for idx, cand in enumerate(ranked[:12]):
            remaining = budget - (time.time() - started)
            if remaining < 24:
                break
            rows = selected + [cand]
            seed = 2603 + fill_round * 503 + idx * 89 + len(rows) * 23
            seconds = 4 if idx < 8 else 5
            result = core._run_sparrow(rows, GAP_MM, seconds, seed, continuous=False)
            _attempt(attempts, 'wide-fill', f'agregar:{cand.get("figure")}', rows, result, seed, False)
            tested += 1
            if result.get('ok') and result.get('fits'):
                fitted.append((_score_candidate(selected, cand, result), cand, result))
        if not fitted:
            break
        fitted.sort(key=lambda x: x[0], reverse=True)
        _, winner, winner_result = fitted[0]
        selected.append(winner)
        best_result = winner_result
        fill_round += 1

    # PASS 3 — rescate con rotacion continua sobre candidatos que no entraron a 15°.
    if time.time() - started < budget - 16:
        ranked = _rank_remaining(selected, kits)
        for idx, cand in enumerate(ranked[:6]):
            remaining = budget - (time.time() - started)
            if remaining < 14:
                break
            rows = selected + [cand]
            seed = 5209 + idx * 137 + len(rows) * 29
            result = core._run_sparrow(rows, GAP_MM, min(7, max(4, int(remaining-9))), seed, continuous=True)
            _attempt(attempts, 'continuous-rescue', f'agregar:{cand.get("figure")}', rows, result, seed, True)
            if result.get('ok') and result.get('fits'):
                selected.append(cand)
                best_result = result
                # Si entro una, volvemos a dar una mini vuelta de relleno rapido.
                break

    # PASS 4 — compactacion final del mismo conjunto, sin cambiar prioridades.
    for idx, seed in enumerate((8111, 10903, 13217)):
        remaining = budget - (time.time() - started)
        if remaining < 7:
            break
        seconds = min(12, max(5, int(remaining-2)))
        result = core._run_sparrow(selected, GAP_MM, seconds, seed, continuous=True)
        _attempt(attempts, 'final-refine', 'mismo-conjunto', selected, result, seed, True)
        best_result = _best_same_set(best_result, result)

    m = _metrics(selected, best_result)
    return jsonify(
        ok=True, build=BUILD, traceId=trace_id, engine='Sparrow best-effort multipass v2',
        completeFigures=len(selected), placements=best_result.get('placements') or [],
        selectedKitIds=[k.get('kitId') for k in selected], urgentAnchorsRequested=anchor_requested,
        urgentAnchorsKept=anchor_kept, gapMm=GAP_MM, widthCm=122, heightCm=58,
        minimumCompleteFigures=None, minimumDensity=None, noArtificialMinimum=True,
        bestEffort=True, budgetSeconds=budget, fillRounds=fill_round,
        stoppedBecause='no-more-fit-or-time-budget', rejected=rejected[:12], rejectedCount=len(rejected),
        attempts=attempts, elapsedSeconds=round(time.time()-started, 2), **m,
    )


@app.post('/solve-v2')
def solve_v2_route():
    return solve_v2()
