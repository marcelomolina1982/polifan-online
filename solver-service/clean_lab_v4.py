"""Best-effort v4: ancla urgentes y rellena la placa por lotes para no gastar el tiempo probando una pieza por corrida."""
from flask import jsonify, request
import time, uuid

from clean_lab_app import (
    app, core, PLATE_WIDTH_MM, PLATE_HEIGHT_MM, GAP_MM,
    _metrics, _attempt, _best_same_set,
)

BUILD = "best-effort-multipass-v4-batch-fill-2026-08-24"
DEFAULT_BUDGET_SECONDS = 180
MAX_POOL_V4 = 120


def _rank_remaining(selected, kits):
    used = {k.get('kitId') for k in selected}
    remain = [k for k in kits if k.get('kitId') not in used]
    if not remain:
        return []
    orders = [
        sorted(remain, key=lambda k: (k.get('priority', 999999), -k.get('area', 0))),
        sorted(remain, key=lambda k: (-k.get('area', 0), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (k.get('envelope', 1e18), -k.get('solidity', 0), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (k.get('area', 1e18), k.get('priority', 999999))),
        sorted(remain, key=lambda k: (-k.get('solidity', 0), k.get('priority', 999999))),
    ]
    out, seen = [], set()
    i = 0
    while True:
        added = False
        for rows in orders:
            if i < len(rows):
                row = rows[i]
                kid = row.get('kitId')
                if kid not in seen:
                    seen.add(kid)
                    out.append(row)
                added = True
        if not added:
            break
        i += 1
    return out


def _attempt_rows(rows, attempts, phase, label, seed, seconds, continuous):
    result = core._run_sparrow(rows, GAP_MM, seconds, seed, continuous=continuous)
    _attempt(attempts, phase, label, rows, result, seed, continuous)
    return result


def solve_v4():
    data = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()
    budget = max(60, min(240, int(data.get('budgetSeconds') or DEFAULT_BUDGET_SECONDS)))
    anchor_requested = max(1, min(16, int(data.get('urgentAnchorCount') or 6)))

    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (core._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:MAX_POOL_V4]
    if not raw:
        return jsonify(ok=False, error='No llegaron figuras al motor', traceId=trace_id), 400

    kits, rejected = [], []
    for k in raw:
        try:
            kits.append(core._prep_kit(k, PLATE_WIDTH_MM, PLATE_HEIGHT_MM))
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''),'figure':str(k.get('figure') or ''),'reason':str(exc)})
    if not kits:
        return jsonify(ok=False, error='No hay geometria SVG utilizable', traceId=trace_id, rejected=rejected[:16]), 422

    attempts = []
    selected = None
    best_result = None
    anchor_kept = 0

    # PASS 1: bloque urgente. No se negocia la prioridad; buscamos el bloque mayor que entra.
    for count in range(min(anchor_requested, len(kits)), 0, -1):
        if time.time() - started > budget - 35:
            break
        rows = kits[:count]
        seed = 1501 + count * 113
        result = _attempt_rows(rows, attempts, 'urgent-anchor', f'top-{count}', seed, 8, False)
        if result.get('ok') and result.get('fits'):
            selected, best_result, anchor_kept = list(rows), result, count
            break

    if selected is None:
        for idx, row in enumerate(kits[:16]):
            if time.time() - started > budget - 25:
                break
            seed = 2101 + idx * 67
            result = _attempt_rows([row], attempts, 'single-fallback', str(row.get('figure') or ''), seed, 4, False)
            if result.get('ok') and result.get('fits'):
                selected, best_result = [row], result
                anchor_kept = 1 if idx == 0 else 0
                break
    if selected is None:
        return jsonify(ok=False,error='No se pudo colocar ninguna pieza valida',build=BUILD,traceId=trace_id,
                       rejected=rejected[:16],attempts=attempts,elapsedSeconds=round(time.time()-started,2)),422

    # PASS 2: crecimiento POR LOTES. Intentar una pieza por corrida desperdiciaba casi todo
    # el presupuesto. Empezamos con grupos grandes y reducimos 8 -> 4 -> 2 -> 1.
    batch_accepts = []
    for batch_size in (8, 4, 2, 1):
        while time.time() - started < budget - 32:
            ranked = _rank_remaining(selected, kits)
            if not ranked:
                break
            batch = ranked[:batch_size]
            if len(batch) < batch_size:
                if batch_size > 1:
                    break
            rows = selected + batch
            remaining = budget - (time.time() - started)
            seconds = min(12 if batch_size >= 4 else 9, max(5, int(remaining - 27)))
            seed = 4001 + len(selected) * 131 + batch_size * 43 + len(attempts) * 17
            result = _attempt_rows(rows, attempts, 'batch-fill', f'+{len(batch)} candidatos', seed, seconds, False)
            if result.get('ok') and result.get('fits'):
                selected.extend(batch)
                best_result = result
                batch_accepts.append(len(batch))
                continue
            break

    # PASS 3: rescate de huecos con rotacion continua, uno por uno, pero solo al final.
    rescue_rounds = 0
    while time.time() - started < budget - 20:
        ranked = _rank_remaining(selected, kits)
        if not ranked:
            break
        accepted = False
        for idx, cand in enumerate(ranked[:10]):
            remaining = budget - (time.time() - started)
            if remaining < 18:
                break
            rows = selected + [cand]
            seconds = min(7, max(4, int(remaining - 14)))
            seed = 7001 + rescue_rounds * 503 + idx * 89 + len(selected) * 29
            result = _attempt_rows(rows, attempts, 'continuous-rescue', f'agregar:{cand.get("figure")}', seed, seconds, True)
            if result.get('ok') and result.get('fits'):
                selected.append(cand)
                best_result = result
                rescue_rounds += 1
                accepted = True
                break
        if not accepted:
            break

    # PASS 4: compactacion del conjunto ganador.
    for idx, seed in enumerate((8111, 10903, 13217)):
        remaining = budget - (time.time() - started)
        if remaining < 7:
            break
        seconds = min(14, max(5, int(remaining - 2)))
        result = _attempt_rows(selected, attempts, 'final-refine', 'mismo-conjunto', seed + idx*19, seconds, True)
        best_result = _best_same_set(best_result, result)

    m = _metrics(selected, best_result)
    return jsonify(
        ok=True, build=BUILD, traceId=trace_id,
        engine='Sparrow best-effort multipass v4 batch fill',
        completeFigures=len(selected), placements=best_result.get('placements') or [],
        selectedKitIds=[k.get('kitId') for k in selected],
        urgentAnchorsRequested=anchor_requested, urgentAnchorsKept=anchor_kept,
        candidatePool=len(kits), rawPoolConsidered=len(raw), maxPool=MAX_POOL_V4,
        gapMm=GAP_MM, widthCm=122, heightCm=58,
        minimumCompleteFigures=None, minimumDensity=None, noArtificialMinimum=True,
        bestEffort=True, budgetSeconds=budget,
        batchAccepts=batch_accepts, batchAdded=sum(batch_accepts), rescueRounds=rescue_rounds,
        stoppedBecause='no-more-fit-or-time-budget',
        rejected=rejected[:16], rejectedCount=len(rejected), attempts=attempts,
        elapsedSeconds=round(time.time()-started, 2), **m,
    )


@app.post('/solve-v4')
def solve_v4_route():
    return solve_v4()