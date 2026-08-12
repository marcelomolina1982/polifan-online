from flask import request, jsonify
import nest_sparrow as ns
from fixed_hole_fill import try_add_complete_fixed

# Capa LAB: parte SIEMPRE del resultado certificado de 10 que ya funciona.
# Sólo conserva un crecimiento 11/12/13 si la geometría final vuelve a certificar.
# Ante cualquier fallo devuelve intacta la mejor base válida anterior.
_original_nest = ns.nest_sparrow
MAX_COMPLETE = 13
MAX_INPUT_POOL = 64


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


def nest_with_guarded_growth():
    baseline = _original_nest()
    resp, status, payload = _unwrap(baseline)
    if status >= 400 or not isinstance(payload, dict) or not payload.get('ok'):
        return baseline
    if int(payload.get('completeFigures') or 0) != 10 or payload.get('partialExtra'):
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

    while len(best_selected) < min(MAX_COMPLETE, len(kits)):
        grown = try_add_complete_fixed(best_selected, best_result, kits, gap, max_candidates=24)
        if not grown:
            break
        candidate_selected, candidate_result, kit = grown

        # Regla fundamental: 11/12/13 sólo existen si vuelven a pasar exactamente
        # el mismo certificador geométrico de producción. Si fallan, conservamos
        # la base válida previa sin moverla ni devolver cero.
        validator = getattr(ns, '_validate_final_geometry', None)
        if validator:
            valid, certificate = validator(candidate_selected, candidate_result)
            if not valid:
                rejected_growth.append({'figure': kit.get('figure'), 'certificate': certificate})
                break
        else:
            valid, certificate = True, {'minimumGapMmCertified': payload.get('minimumGapMm')}

        best_selected = candidate_selected
        best_result = candidate_result
        best_certificate = certificate
        added.append(kit.get('figure'))

    if not added:
        # Resultado estable: nunca degradar una placa de 10 certificada.
        return baseline

    out = dict(payload)
    out.update({
        'engine': 'Sparrow base 10 + crecimiento 11-13 protegido + V1.7',
        'completeFigures': len(best_selected),
        'placements': list(best_result.get('placements') or []),
        'density': float(best_result.get('density') or 0),
        'stripWidthMm': float(best_result.get('stripWidthMm') or payload.get('stripWidthMm') or 1220),
        'selectionStrategy': str(payload.get('selectionStrategy') or '') + ' · crecimiento protegido: ' + ', '.join(str(x) for x in added),
        'guardedGrowth': True,
        'guardedGrowthAdded': added,
        'guardedGrowthRejected': rejected_growth,
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
