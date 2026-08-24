"""Best-effort v3: cola amplia, varias pasadas y relleno hasta que no entre nada mas."""
from flask import jsonify, request
import time, uuid

from clean_lab_app import (
    app, core, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, PLATE_AREA_MM2,
    GAP_MM, _metrics, _attempt, _best_same_set, _material_area,
)

BUILD = "best-effort-multipass-v3-full-queue-2026-08-24"
DEFAULT_BUDGET_SECONDS = 150
MAX_POOL_V3 = 120


def _rank_remaining(selected, kits):
    used = {k.get('kitId') for k in selected}
    remain = [k for k in kits if k.get('kitId') not in used]
    if not remain:
        return []

    # Mezcla deliberadamente urgencia, piezas grandes, compactas y chicas.
    # Las chicas son clave para rellenar huecos que una heuristica por area ignora.
    orders = [
        sorted(remain, key=lambda k: (k.get('priority', 999999), -k.get('area', 0))),
        sorted(remain, key=lambda k: (-k.get('area', 0), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (k.get('envelope', 1e18), -k.get('solidity', 0), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (-k.get('solidity', 0), k.get('envelope', 1e18), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (k.get('area', 1e18), k.get('priority', 999999))),
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
    # Gana el candidato que agrega mas material real; prioridad y compactacion desempatan.
    return (
        _material_area(selected) + float(cand.get('area') or 0),
        -float(cand.get('priority') or 999999),
        float(cand.get('solidity') or 0),
        -float(result.get('stripWidthMm') or 1e18),
        float(result.get('solverDensity') or 0),
    )


def _try_add_round(selected, kits, attempts, started, budget, fill_round, continuous=False, limit=16):
    ranked = _rank_remaining(selected, kits)
    if not ranked:
        return None

    fitted = []
    for idx, cand in enumerate(ranked[:limit]):
        remaining = budget - (time.time() - started)
        reserve = 18 if continuous else 24
        if remaining < reserve:
            break
        rows = selected + [cand]
        seed = (6203 if continuous else 3001) + fill_round * 601 + idx * 97 + len(rows) * 31
        seconds = 6 if continuous else (3 if idx < 10 else 4)
        seconds = min(seconds, max(3, int(remaining - reserve + 4)))
        result = core._run_sparrow(rows, GAP_MM, seconds, seed, continuous=continuous)
        _attempt(
            attempts,
            'continuous-fill' if continuous else 'wide-fill',
            f'agregar:{cand.get("figure")}', rows, result, seed, continuous
        )
        if result.get('ok') and result.get('fits'):
            fitted.append((_score_candidate(selected, cand, result), cand, result))

    if not fitted:
        return None
    fitted.sort(key=lambda x: x[0], reverse=True)
    return fitted[0][1], fitted[0][2]


def solve_v3():
    data = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()
    budget = max(45, min(210, int(data.get('budgetSeconds') or DEFAULT_BUDGET_SECONDS)))
    anchor_requested = max(1, min(12, int(data.get('urgentAnchorCount') or 6)))

    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (core._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:MAX_POOL_V3]
    if not raw:
        return jsonify(ok=False, error='No llegaron figuras al motor', traceId=trace_id), 400

    kits, rejected = [], []
    for k in raw:
        try:
            kits.append(core._prep_kit(k, PLATE_WIDTH_MM, PLATE_HEIGHT_MM))
        except Exception as exc:
            rejected.append({'kitId': str(k.get('kitId') or ''), 'figure': str(k.get('figure') or ''), 'reason': str(exc)})

    if not kits:
        return jsonify(ok=False, error='No hay geometria SVG utilizable', traceId=trace_id, rejected=rejected[:16]), 422

    attempts = []
    selected = None
    best_result = None
    anchor_kept = 0

    # PASS 1: conservar el mayor bloque urgente que realmente entra.
    for count in range(min(anchor_requested, len(kits)), 0, -1):
        if time.time() - started > budget - 28:
            break
        rows = kits[:count]
        seed = 1409 + count * 109
        result = core._run_sparrow(rows, GAP_MM, 7, seed, continuous=False)
        _attempt(attempts, 'urgent-anchor', f'top-{count}', rows, result, seed, False)
        if result.get('ok') and result.get('fits'):
            selected, best_result, anchor_kept = list(rows), result, count
            break

    if selected is None:
        for idx, row in enumerate(kits[:16]):
            if time.time() - started > budget - 20:
                break
            seed = 1901 + idx * 61
            result = core._run_sparrow([row], GAP_MM, 4, seed, continuous=False)
            _attempt(attempts, 'single-fallback', str(row.get('figure') or ''), [row], result, seed, False)
            if result.get('ok') and result.get('fits'):
                selected, best_result = [row], result
                anchor_kept = 1 if idx == 0 else 0
                break

    if selected is None:
        return jsonify(ok=False, error='No se pudo colocar ninguna pieza valida', build=BUILD, traceId=trace_id,
                       rejected=rejected[:16], attempts=attempts, elapsedSeconds=round(time.time()-started, 2)), 422

    # PASS 2: varias rondas rapidas por TODA la cola priorizada/diversificada.
    fill_round = 0
    while time.time() - started < budget - 28:
        winner = _try_add_round(selected, kits, attempts, started, budget, fill_round, continuous=False, limit=16)
        if winner is None:
            break
        cand, result = winner
        selected.append(cand)
        best_result = result
        fill_round += 1

    # PASS 3: si la pasada de 15 grados se estanca, rescate con rotacion continua.
    # Si entra una pieza, volvemos a intentar relleno rapido; no hacemos un unico rescate.
    rescue_rounds = 0
    while time.time() - started < budget - 18:
        winner = _try_add_round(selected, kits, attempts, started, budget, fill_round + rescue_rounds, continuous=True, limit=10)
        if winner is None:
            break
        cand, result = winner
        selected.append(cand)
        best_result = result
        rescue_rounds += 1

        if time.time() - started < budget - 25:
            quick = _try_add_round(selected, kits, attempts, started, budget, fill_round + rescue_rounds + 50, continuous=False, limit=10)
            if quick is not None:
                cand2, result2 = quick
                selected.append(cand2)
                best_result = result2
                fill_round += 1

    # PASS 4: compactacion final del conjunto elegido.
    for idx, seed in enumerate((8111, 10903, 13217)):
        remaining = budget - (time.time() - started)
        if remaining < 7:
            break
        seconds = min(14, max(5, int(remaining - 2)))
        result = core._run_sparrow(selected, GAP_MM, seconds, seed + idx * 19, continuous=True)
        _attempt(attempts, 'final-refine', 'mismo-conjunto', selected, result, seed + idx * 19, True)
        best_result = _best_same_set(best_result, result)

    m = _metrics(selected, best_result)
    return jsonify(
        ok=True,
        build=BUILD,
        traceId=trace_id,
        engine='Sparrow best-effort multipass v3 full queue',
        completeFigures=len(selected),
        placements=best_result.get('placements') or [],
        selectedKitIds=[k.get('kitId') for k in selected],
        urgentAnchorsRequested=anchor_requested,
        urgentAnchorsKept=anchor_kept,
        candidatePool=len(kits),
        rawPoolConsidered=len(raw),
        maxPool=MAX_POOL_V3,
        gapMm=GAP_MM,
        widthCm=122,
        heightCm=58,
        minimumCompleteFigures=None,
        minimumDensity=None,
        noArtificialMinimum=True,
        bestEffort=True,
        budgetSeconds=budget,
        fillRounds=fill_round,
        rescueRounds=rescue_rounds,
        stoppedBecause='no-more-fit-or-time-budget',
        rejected=rejected[:16],
        rejectedCount=len(rejected),
        attempts=attempts,
        elapsedSeconds=round(time.time()-started, 2),
        **m,
    )


@app.post('/solve-v3')
def solve_v3_route():
    return solve_v3()
