from flask import request, jsonify
import time
import nest_sparrow as ns
import intelligent_selector_runtime as smart

# Motor Lab FAST-CERT v2:
# - prioridad/fecha protegidas;
# - busca una base REAL de 10 y exige certificado >=3 mm;
# - si la búsqueda ultracorta falla, amplía candidatos/semillas antes de rendirse;
# - una vez aseguradas 10, prueba 11 sin arriesgar la base;
# - sigue aislado de producción.
MAX_POOL = 64
FAST_BASE_CANDIDATES = 4
RESCUE_BASE_CANDIDATES = 7
ELEVEN_CANDIDATES = 5
FAST_BASE_BUDGET = 6.0
RESCUE_BASE_BUDGET = 8.0
ELEVEN_BUDGET = 3.5
NOMINAL_LIMIT_SECONDS = 82.0
SEEDS = (429, 41, 1701, 7919, 31337, 7001, 17011)


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


def _try_group(selected, gap, budget, seed, continuous, attempts, phase, label):
    result = ns._run_sparrow(selected, gap, budget, seed, continuous=continuous)
    valid, cert = _certified(selected, result)
    attempts.append({
        'phase': phase,
        'variant': label,
        'fits': bool(result.get('fits')) if result else False,
        'certified': bool(valid),
        'gapMm': cert.get('minimumGapMmCertified'),
        'seconds': result.get('elapsedSeconds') if result else None,
        'seed': seed,
        'continuous': bool(continuous),
    })
    return valid, result, cert


def fast_certified_nest():
    started = time.time()
    data = request.get_json(silent=True) or {}
    width = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:MAX_POOL]

    kits = []
    rejected = []
    for k in raw:
        try:
            kits.append(ns._prep_kit(k, width, height))
        except Exception as exc:
            rejected.append({'figure': str(k.get('figure') or ''), 'reason': str(exc)})
    if len(kits) < 10:
        return jsonify(ok=False, error=f'Sólo hay {len(kits)} kits utilizables'), 422

    attempts = []
    base = None
    groups10 = smart._priority_safe_candidates(kits, 10, RESCUE_BASE_CANDIDATES)

    # FASE 1: FAST-CERT corto. Conservamos la velocidad cuando el caso es fácil.
    for idx, (label, selected) in enumerate(groups10[:FAST_BASE_CANDIDATES]):
        if time.time() - started >= NOMINAL_LIMIT_SECONDS:
            break
        valid, result, cert = _try_group(
            selected, gap, FAST_BASE_BUDGET, SEEDS[idx % len(SEEDS)], idx > 0,
            attempts, 'fast-base-10', label
        )
        if valid:
            base = (selected, result, cert)
            break

    # FASE 2: rescate certificado. El fallo de la búsqueda corta NO termina la placa.
    # Recorremos más combinaciones seguras y alternamos rotación discreta/continua.
    if base is None:
        rescue_runs = []
        for idx, (label, selected) in enumerate(groups10):
            rescue_runs.append((label, selected, SEEDS[(idx + 2) % len(SEEDS)], True))
            if idx < 3:
                rescue_runs.append((label + '-15deg', selected, SEEDS[(idx + 4) % len(SEEDS)], False))

        for label, selected, seed, continuous in rescue_runs:
            remaining = NOMINAL_LIMIT_SECONDS - (time.time() - started)
            if remaining < 3.0:
                break
            budget = min(RESCUE_BASE_BUDGET, max(2.5, remaining - 1.0))
            valid, result, cert = _try_group(
                selected, gap, budget, seed, continuous,
                attempts, 'certified-rescue-10', label
            )
            if valid:
                base = (selected, result, cert)
                break

    if base is None:
        return jsonify(
            ok=False,
            error='FAST-CERT no encontró una base de 10 certificada a 3 mm ni después del rescate.',
            engine='Motor Lab FAST-CERT v2',
            attempts=attempts,
            elapsedSeconds=round(time.time()-started, 1),
            requiredGapMm=3.0,
            rescueAttempted=True,
        ), 422

    best_selected, best_result, best_cert = base

    # Con 10 ya certificadas, intentar 11. Si no sale, jamás se pierde la base 10.
    groups11 = smart._priority_safe_candidates(kits, 11, ELEVEN_CANDIDATES)
    for idx, (label, selected) in enumerate(groups11):
        remaining = NOMINAL_LIMIT_SECONDS - (time.time() - started)
        if remaining < 3.0:
            break
        budget = min(ELEVEN_BUDGET, max(2.2, remaining - 1.0))
        valid, result, cert = _try_group(
            selected, gap, budget, 429 + idx * 127, True,
            attempts, 'fast-growth-11', label
        )
        if valid:
            best_selected, best_result, best_cert = selected, result, cert
            break

    response = ns._result_payload(best_selected, f'Motor Lab FAST-CERT v2: {len(best_selected)} completas · prioridad protegida', best_result, kits, rejected, attempts, started, None)
    payload = response.get_json()
    if not isinstance(payload, dict) or not payload.get('ok'):
        return response
    payload.update({
        'engine': 'Motor Lab FAST-CERT v2 · 10 certificadas + rescate + intento de 11',
        'selectorVersion': 'fast-cert-2-rescue',
        'completeFigures': len(best_selected),
        'protectedBase10': True,
        'improvedAbove10': len(best_selected) > 10,
        'productionCertificate': best_cert,
        'minimumGapMm': best_cert.get('minimumGapMmCertified'),
        'requiredGapMm': 3.0,
        'fastMode': True,
        'rescueEnabled': True,
        'nominalSearchLimitSeconds': NOMINAL_LIMIT_SECONDS,
        'elapsedSeconds': round(time.time()-started, 1),
    })
    return jsonify(payload)


ns.nest_sparrow = fast_certified_nest
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = fast_certified_nest
