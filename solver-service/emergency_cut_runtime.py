from flask import request, jsonify
import time
import nest_sparrow as ns

# PRODUCCION V1.14 — AREA FIRST SIN MINIMO ARTIFICIAL
# Compara el motor Sparrow normal contra alternativas directas seguras de 1..16
# kits COMPLETOS. Gana la mayor ocupacion real CERTIFICADA de la placa; la
# cantidad de figuras solo desempata. Nunca se aceptan bases/tapas huerfanas.
_original_solver = ns.nest_sparrow
EDGE_MM = 3.0
MIN_DIRECT_SIZE = 1
MAX_DIRECT_SIZE = 16
MAX_VARIANTS_PER_SIZE = 12
DENSITY_EPSILON = 0.05


def _direct_shelf_pack(selected, gap_mm, width_mm, height_mm, order_mode='area'):
    gap = max(3.0, float(gap_mm or 3.0))
    left = EDGE_MM
    top = EDGE_MM
    right = width_mm - EDGE_MM
    bottom = height_mm - EDGE_MM

    parts = []
    for kit_index, kit in enumerate(selected):
        for part_index, part in enumerate(kit.get('parts') or []):
            minx, miny, maxx, maxy = part['geom'].bounds
            w = max(0.1, float(maxx - minx))
            h = max(0.1, float(maxy - miny))
            parts.append((kit_index, part_index, kit, part, w, h))
    if not parts:
        return {'ok': False, 'fits': False, 'error': 'sin piezas'}

    if order_mode == 'height':
        parts.sort(key=lambda t: (-max(t[5], t[4]), -(t[4] * t[5])))
    elif order_mode == 'width':
        parts.sort(key=lambda t: (-max(t[4], t[5]), -(t[4] * t[5])))
    elif order_mode == 'original':
        parts.sort(key=lambda t: (t[0], t[1]))
    else:
        parts.sort(key=lambda t: (-(t[4] * t[5]), -max(t[4], t[5])))

    x, y, row_h = left, top, 0.0
    placements = []
    max_right, max_bottom = left, top

    for _, _, kit, part, w0, h0 in parts:
        candidates = [(0.0, w0, h0)]
        if abs(w0 - h0) > 0.01:
            candidates.append((90.0, h0, w0))
        chosen = None
        for angle, w, h in sorted(candidates, key=lambda q: (q[2], q[1])):
            if x + w <= right + 1e-6 and y + h <= bottom + 1e-6:
                chosen = (angle, w, h, x, y)
                break
        if chosen is None:
            x = left
            y = y + row_h + gap
            row_h = 0.0
            for angle, w, h in sorted(candidates, key=lambda q: (q[2], q[1])):
                if x + w <= right + 1e-6 and y + h <= bottom + 1e-6:
                    chosen = (angle, w, h, x, y)
                    break
        if chosen is None:
            return {'ok': True, 'fits': False, 'placedParts': len(placements), 'expectedParts': len(parts)}

        angle, w, h, px, py = chosen
        tx = px if angle == 0 else px + h0
        placements.append({
            'instanceId': part['instanceId'], 'kitId': part['kitId'],
            'figure': part['figure'], 'name': part['name'], 'role': part['role'],
            'xCm': tx / 10.0, 'yCm': py / 10.0, 'angle': angle,
            'trimXCm': part['trimXmm'] / 10.0, 'trimYCm': part['trimYmm'] / 10.0,
            'partialExtra': False,
        })
        x = px + w + gap
        row_h = max(row_h, h)
        max_right = max(max_right, px + w)
        max_bottom = max(max_bottom, py + h)

    density = ns._selection_density(selected)
    return {
        'ok': True, 'fits': True, 'placements': placements,
        'placedParts': len(placements), 'expectedParts': len(parts),
        'stripWidthMm': max_right, 'usedHeightMm': max_bottom,
        'density': density, 'solverDensity': density,
        'continuousRotation': False, 'elapsedSeconds': 0.0,
    }


def _candidate_variants(kits, size):
    out, seen = [], set()
    try:
        rows = ns._candidate_selections(kits, size)
    except Exception:
        rows = []
    for label, selected in rows:
        sig = tuple(k.get('kitId') for k in selected)
        if sig in seen:
            continue
        seen.add(sig); out.append((label, selected))
        if len(out) >= MAX_VARIANTS_PER_SIZE:
            break
    for off in range(0, min(12, max(1, len(kits) - size + 1))):
        selected = kits[off:off + size]
        if len(selected) != size:
            continue
        sig = tuple(k.get('kitId') for k in selected)
        if sig not in seen:
            seen.add(sig); out.append((f'ventana prioridad {off}', selected))
    if not out and len(kits) >= size:
        out = [('prioridad directa', kits[:size])]
    return out


def _certified(selected, result):
    if not (result and result.get('ok') and result.get('fits')):
        return False, {}
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator is None:
        return False, {'reason': 'certificador no disponible'}
    try:
        valid, cert = validator(selected, result)
    except Exception as exc:
        return False, {'reason': str(exc)}
    required = max(3.0, float(getattr(ns, 'MIN_PRODUCTION_GAP_MM', 3.0)))
    measured = cert.get('minimumGapMmCertified')
    return bool(valid and measured is not None and float(measured) >= required), cert


