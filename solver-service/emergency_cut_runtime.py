from flask import request, jsonify
import time
import nest_sparrow as ns

# EMERGENCIA DE PRODUCCION:
# 1) deja correr intacto el motor historico;
# 2) solo si no logra 10, busca una placa valida menor para NO bloquear el corte.
# No intenta crecimiento 11+, no cambia geometria, no escala piezas.
_original_solver = ns.nest_sparrow
MIN_FALLBACK_SIZE = 6
MAX_FALLBACK_SECONDS = 75
MAX_VARIANTS_PER_SIZE = 4


def _response_parts(value):
    status = 200
    resp = value
    if isinstance(value, tuple):
        resp = value[0]
        if len(value) > 1 and isinstance(value[1], int):
            status = value[1]
    try:
        payload = resp.get_json()
    except Exception:
        payload = None
    try:
        status = int(getattr(resp, 'status_code', status) or status)
    except Exception:
        pass
    return status, payload


def emergency_cut_solver():
    # Primero, exactamente el motor estable existente.
    original_value = _original_solver()
    original_status, original_payload = _response_parts(original_value)
    if original_status < 400 and isinstance(original_payload, dict) and original_payload.get('ok'):
        return original_value

    started = time.time()
    data = request.get_json(silent=True) or {}
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k:(ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:40]

    kits = []
    rejected = []
    for k in raw:
        try:
            kits.append(ns._prep_kit(k, width_mm, height_mm))
        except Exception as exc:
            rejected.append({'kitId':str(k.get('kitId') or ''), 'figure':str(k.get('figure') or ''), 'reason':str(exc)})

    if len(kits) < MIN_FALLBACK_SIZE:
        return original_value

    attempts = []
    max_size = min(9, len(kits))
    for size in range(max_size, MIN_FALLBACK_SIZE - 1, -1):
        variants = []
        seen = set()
        try:
            candidate_rows = ns._candidate_selections(kits, size)
        except Exception:
            candidate_rows = []
        for label, selected in candidate_rows:
            sig = tuple(k.get('kitId') for k in selected)
            if sig in seen:
                continue
            seen.add(sig)
            variants.append((label, selected))
            if len(variants) >= MAX_VARIANTS_PER_SIZE:
                break

        # respaldo simple si el selector no devuelve variantes para ese tamaño
        if not variants and len(kits) >= size:
            variants = [('prioridad directa', kits[:size])]

        for idx, (label, selected) in enumerate(variants):
            remaining = MAX_FALLBACK_SECONDS - (time.time() - started)
            if remaining < 8:
                break
            seconds = max(7, min(16 if size >= 8 else 12, int(remaining - 2)))
            seed = (429, 41, 701, 1701)[idx % 4] + size * 17
            result = ns._run_sparrow(selected, gap, seconds, seed, continuous=False)
            attempts.append({
                'size': size, 'label': label, 'seed': seed,
                'fits': result.get('fits'), 'placedParts': result.get('placedParts'),
                'expectedParts': result.get('expectedParts'),
                'stripWidthMm': result.get('stripWidthMm'),
                'density': round(float(result.get('density') or 0), 1),
            })
            if result.get('ok') and result.get('fits'):
                response = ns._result_payload(selected, f'EMERGENCIA · mejor placa valida de {size}', result, kits, rejected, attempts, started, None)
                payload = response.get_json()
                payload.update({
                    'engine': 'Sparrow emergencia corte · fallback certificado',
                    'emergencyFallback': True,
                    'reachedMinimum': size >= 10,
                    'completeCount': size,
                    'minimumGapMm': gap,
                    'originalFailure': (original_payload or {}).get('error') if isinstance(original_payload, dict) else None,
                    'message': f'Produccion de emergencia: no se lograron 10; se entrega una placa valida de {size} para no bloquear el corte.'
                })
                return jsonify(payload)
        if MAX_FALLBACK_SECONDS - (time.time() - started) < 8:
            break

    # Si tampoco existe una placa menor valida, preservar el diagnostico original.
    return original_value


ns.nest_sparrow = emergency_cut_solver
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = emergency_cut_solver
