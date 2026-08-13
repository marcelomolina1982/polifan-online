from flask import request, jsonify
import time
from itertools import combinations
import nest_sparrow as ns

MAX_POOL = 64
BASE_CANDIDATES = 7
ELEVEN_CANDIDATES = 10
BASE_SEARCH_SECONDS = 55.0
TOTAL_LIMIT_SECONDS = 90.0
SEEDS = (429, 41, 1701, 7919, 31337, 7001, 17011)


def _rank(k):
    return (float(k.get('priority') or 9), str(k.get('date') or '9999-12-31'))


def _compact_score(k):
    env = float(k.get('envelope') or 1e18)
    area = max(1.0, float(k.get('area') or 1.0))
    solidity = max(.01, float(k.get('solidity') or .01))
    return env + 0.35 * (env - area) + 15000.0 * (1.0 - solidity)


def _priority_safe_candidates(kits, target, max_candidates):
    if len(kits) < target:
        return []
    ordered = sorted(kits, key=lambda k: (_rank(k), str(k.get('kitId') or '')))
    boundary = _rank(ordered[target - 1])
    mandatory = [k for k in ordered if _rank(k) < boundary]
    frontier = [k for k in ordered if _rank(k) == boundary]
    slots = target - len(mandatory)
    if slots < 0 or len(frontier) < slots:
        return []

    out = []
    seen = set()
    def add(group, label):
        if len(group) != target:
            return
        sig = tuple(sorted(str(k.get('kitId')) for k in group))
        if sig in seen:
            return
        seen.add(sig)
        out.append((label, list(group)))

    add(mandatory + frontier[:slots], f'baseline-{target}')
    scored = sorted(frontier, key=lambda k: (_compact_score(k), str(k.get('kitId') or '')))
    add(mandatory + scored[:slots], f'compact-{target}')

    for off in range(1, min(5, max(1, len(scored) - slots + 1))):
        add(mandatory + scored[off:off + slots], f'window-{target}-{off}')
        if len(out) >= max_candidates:
            return out[:max_candidates]

    vary = min(3, slots)
    anchors = scored[:max(0, slots - vary)]
    tail = scored[max(0, slots - vary):min(len(scored), max(0, slots - vary) + 10)]
    combos = sorted(combinations(tail, vary), key=lambda c: sum(_compact_score(k) for k in c))
    for idx, combo in enumerate(combos[:max_candidates]):
        add(mandatory + anchors + list(combo), f'combo-{target}-{idx}')
        if len(out) >= max_candidates:
            break
    return out[:max_candidates]


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
    for idx, (label, selected) in enumerate(_priority_safe_candidates(kits, 10, BASE_CANDIDATES)):
        remaining = BASE_SEARCH_SECONDS - (time.time() - started)
        if remaining < 5:
            break
        budget = min(7.0, max(2.2, remaining - 1.5))
        result = ns._run_sparrow(selected, gap, budget, SEEDS[idx % len(SEEDS)], continuous=idx >= 2)
        valid, cert = _certified(selected, result)
        attempts.append({'phase': 'fast-base-10', 'variant': label, 'fits': bool(result.get('fits')), 'certified': bool(valid), 'gapMm': cert.get('minimumGapMmCertified'), 'seconds': result.get('elapsedSeconds')})
        if valid:
            base = (selected, result, cert)
            break

    if base is None:
        return jsonify(ok=False, error='FAST-CERT no encontró 10 certificadas dentro del límite corto.', engine='FAST-CERT Smart-4 compatible', attempts=attempts, elapsedSeconds=round(time.time() - started, 1), requiredGapMm=3.0, hardBaseLimitSeconds=BASE_SEARCH_SECONDS), 422

    best_selected, best_result, best_cert = base
    for idx, (label, selected) in enumerate(_priority_safe_candidates(kits, 11, ELEVEN_CANDIDATES)):
        remaining = TOTAL_LIMIT_SECONDS - (time.time() - started)
        if remaining < 4:
            break
        budget = min(3.0, max(2.0, remaining - 1.5))
        result = ns._run_sparrow(selected, gap, budget, 429 + idx * 131, continuous=True)
        valid, cert = _certified(selected, result)
        attempts.append({'phase': 'fast-growth-11', 'variant': label, 'fits': bool(result.get('fits')), 'certified': bool(valid), 'gapMm': cert.get('minimumGapMmCertified'), 'seconds': result.get('elapsedSeconds')})
        if valid:
            best_selected, best_result, best_cert = selected, result, cert
            break

    response = ns._result_payload(best_selected, f'FAST-CERT: {len(best_selected)} completas · prioridad protegida', best_result, kits, rejected, attempts, started, None)
    payload = response.get_json()
    if not isinstance(payload, dict) or not payload.get('ok'):
        return response
    payload.update({'engine': 'FAST-CERT · selector Smart-4 + V1.7', 'selectorVersion': 'fast-cert-1.2-smart4-compatible', 'completeFigures': len(best_selected), 'protectedBase10': True, 'improvedAbove10': len(best_selected) > 10, 'productionCertificate': best_cert, 'minimumGapMm': best_cert.get('minimumGapMmCertified'), 'requiredGapMm': 3.0, 'fastMode': True, 'hardBaseLimitSeconds': BASE_SEARCH_SECONDS, 'hardTotalLimitSeconds': TOTAL_LIMIT_SECONDS, 'elapsedSeconds': round(time.time() - started, 1)})
    return jsonify(payload)


ns.nest_sparrow = fast_certified_nest
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = fast_certified_nest
