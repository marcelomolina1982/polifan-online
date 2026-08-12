"""Motor Polifan V8 — geometry-first NFP, bounded for production."""
from nest_nfp2 import (
    app, _priority, _prep_kit, _add_kit, _signature,
    _used_bounds, _state_score, _placements,
)
from extended_app import _kit_valid_for_plate
from app import _n
from flask import request, jsonify
import time

MIN_COMPLETE = 10
MAX_COMPLETE = 16
# Un motor de producción no puede quedar explorando 15+ minutos.
TOTAL_BUDGET_SECONDS = 90
STATE_BEAM = 12
KIT_CANDIDATES = 12
CERT_EPS_MM = 0.02


def _certify(placed, width_mm, height_mm, gap_mm):
    conflicts = []
    border = []
    min_gap = None
    for i, p in enumerate(placed):
        g = p['geom']
        minx, miny, maxx, maxy = g.bounds
        if minx < -CERT_EPS_MM or miny < -CERT_EPS_MM or maxx > width_mm + CERT_EPS_MM or maxy > height_mm + CERT_EPS_MM:
            border.append(i)
        for j in range(i):
            h = placed[j]['geom']
            d = float(g.distance(h))
            min_gap = d if min_gap is None else min(min_gap, d)
            if g.intersects(h) or d < gap_mm - CERT_EPS_MM:
                conflicts.append({'a': j, 'b': i, 'distanceMm': round(d, 6)})
    return {'ok': not conflicts and not border,
            'gapCertifiedMm': None if min_gap is None else round(min_gap, 6),
            'conflicts': conflicts, 'borderConflicts': border,
            'requiredGapMm': gap_mm}


def _pool(kits):
    # Menos candidatos, pero conservamos tres perfiles: urgentes, grandes y compactos.
    urgent = kits[:18]
    large = sorted(kits, key=lambda k: (-k['area'], k['priority']))[:14]
    compact = sorted(kits, key=lambda k: (k['area'], k['priority']))[:10]
    out, seen = [], set()
    for k in urgent + large + compact:
        if k['kitId'] not in seen:
            seen.add(k['kitId']); out.append(k)
    return out


def _ordered_candidates(pool, used):
    remain = [k for k in pool if k['kitId'] not in used]
    primary = sorted(remain, key=lambda k: (-k['area'], k['priority']))[:KIT_CANDIDATES]
    urgent = sorted(remain, key=lambda k: (k['priority'], -k['area']))[:4]
    compact = sorted(remain, key=lambda k: (k['area'], k['priority']))[:4]
    out, seen = [], set()
    for k in primary + urgent + compact:
        if k['kitId'] not in seen:
            seen.add(k['kitId']); out.append(k)
    return out


def _better(a, b, width_mm, height_mm):
    # Primero cantidad completa; dentro de la misma cantidad usamos score geométrico.
    ca, cb = len(a.get('kits', [])), len(b.get('kits', []))
    if ca != cb:
        return ca > cb
    return _state_score(a, width_mm, height_mm) > _state_score(b, width_mm, height_mm)


@app.get('/nest-v8/health')
def nest_v8_health():
    return jsonify(ok=True, engine='Motor V8 NFP geometry-first', gapPolicy='hard-constraint',
                   minComplete=MIN_COMPLETE, budgetSeconds=TOTAL_BUDGET_SECONDS)


