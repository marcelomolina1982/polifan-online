from flask import request, jsonify
import time
import nest_sparrow as ns

# EMERGENCIA DE PRODUCCION
# Devuelve una placa cortable y segura aunque Sparrow no alcance su objetivo.
# IMPORTANTE: en modo DOBLE x2 no imponemos un minimo artificial de 10 kits:
# buscamos la mayor cantidad de kits COMPLETOS que realmente entre en la placa.
_original_solver = ns.nest_sparrow
EDGE_MM = 3.0
MIN_DIRECT_SIZE = 1
MAX_DIRECT_SIZE = 16
MAX_VARIANTS_PER_SIZE = 12


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
        parts.sort(key=lambda t: (-max(t[5], t[4]), -(t[4]*t[5])))
    elif order_mode == 'width':
        parts.sort(key=lambda t: (-max(t[4], t[5]), -(t[4]*t[5])))
    elif order_mode == 'original':
        parts.sort(key=lambda t: (t[0], t[1]))
    else:
        parts.sort(key=lambda t: (-(t[4]*t[5]), -max(t[4], t[5])))

    x = left
    y = top
    row_h = 0.0
    placements = []
    max_right = left
    max_bottom = top

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
        ty = py
        placements.append({
            'instanceId': part['instanceId'],
            'kitId': part['kitId'],
            'figure': part['figure'],
            'name': part['name'],
            'role': part['role'],
            'xCm': tx / 10.0,
            'yCm': ty / 10.0,
            'angle': angle,
            'trimXCm': part['trimXmm'] / 10.0,
            'trimYCm': part['trimYmm'] / 10.0,
            'partialExtra': False,
        })
        x = px + w + gap
        row_h = max(row_h, h)
        max_right = max(max_right, px + w)
        max_bottom = max(max_bottom, py + h)

    density = ns._selection_density(selected)
    return {
        'ok': True,
        'fits': True,
        'placements': placements,
        'placedParts': len(placements),
        'expectedParts': len(parts),
        'stripWidthMm': max_right,
        'usedHeightMm': max_bottom,
        'density': density,
        'solverDensity': density,
        'continuousRotation': False,
        'elapsedSeconds': 0.0,
    }


def _candidate_variants(kits, size):
    out = []
    seen = set()
    try:
        rows = ns._candidate_selections(kits, size)
    except Exception:
        rows = []
    for label, selected in rows:
        sig = tuple(k.get('kitId') for k in selected)
        if sig in seen:
            continue
        seen.add(sig)
        out.append((label, selected))
        if len(out) >= MAX_VARIANTS_PER_SIZE:
            break

    # Ventanas de prioridad: especialmente importante para DOBLE x2, porque evita
    # que una unica seleccion heuristica invalide toda la placa.
    for off in range(0, min(12, max(1, len(kits)-size+1))):
        selected = kits[off:off+size]
        if len(selected) != size:
            continue
        sig = tuple(k.get('kitId') for k in selected)
        if sig not in seen:
            seen.add(sig)
            out.append((f'ventana prioridad {off}', selected))
    if not out and len(kits) >= size:
        out = [('prioridad directa', kits[:size])]
    return out


def _try_direct_safe_plate():
    started = time.time()
    data = request.get_json(silent=True) or {}
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k:(ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:48]

    kits = []
    rejected = []
    for k in raw:
        try:
            kits.append(ns._prep_kit(k, width_mm, height_mm))
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''), 'figure':str(k.get('figure') or ''), 'reason':str(exc)})

    if not kits:
        return None

    attempts = []
    # Antes estaba clavado en 9. Ahora buscamos de 16 hacia abajo y aceptamos la
    # mejor cantidad FISICAMENTE posible. Esto permite DOBLE x2 de figuras grandes
    # sin bloquear produccion por no alcanzar 10.
    top = min(MAX_DIRECT_SIZE, len(kits))
    for size in range(top, MIN_DIRECT_SIZE - 1, -1):
        for label, selected in _candidate_variants(kits, size):
            for order_mode in ('area', 'height', 'width', 'original'):
                result = _direct_shelf_pack(selected, gap, width_mm, height_mm, order_mode)
                attempts.append({
                    'size': size,
                    'label': f'direct-safe {label} {order_mode}',
                    'fits': result.get('fits'),
                    'placedParts': result.get('placedParts'),
                    'expectedParts': result.get('expectedParts'),
                    'stripWidthMm': result.get('stripWidthMm'),
                    'density': round(float(result.get('density') or 0), 1),
                })
                if result.get('ok') and result.get('fits'):
                    response = ns._result_payload(selected, f'EMERGENCIA DIRECTA SEGURA · {size} completas', result, kits, rejected, attempts, started, None)
                    payload = response.get_json()
                    payload.update({
                        'engine': 'Emergencia directa segura · DOBLE compatible',
                        'emergencyFallback': True,
                        'directSafeFallback': True,
                        'reachedMinimum': size >= 10,
                        'completeCount': size,
                        'completeFigures': size,
                        'minimumGapMm': gap,
                        'message': f'Produccion de emergencia: placa segura de {size} figuras completas.'
                    })
                    return jsonify(payload)
    return None


def emergency_cut_solver():
    direct = _try_direct_safe_plate()
    if direct is not None:
        return direct
    return _original_solver()


ns.nest_sparrow = emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = emergency_cut_solver
