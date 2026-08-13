from flask import request, jsonify
import nest_sparrow as ns
from fixed_hole_fill import try_add_complete_fixed
from local_repair_growth import try_add_complete_local_repair

# Capa LAB: parte SIEMPRE del mejor resultado certificado disponible.
# - Si la estrategia homogénea ya devolvió 11/12, no la toca.
# - Si quedó en 10, primero prueba agregar sin mover nada.
# - Si eso falla, permite un reacomodo LOCAL de 1-2 kits por hasta 12 s.
# Ante cualquier fallo devuelve intacta la mejor base válida anterior.
_original_nest = ns.nest_sparrow
MAX_COMPLETE = 13
MAX_INPUT_POOL = 64
LOCAL_REPAIR_SECONDS = 12.0


def _unwrap(value):
    status = 200
    resp = value
    if isinstance(value, tuple):
        resp = value[0]
        if len(value) > 1 and isinstance(value[1], int):
            status = value[1]
    try:
        data = resp.get_json()
    except Exception:
        data = None
    try:
        status = int(getattr(resp, 'status_code', status) or status)
    except Exception:
        pass
    return resp, status, data


def _selected_from_payload(payload, kits):
    ids = []
    for pl in payload.get('placements') or []:
        kid = str(pl.get('kitId') or '')
        if kid and kid not in ids:
            ids.append(kid)
    by_id = {str(k.get('kitId')): k for k in kits}
    return [by_id[k] for k in ids if k in by_id]


def _validate(selected, result, fallback_gap):
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator:
        return validator(selected, result)
    return True, {'minimumGapMmCertified': fallback_gap}


def _has_prepared_geometry(kits):
    """El reacomodo local necesita las geometrías Shapely ya preparadas.

    Algunos tests unitarios y caminos de compatibilidad usan kits mínimos sin
    `parts`; en esos casos el crecimiento local debe simplemente omitirse y
    devolver la base estable, nunca lanzar una excepción.
    """
    if not kits:
        return False
    for kit in kits:
        parts = kit.get('parts') if isinstance(kit, dict) else None
        if not isinstance(parts, list) or not parts:
            return False
        for part in parts:
            if not isinstance(part, dict) or part.get('geom') is None or not part.get('instanceId'):
                return False
    return True


def nest_with_guarded_growth():
    baseline = _original_nest()
    resp, status, payload = _unwrap(baseline)
    if status >= 400 or not isinstance(payload, dict) or not payload.get('ok'):
        return baseline

    # Si la estrategia homogénea ya consiguió 11/12 certificadas, no gastar tiempo extra.
    complete = int(payload.get('completeFigures') or 0)
    if complete > 10 or payload.get('partialExtra'):
        return baseline
    if complete != 10:
        return baseline

    data = request.get_json(silent=True) or {}
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:MAX_INPUT_POOL]

    kits = []
    for k in raw:
        try:
            kits.append(ns._prep_kit(k, width_mm, height_mm))
        except Exception:
            pass
    if len(kits) < 11:
        return baseline

    selected = _selected_from_payload(payload, kits)
    if len(selected) != 10:
        return baseline

    result = {
        'fits': True,
        'density': float(payload.get('density') or 0),
        'stripWidthMm': float(payload.get('stripWidthMm') or 1220),
        'placements': list(payload.get('placements') or []),
        'solverDensity': payload.get('solverDensity'),
        'continuousRotation': False,
    }

    best_selected = list(selected)
    best_result = dict(result)
    best_certificate = payload.get('productionCertificate') or {}
    added = []
    rejected_growth = []
    local_repair_used = False
    local_repair_removed = []

    # 1) Intento barato: agregar una completa sin mover la base.
    grown = try_add_complete_fixed(best_selected, best_result, kits, gap, max_candidates=24)
    if grown:
        candidate_selected, candidate_result, kit = grown
        valid, certificate = _validate(candidate_selected, candidate_result, payload.get('minimumGapMm'))
        if valid:
            best_selected = candidate_selected
            best_result = candidate_result
            best_certificate = certificate
            added.append(kit.get('figure'))
        else:
            rejected_growth.append({'figure': kit.get('figure'), 'mode': 'fixed', 'certificate': certificate})

    # 2) Si no entró sin mover nada, probar reacomodo LOCAL, nunca recalcular toda la placa.
    # Sólo se habilita cuando TODOS los kits implicados contienen geometría preparada.
    if not added and _has_prepared_geometry(selected) and _has_prepared_geometry(kits):
        repaired = try_add_complete_local_repair(
            selected,
            result,
            kits,
            gap,
            validator=getattr(ns, '_validate_final_geometry', None),
            max_new_candidates=4,
            max_removed_kits=2,
            max_seconds=LOCAL_REPAIR_SECONDS,
        )
        if repaired:
            candidate_selected, candidate_result, kit = repaired
            valid, certificate = _validate(candidate_selected, candidate_result, payload.get('minimumGapMm'))
            if valid:
                best_selected = candidate_selected
                best_result = candidate_result
                best_certificate = certificate
                added.append(kit.get('figure'))
                local_repair_used = True
                local_repair_removed = list(candidate_result.get('localRepairRemoved') or [])
            else:
                rejected_growth.append({'figure': kit.get('figure'), 'mode': 'local-repair', 'certificate': certificate})

    if not added:
        # Resultado estable: nunca degradar una placa de 10 certificada.
        return baseline

    # Sólo después de conseguir 11 permitimos un segundo agregado sin mover la placa nueva.
    if len(best_selected) < min(MAX_COMPLETE, len(kits)):
        grown2 = try_add_complete_fixed(best_selected, best_result, kits, gap, max_candidates=16)
        if grown2:
            candidate_selected, candidate_result, kit = grown2
            valid, certificate = _validate(candidate_selected, candidate_result, payload.get('minimumGapMm'))
            if valid:
                best_selected = candidate_selected
                best_result = candidate_result
                best_certificate = certificate
                added.append(kit.get('figure'))
            else:
                rejected_growth.append({'figure': kit.get('figure'), 'mode': 'fixed-after-11', 'certificate': certificate})

    out = dict(payload)
    mode_text = 'reacomodo local' if local_repair_used else 'relleno fijo'
    out.update({
        'engine': 'Motor Lab híbrido · homogéneo + mixto con crecimiento local protegido',
        'completeFigures': len(best_selected),
        'placements': list(best_result.get('placements') or []),
        'density': float(best_result.get('density') or 0),
        'stripWidthMm': float(best_result.get('stripWidthMm') or payload.get('stripWidthMm') or 1220),
        'selectionStrategy': str(payload.get('selectionStrategy') or '') + ' · crecimiento protegido (' + mode_text + '): ' + ', '.join(str(x) for x in added),
        'guardedGrowth': True,
        'guardedGrowthAdded': added,
        'guardedGrowthRejected': rejected_growth,
        'localRepairGrowth': local_repair_used,
        'localRepairRemoved': local_repair_removed,
        'localRepairHardLimitSeconds': LOCAL_REPAIR_SECONDS,
        'base10Preserved': True,
        'productionCertificate': best_certificate,
        'minimumGapMm': best_certificate.get('minimumGapMmCertified', payload.get('minimumGapMm')),
        'requiredGapMm': 3.0,
        'targetDensityReached': float(best_result.get('density') or 0) >= 75.0,
    })
    return jsonify(out)


ns.nest_sparrow = nest_with_guarded_growth
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = nest_with_guarded_growth
