from flask import request, jsonify
import time
import nest_sparrow as ns
import intelligent_selector_runtime as smart

MAX_POOL = 64
BASE_CANDIDATES = 4
ELEVEN_CANDIDATES = 3
BASE_BUDGET = 6.0
ELEVEN_BUDGET = 3.0
NOMINAL_LIMIT_SECONDS = 55.0
SEEDS = (429, 1701, 7919, 31337)


def _certified(selected, result):
    if not (result and result.get('ok') and result.get('fits')):
        return False, {}
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator is None:
        return False, {'reason': 'certificador V1.7 no disponible'}
    try:
        valid, cert = validator(selected, result)
    except Exception as exc:
        return False, {'reason': str(exc)}
    gap = cert.get('minimumGapMmCertified')
    if not valid or gap is None or float(gap) < 3.0:
        return False, cert
    return True, cert


def fast_certified_nest():
    started = time.time()
    data = request.get_json(silent=True) or {}
    width = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (
            ns._priority(k),
            str(k.get('date') or ''),
            str(k.get('figure') or '')
        )
    )[:MAX_POOL]

    kits = []
    rejected = []
    for k in raw:
        try:
            kits.append(ns._prep_kit(k, width, height))
        except Exception as exc:
            rejected.append({
                'figure': str(k.get('figure') or ''),
                'reason': str(exc)
            })

    if len(kits) < 10:
        return jsonify(ok=False, error=f'Sólo hay {len(kits)} kits utilizables'), 422

    attempts = []
    base = None
    groups10 = smart._priority_safe_candidates(kits, 10, BASE_CANDIDATES)

    for idx, (label, selected) in enumerate(groups10):
        if time.time() - started >= NOMINAL_LIMIT_SECONDS:
            break

        result = ns._run_sparrow(
            selected,
            gap,
            BASE_BUDGET,
            SEEDS[idx % len(SEEDS)],
            continuous=idx > 0
        )
        valid, cert = _certified(selected, result)
        attempts.append({
            'phase': 'fast-base-10',
            'variant': label,
            'fits': bool(result.get('fits')),
            'certified': bool(valid),
            'gapMm': cert.get('minimumGapMmCertified'),
            'seconds': result.get('elapsedSeconds')
        })
        if valid:
            base = (selected, result, cert)
            break

    if base is None:
        return jsonify(
            ok=False,
            error='FAST-CERT no encontró 10 certificadas en la búsqueda corta.',
            engine='FAST-CERT',
            attempts=attempts,
            elapsedSeconds=round(time.time() - started, 1),
            requiredGapMm=3.0
        ), 422

    best_selected, best_result, best_cert = base
    groups11 = smart._priority_safe_candidates(kits, 11, ELEVEN_CANDIDATES)

    for idx, (label, selected) in enumerate(groups11):
        if time.time() - started >= NOMINAL_LIMIT_SECONDS:
            break

        result = ns._run_sparrow(
            selected,
            gap,
            ELEVEN_BUDGET,
            429 + idx * 127,
            continuous=True
        )
        valid, cert = _certified(selected, result)
        attempts.append({
            'phase': 'fast-growth-11',
            'variant': label,
            'fits': bool(result.get('fits')),
            'certified': bool(valid),
            'gapMm': cert.get('minimumGapMmCertified'),
            'seconds': result.get('elapsedSeconds')
        })
        if valid:
            best_selected = selected
            best_result = result
            best_cert = cert
            break

    response = ns._result_payload(
        best_selected,
        f'FAST-CERT: {len(best_selected)} completas · prioridad protegida',
        best_result,
        kits,
        rejected,
        attempts,
        started,
        None
    )
    payload = response.get_json()
    if not isinstance(payload, dict) or not payload.get('ok'):
        return response

    payload.update({
        'engine': 'FAST-CERT · 10 segura + intento corto de 11',
        'selectorVersion': 'fast-cert-1',
        'completeFigures': len(best_selected),
        'protectedBase10': True,
        'improvedAbove10': len(best_selected) > 10,
        'productionCertificate': best_cert,
        'minimumGapMm': best_cert.get('minimumGapMmCertified'),
        'requiredGapMm': 3.0,
        'fastMode': True,
        'nominalSearchLimitSeconds': NOMINAL_LIMIT_SECONDS,
        'elapsedSeconds': round(time.time() - started, 1),
    })
    return jsonify(payload)


ns.nest_sparrow = fast_certified_nest
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = fast_certified_nest
