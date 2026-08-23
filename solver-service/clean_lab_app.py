"""Laboratorio limpio Sparrow: prioridad por ocupación real, sin mínimo artificial."""
from flask import Flask, jsonify, request
from flask_cors import CORS
import nest_sparrow as core
import time, uuid

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})
BUILD = "clean-lab-v3-metrics-2026-08-23"
PLATE_WIDTH_MM = 1220.0
PLATE_HEIGHT_MM = 580.0
PLATE_AREA_MM2 = PLATE_WIDTH_MM * PLATE_HEIGHT_MM


def _identity():
    return {"module": core.__name__, "name": "area_first_clean_solver"}


def _metrics(selected, result):
    material_area = sum(float(k.get('area') or 0) for k in selected)
    geometric_occupancy = 100.0 * material_area / PLATE_AREA_MM2
    strip_width = float(result.get('stripWidthMm') or 0)
    strip_width_usage = 100.0 * strip_width / PLATE_WIDTH_MM if strip_width > 0 else 0.0
    strip_bbox_area = strip_width * PLATE_HEIGHT_MM if strip_width > 0 else 0.0
    material_inside_used_strip = 100.0 * material_area / strip_bbox_area if strip_bbox_area > 0 else 0.0
    return {
        'materialAreaMm2': round(material_area, 2),
        'plateAreaMm2': round(PLATE_AREA_MM2, 2),
        'geometricOccupancyPct': round(geometric_occupancy, 3),
        'stripWidthMm': round(strip_width, 3),
        'stripWidthUsagePct': round(strip_width_usage, 3),
        'materialInsideUsedStripPct': round(material_inside_used_strip, 3),
        'sparrowReportedDensityPct': round(float(result.get('solverDensity') or 0), 3),
    }


@app.get('/health')
def health():
    return jsonify(ok=True, build=BUILD, mode='clean-sparrow-area-first', solver=_identity(),
                   historicalRuntimesLoaded=False)


@app.get('/runtime-info')
def runtime_info():
    return jsonify(ok=True, build=BUILD, mode='clean-sparrow-area-first', solver=_identity(),
                   historicalRuntimesLoaded=False, widthCm=122, heightCm=58, gapMm=3.0,
                   minimumCompleteFigures=None,
                   scoring='geometric-occupancy-first; quantity-second; strip-width-third',
                   metrics=['geometricOccupancyPct','stripWidthUsagePct','materialInsideUsedStripPct','sparrowReportedDensityPct'])


def _score(result, selected):
    m = _metrics(selected, result)
    return (m['geometricOccupancyPct'], len(selected), -float(result.get('stripWidthMm') or 1e18))


@app.post('/solve')
def solve():
    data = request.get_json(silent=True) or {}
    trace_id = uuid.uuid4().hex[:12]
    started = time.time()

    width_mm = PLATE_WIDTH_MM
    height_mm = PLATE_HEIGHT_MM
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
    max_target = min(12, len(kits))
    min_target = max(1, min(6, max_target))
    targets = list(range(max_target, min_target - 1, -1))

    for target in targets:
        variants = core._candidate_selections(kits, target)
        for vidx, (label, selected) in enumerate(variants[:2]):
            seconds = 16 if vidx == 0 else 12
            seed = 1009 + target * 97 + vidx * 211
            result = core._run_sparrow(selected, gap_mm, seconds, seed, continuous=(vidx == 1))
            metrics = _metrics(selected, result) if result.get('ok') else None
            attempts.append({
                'target': target, 'label': label, 'fits': bool(result.get('fits')),
                'geometricOccupancyPct': metrics.get('geometricOccupancyPct') if metrics else None,
                'stripWidthUsagePct': metrics.get('stripWidthUsagePct') if metrics else None,
                'sparrowReportedDensityPct': metrics.get('sparrowReportedDensityPct') if metrics else None,
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
    metrics = _metrics(selected, result)
    return jsonify(
        ok=True, build=BUILD, traceId=trace_id, engine='Sparrow clean area-first',
        historicalRuntimesLoaded=False, completeFigures=len(selected), placements=result.get('placements') or [],
        geometricOccupancyPct=metrics['geometricOccupancyPct'],
        stripWidthUsagePct=metrics['stripWidthUsagePct'],
        materialInsideUsedStripPct=metrics['materialInsideUsedStripPct'],
        sparrowReportedDensityPct=metrics['sparrowReportedDensityPct'],
        materialAreaMm2=metrics['materialAreaMm2'], plateAreaMm2=metrics['plateAreaMm2'],
        stripWidthMm=metrics['stripWidthMm'], gapMm=3.0, widthCm=122, heightCm=58,
        selectionStrategy=label, seed=seed,
        scoring='geometric-occupancy-first; quantity-second; strip-width-third',
        noArtificialMinimum=True, attempts=attempts, rejected=rejected[:10],
        elapsedSeconds=round(time.time()-started, 2)
    )
