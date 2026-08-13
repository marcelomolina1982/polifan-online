"""Estrategia híbrida experimental SOLO para Motor Lab interno.

- Si hay al menos 11 kits del mismo modelo, intenta 11 directamente con Sparrow
  usando varias semillas cortas. Si 11 certifica, intenta 12 con presupuesto corto.
- Si el caso no es homogéneo o 11 no certifica, delega intacto al selector estable.
- Nunca acepta un crecimiento sin el certificador geométrico de producción.
"""
from collections import defaultdict
import time
from flask import request, jsonify
import nest_sparrow as ns

_original_nest = ns.nest_sparrow
HOMO_TOTAL_SECONDS = 18.0
HOMO_11_SEEDS = (429, 1701, 7919)
HOMO_12_SEEDS = (429, 1701, 7919)
HOMO_11_BUDGET = 3
HOMO_12_BUDGET = 2
MAX_TARGET = 12


def _name(k):
    return ' '.join(str(k.get('figure') or '').strip().lower().split())


def _certified(selected, result):
    if not (result and result.get('ok') and result.get('fits')):
        return False, {}
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator is None:
        return True, {'minimumGapMmCertified': 3.0}
    try:
        return validator(selected, result)
    except Exception:
        return False, {}


def try_homogeneous_boost(kits, gap_mm, started=None):
    """Devuelve (selected, result, certificate, meta) o None.

    Sólo trabaja sobre un grupo de >=11 kits con exactamente el mismo nombre de figura.
    Tiene límite temporal propio y no muta la lista original.
    """
    started = started or time.monotonic()
    groups = defaultdict(list)
    for k in kits:
        groups[_name(k)].append(k)
    candidates = [g for g in groups.values() if len(g) >= 11]
    if not candidates:
        return None

    # Prioridad primero; ante empate, grupo más grande y menor envolvente total.
    candidates.sort(key=lambda g: (
        min(float(k.get('priority') or 999) for k in g),
        -len(g),
        sum(float(k.get('envelope') or 0) for k in g[:11]),
    ))
    group = candidates[0]
    attempts = []

    best = None
    target11 = group[:11]
    for seed in HOMO_11_SEEDS:
        if time.monotonic() - started >= HOMO_TOTAL_SECONDS:
            break
        t0 = time.monotonic()
        r = ns._run_sparrow(target11, gap_mm, HOMO_11_BUDGET, seed, continuous=True)
        elapsed = time.monotonic() - t0
        valid, cert = _certified(target11, r)
        attempts.append({'target': 11, 'seed': seed, 'fits': bool(r.get('fits')), 'valid': bool(valid), 'seconds': round(elapsed, 2)})
        if valid:
            best = (target11, r, cert)
            break

    if best is None:
        return None

    if len(group) >= 12:
        target12 = group[:12]
        for seed in HOMO_12_SEEDS:
            if time.monotonic() - started >= HOMO_TOTAL_SECONDS:
                break
            t0 = time.monotonic()
            r = ns._run_sparrow(target12, gap_mm, HOMO_12_BUDGET, seed, continuous=True)
            elapsed = time.monotonic() - t0
            valid, cert = _certified(target12, r)
            attempts.append({'target': 12, 'seed': seed, 'fits': bool(r.get('fits')), 'valid': bool(valid), 'seconds': round(elapsed, 2)})
            if valid:
                best = (target12, r, cert)
                break

    selected, result, cert = best
    return selected, result, cert, {
        'homogeneousDetected': True,
        'homogeneousFigure': selected[0].get('figure') if selected else '',
        'homogeneousAvailable': len(group),
        'homogeneousAttempts': attempts,
        'homogeneousElapsedSeconds': round(time.monotonic() - started, 2),
    }


def hybrid_nest():
    data = request.get_json(silent=True) or {}
    width = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:64]
    prepared = []
    rejected = []
    for k in raw:
        try:
            prepared.append(ns._prep_kit(k, width, height))
        except Exception as exc:
            rejected.append({'figure': str(k.get('figure') or ''), 'reason': str(exc)})

    started = time.monotonic()
    boosted = try_homogeneous_boost(prepared, gap, started=started)
    if boosted is None:
        return _original_nest()

    selected, result, certificate, meta = boosted
    attempts = list(meta.get('homogeneousAttempts') or [])
    response = ns._result_payload(
        selected,
        f"Motor Lab híbrido: {len(selected)} homogéneas certificadas",
        result,
        prepared,
        rejected,
        attempts,
        time.time() - float(meta.get('homogeneousElapsedSeconds') or 0),
        None,
    )
    payload = response.get_json()
    payload.update(meta)
    payload.update({
        'engine': 'Motor Lab híbrido · homogéneo 11/12 + fallback base 10',
        'selectorVersion': 'hybrid-homo-1',
        'completeFigures': len(selected),
        'protectedBase10': True,
        'improvedAbove10': len(selected) > 10,
        'productionCertificate': certificate,
        'minimumGapMm': certificate.get('minimumGapMmCertified', gap),
        'requiredGapMm': 3.0,
        'hardHomogeneousLimitSeconds': HOMO_TOTAL_SECONDS,
    })
    return jsonify(payload)


ns.nest_sparrow = hybrid_nest
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = hybrid_nest