def _score(density, count, strip_width):
    # Ocupacion real primero. Un margen diminuto evita que ruido numerico gane
    # sobre una placa con mas figuras cuando la densidad es esencialmente igual.
    d = round(float(density or 0.0) / DENSITY_EPSILON) * DENSITY_EPSILON
    return (d, int(count or 0), -float(strip_width or 1e18))


def _parse_response(response):
    status = 200
    obj = response
    if isinstance(response, tuple):
        obj = response[0]
        if len(response) > 1:
            status = int(response[1])
    try:
        payload = obj.get_json() or {}
    except Exception:
        payload = {}
    return obj, status, payload


def _best_direct_safe_plate(kits, rejected, width_mm, height_mm, gap, started):
    attempts = []
    best = None
    top = min(MAX_DIRECT_SIZE, len(kits))

    # No existe barrera de 10. Recorremos todos los conteos y elegimos por AREA.
    for size in range(top, MIN_DIRECT_SIZE - 1, -1):
        for label, selected in _candidate_variants(kits, size):
            for order_mode in ('area', 'height', 'width', 'original'):
                result = _direct_shelf_pack(selected, gap, width_mm, height_mm, order_mode)
                valid, cert = _certified(selected, result)
                attempts.append({
                    'size': size, 'label': f'direct-safe {label} {order_mode}',
                    'fits': result.get('fits'), 'certified': valid,
                    'placedParts': result.get('placedParts'), 'expectedParts': result.get('expectedParts'),
                    'stripWidthMm': result.get('stripWidthMm'),
                    'density': round(float(result.get('density') or 0), 1),
                    'minimumGapMmCertified': cert.get('minimumGapMmCertified'),
                })
                if not valid:
                    continue
                candidate = (selected, result, cert)
                if best is None or _score(result.get('density'), size, result.get('stripWidthMm')) > _score(best[1].get('density'), len(best[0]), best[1].get('stripWidthMm')):
                    best = candidate
    if best is None:
        return None, attempts

    selected, result, cert = best
    response = ns._result_payload(selected, f'AREA FIRST CERTIFICADA · {len(selected)} completas', result, kits, rejected, attempts, started, None)
    payload = response.get_json()
    payload.update({
        'engine': 'Sparrow V1.14 · AREA FIRST certificada · sin minimo artificial',
        'areaFirst': True, 'noArtificialMinimum': True,
        'directSafeCandidate': True, 'protectedBase10': False,
        'reachedMinimum': True, 'completeCount': len(selected), 'completeFigures': len(selected),
        'minimumGapMm': cert.get('minimumGapMmCertified'),
        'optimizationPriority': 'certified-plate-area-first', 'countIsSecondary': True,
        'message': f'Mejor placa certificada por ocupacion: {len(selected)} figuras completas · {float(result.get("density") or 0):.1f}%.'
    })
    return jsonify(payload), attempts


def emergency_cut_solver():
    started = time.time()
    data = request.get_json(silent=True) or {}
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k:(ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:48]

    kits, rejected = [], []
    for k in raw:
        try:
            p = ns._prep_kit(k, width_mm, height_mm)
            p['date'] = str(k.get('date') or '')
            p['sourcePriority'] = k.get('priority')
            kits.append(p)
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''), 'figure':str(k.get('figure') or ''), 'reason':str(exc)})
    if not kits:
        return _original_solver()

    # Sparrow sigue compitiendo: si produce una placa certificada >=10 con mejor
    # ocupacion que las alternativas directas, se conserva. Si 8/9 (o cualquier
    # otro conteo) usa mas placa de forma certificada, gana esa solucion.
    original_obj = None
    original_status = 500
    original_payload = {}
    try:
        original_obj, original_status, original_payload = _parse_response(_original_solver())
    except Exception as exc:
        original_payload = {'ok': False, 'error': str(exc)}

    direct_obj, direct_attempts = _best_direct_safe_plate(kits, rejected, width_mm, height_mm, gap, started)
    direct_payload = direct_obj.get_json() if direct_obj is not None else {}

    original_ok = original_status < 400 and bool(original_payload.get('ok'))
    direct_ok = bool(direct_payload.get('ok'))
    if original_ok and direct_ok:
        oscore = _score(original_payload.get('density'), original_payload.get('completeFigures') or original_payload.get('completeCount'), original_payload.get('stripWidthMm'))
        dscore = _score(direct_payload.get('density'), direct_payload.get('completeFigures'), direct_payload.get('stripWidthMm'))
        if oscore >= dscore:
            original_payload.update({
                'areaFirst': True, 'noArtificialMinimum': True, 'protectedBase10': False,
                'optimizationPriority': 'certified-plate-area-first', 'countIsSecondary': True,
                'areaFirstCrossCheck': {'directBestDensity': direct_payload.get('density'), 'directBestCompleteFigures': direct_payload.get('completeFigures')},
            })
            return jsonify(original_payload), original_status
        return direct_obj
    if direct_ok:
        return direct_obj
    if original_obj is not None:
        return original_obj, original_status
    return jsonify(ok=False, error='No se encontro ninguna placa certificada utilizable.', attempts=direct_attempts), 422


ns.nest_sparrow = emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = emergency_cut_solver