@app.post('/nest-v8')
def nest_v8():
    started = time.time()
    deadline = started + TOTAL_BUDGET_SECONDS
    data = request.get_json(silent=True) or {}
    try:
        width_mm = max(1.0, _n(data.get('widthCm'), 122) * 10)
        height_mm = max(1.0, _n(data.get('heightCm'), 58) * 10)
        gap = max(3.0, _n(data.get('gapCm'), .3) * 10)
        raw = sorted(data.get('kits') or [], key=lambda k: (_priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:40]
        if not raw:
            return jsonify(ok=False, error='No llegaron figuras al Motor V8'), 400

        kits, rejected = [], []
        for k in raw:
            valid, detail = _kit_valid_for_plate(k, width_mm, height_mm)
            if not valid:
                rejected.append({'kitId': str(k.get('kitId') or ''), 'figure': str(k.get('figure') or ''), 'reason': str(detail)})
                continue
            try:
                kits.append(_prep_kit(k))
            except Exception as exc:
                rejected.append({'kitId': str(k.get('kitId') or ''), 'figure': str(k.get('figure') or ''), 'reason': str(exc)})
        if not kits:
            return jsonify(ok=False, error='No hay kits geométricos utilizables', rejected=rejected[:10]), 422

        pool = _pool(kits)
        beam = [{'placed': [], 'kits': [], 'area': 0.0}]
        best = beam[0]
        best_certified = None
        depth = 0
        timed_out = False

        while beam and depth < MAX_COMPLETE:
            if time.time() >= deadline:
                timed_out = True; break
            depth += 1
            nxt = []
            for st in beam:
                if time.time() >= deadline:
                    timed_out = True; break
                used = {k['kitId'] for k in st['kits']}
                for kit in _ordered_candidates(pool, used):
                    if time.time() >= deadline:
                        timed_out = True; break
                    nxt.extend(_add_kit(st, kit, width_mm, height_mm, gap))
            if not nxt:
                break
            uniq = {}
            for st in nxt:
                sig = _signature(st)
                old = uniq.get(sig)
                if old is None or _better(st, old, width_mm, height_mm):
                    uniq[sig] = st
            beam = sorted(uniq.values(), key=lambda s: (len(s['kits']), _state_score(s, width_mm, height_mm)), reverse=True)[:STATE_BEAM]
            if beam and _better(beam[0], best, width_mm, height_mm):
                best = beam[0]
            # En cuanto llegamos a producción, guardamos una solución certificada recuperable.
            if len(best['kits']) >= MIN_COMPLETE:
                c = _certify(best['placed'], width_mm, height_mm, gap)
                if c['ok']:
                    best_certified = best

        # Si la exploración final quedó en un estado peor/no certificable, jamás perdemos
        # la última solución productiva válida encontrada.
        chosen = best_certified or best
        cert = _certify(chosen['placed'], width_mm, height_mm, gap)
        complete = len(chosen['kits'])
        density = 100.0 * chosen['area'] / (width_mm * height_mm)
        ready = complete >= MIN_COMPLETE and cert['ok']
        bb = _used_bounds(chosen['placed'])
        reason = (f'{complete} completas certificadas a {gap:.2f} mm' if ready else
                  f'Mejor parcial: {complete} completas; certificado={cert["ok"]}')
        return jsonify({
            'ok': ready, 'engine': 'Motor V8 NFP geometry-first', 'engineVersion': 'V8.1-fast',
            'completeFigures': complete, 'placements': _placements(chosen), 'density': density,
            'envelopeOccupancy': 0.0 if not chosen['placed'] else 100.0 * ((bb[2]-bb[0])*(bb[3]-bb[1]))/(width_mm*height_mm),
            'usedWidthMm': max(0, bb[2]-bb[0]), 'usedHeightMm': max(0, bb[3]-bb[1]),
            'productionReady': ready, 'reachedMinimum': complete >= MIN_COMPLETE,
            'certification': cert, 'gapMm': gap,
            'selectionStrategy': 'NFP/Minkowski + bounded beam + best-valid preservation',
            'resultReason': reason, 'candidatePool': len(pool),
            'timedOut': timed_out, 'budgetSeconds': TOTAL_BUDGET_SECONDS,
            'rejectedCount': len(rejected), 'rejected': rejected[:10],
            'elapsedSeconds': round(time.time()-started, 2),
        })
    except Exception as exc:
        return jsonify(ok=False, engine='Motor V8 NFP geometry-first', error=str(exc)), 500
