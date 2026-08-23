"""Laboratorio limpio Sparrow: prioridad por ocupación real, sin mínimo artificial."""
from flask import Flask, jsonify, request
from flask_cors import CORS
import nest_sparrow as core
import time, uuid

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
BUILD = "clean-lab-v2-area-first-2026-08-23"


def _identity():
    return {"module": core.__name__, "name": "area_first_clean_solver"}


@app.get('/health')
def health():
    return jsonify(ok=True, build=BUILD, mode='clean-sparrow-area-first', solver=_identity(),
                   historicalRuntimesLoaded=False)


@app.get('/runtime-info')
def runtime_info():
    return jsonify(ok=True, build=BUILD, mode='clean-sparrow-area-first', solver=_identity(),
                   historicalRuntimesLoaded=False, widthCm=122, heightCm=58, gapMm=3.0,
                   minimumCompleteFigures=None, scoring='density-first')


def _score(result, selected):
    # Primero ocupación geométrica real; luego cantidad; luego compactación horizontal.
    return (float(result.get('density') or 0), len(selected), -float(result.get('stripWidthMm') or 1e18))


@app.post('/solve')
def solve():
    data = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()

    width_mm = 1220.0
    height_mm = 580.0
    gap_mm = 3.0
    raw = sorted(data.get('kits') or [], key=lambda k: (core._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:32]
    if not raw:
        return jsonify(ok=False, error='No llegaron figuras al laboratorio', traceId=trace_id), 400

    kits, rejected = [], []
    for k in raw:
        try:
            kits.append(core._prep_kit(k, width_mm, height_mm))
        except Exception as exc:
            rejected.append({'kitId': str(k.get('kitId') or ''), 'figure': str(k.get('figure') or ''), 'reason': str(exc)})

    if not kits:
        return jsonify(ok=False, error='No hay kits geométricos utilizables', rejected=rejected[:10], traceId=trace_id), 422

    attempts = []
    best = None
    # Sin puerta de 10: probar cantidades plausibles y comparar por ocupación real.
    max_target = min(12, len(kits))
    min_target = max(1, min(6, max_target))
    targets = list(range(max_target, min_target - 1, -1))

    # Una variante fuerte por cantidad + una segunda si existe. Mantiene presupuesto razonable.
    for target in targets:
        variants = core._candidate_selections(kits, target)
        for vidx, (label, selected) in enumerate(variants[:2]):
            seconds = 16 if vidx == 0 else 12
            seed = 1009 + target * 97 + vidx * 211
            result = core._run_sparrow(selected, gap_mm, seconds, seed, continuous=(vidx == 1))
            attempts.append({
                'target': target, 'label': label, 'fits': bool(result.get('fits')),
                'density': round(float(result.get('density') or 0), 2),
                'stripWidthMm': result.get('stripWidthMm'), 'seed': seed,
                'rotation': 'continua' if vidx == 1 else '15°', 'error': result.get('error')
            })
            if result.get('ok') and result.get('fits'):
                sc = _score(result, selected)
                if best is None or sc > best[0]:
                    best = (sc, selected, label, result, seed)

    if best is None:
        return jsonify(ok=False, error='Sparrow limpio no encontró una placa válida en este conjunto',
                       build=BUILD, traceId=trace_id, attempts=attempts, rejected=rejected[:10],
                       elapsedSeconds=round(time.time()-started, 2)), 422

    _, selected, label, result, seed = best
    return jsonify(
        ok=True, build=BUILD, traceId=trace_id, engine='Sparrow clean area-first',
        historicalRuntimesLoaded=False, completeFigures=len(selected), placements=result.get('placements') or [],
        density=float(result.get('density') or 0), stripWidthMm=result.get('stripWidthMm'),
        solverDensity=result.get('solverDensity'), gapMm=3.0, widthCm=122, heightCm=58,
        selectionStrategy=label, seed=seed, scoring='density-first', noArtificialMinimum=True,
        attempts=attempts, rejected=rejected[:10], elapsedSeconds=round(time.time()-started, 2)
    )
