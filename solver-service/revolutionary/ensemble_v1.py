"""TVT Revolutionary Ensemble V1.

Experimental only. This module is intentionally NOT wired into production.
It reuses Sparrow/Jagua geometry but replaces the layered decision logic with
one count-first ensemble.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from itertools import combinations
import time

import nest_sparrow as ns

MIN_COMPLETE = 10
MAX_COMPLETE = 16
MIN_GAP_MM = 3.0
TARGET_DENSITY = 70.0
SEEDS = (41, 429, 1701, 7919, 31337, 65537, 104729, 130363)


@dataclass
class Candidate:
    label: str
    kits: list


def _key(k):
    return str(k.get('kitId') or '')


def _priority(k):
    return float(k.get('priority') or 999999)


def _compact(k):
    env = max(1.0, float(k.get('envelope') or 1.0))
    area = max(1.0, float(k.get('area') or 1.0))
    solidity = max(0.01, float(k.get('solidity') or area / env))
    return (env / solidity, -area, _priority(k))


def _area(k):
    return (-float(k.get('area') or 0.0), -float(k.get('solidity') or 0.0), _priority(k))


def _mixed(k):
    env = max(1.0, float(k.get('envelope') or 1.0))
    area = max(1.0, float(k.get('area') or 1.0))
    waste = max(0.0, env - area)
    return (waste / area, env, -area, _priority(k))


def _unique(rows):
    out = []
    seen = set()
    for row in rows:
        kid = _key(row)
        if not kid or kid in seen:
            continue
        seen.add(kid)
        out.append(row)
    return out


def _priority_boundary(kits, target):
    ordered = sorted(kits, key=lambda k: (_priority(k), str(k.get('date') or ''), _key(k)))
    if len(ordered) < target:
        return [], []
    p = _priority(ordered[target - 1])
    mandatory = [k for k in ordered if _priority(k) < p]
    frontier = [k for k in ordered if _priority(k) == p]
    return mandatory, frontier


def candidate_portfolios(kits, target, limit=28):
    """Create diverse portfolios without violating stricter priorities."""
    mandatory, frontier = _priority_boundary(kits, target)
    slots = target - len(mandatory)
    if slots < 0 or len(frontier) < slots:
        return []

    outputs = []
    seen = set()

    def add(label, chosen):
        rows = _unique(mandatory + list(chosen))
        if len(rows) != target:
            return
        sig = tuple(sorted(_key(k) for k in rows))
        if sig in seen:
            return
        seen.add(sig)
        outputs.append(Candidate(label, rows))

    orderings = (
        ('priority', frontier),
        ('compact', sorted(frontier, key=_compact)),
        ('area', sorted(frontier, key=_area)),
        ('mixed', sorted(frontier, key=_mixed)),
    )
    for label, source in orderings:
        add(label, source[:slots])
        max_off = min(10, max(0, len(source) - slots))
        for off in range(1, max_off + 1):
            add(f'{label}-window-{off}', source[off:off + slots])
            if len(outputs) >= limit:
                return outputs[:limit]

    # Small combinational neighbourhood around the best compact frontier.
    compact = sorted(frontier, key=_compact)
    if slots >= 2:
        fixed = compact[:max(0, slots - 2)]
        tail = compact[max(0, slots - 2):max(0, slots - 2) + 10]
        for idx, pair in enumerate(combinations(tail, 2)):
            add(f'compact-pair-{idx}', fixed + list(pair))
            if len(outputs) >= limit:
                break
    return outputs[:limit]


def solution_score(selected, result):
    """Lexicographic TVT objective: complete count first."""
    count = len(selected)
    density = float((result or {}).get('density') or 0.0)
    width = float((result or {}).get('stripWidthMm') or 1e18)
    seconds = float((result or {}).get('elapsedSeconds') or 1e18)
    return (count, density, -width, -seconds)


def certified(selected, result):
    if not result or not result.get('ok') or not result.get('fits'):
        return False, {}
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator is None:
        return False, {'reason': 'certifier unavailable'}
    valid, cert = validator(selected, result)
    gap = cert.get('minimumGapMmCertified')
    return bool(valid and gap is not None and float(gap) >= MIN_GAP_MM), cert


def _run_one(candidate, seconds, seed):
    result = ns._run_sparrow(candidate.kits, MIN_GAP_MM, seconds, seed, continuous=True)
    ok, cert = certified(candidate.kits, result)
    return {
        'candidate': candidate,
        'seed': seed,
        'result': result,
        'certified': ok,
        'certificate': cert,
    }


def run_level(kits, target, seconds_per_run=9.0, max_portfolios=12, max_workers=4):
    portfolios = candidate_portfolios(kits, target, max_portfolios)
    jobs = []
    for idx, candidate in enumerate(portfolios):
        # Two seed families per portfolio are enough for the first fast pass.
        jobs.append((candidate, SEEDS[(idx * 2) % len(SEEDS)]))
        jobs.append((candidate, SEEDS[(idx * 2 + 1) % len(SEEDS)]))

    best = None
    attempts = []
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        future_map = {pool.submit(_run_one, c, seconds_per_run, seed): (c, seed) for c, seed in jobs}
        for fut in as_completed(future_map):
            row = fut.result()
            c = row['candidate']
            r = row['result'] or {}
            attempts.append({
                'label': c.label,
                'seed': row['seed'],
                'target': target,
                'certified': row['certified'],
                'density': round(float(r.get('density') or 0.0), 2),
                'stripWidthMm': round(float(r.get('stripWidthMm') or 0.0), 2),
                'elapsedSeconds': r.get('elapsedSeconds'),
                'gapMm': row['certificate'].get('minimumGapMmCertified'),
            })
            if not row['certified']:
                continue
            if best is None or solution_score(c.kits, r) > solution_score(best['candidate'].kits, best['result']):
                best = row
    return best, attempts


def revolutionary_solve(prepared_kits, total_seconds=150.0, max_workers=4):
    """Fast MVP ensemble.

    Guarantees a certified base-10 before attempting 11+. A failed higher level
    never destroys the best lower solution.
    """
    started = time.time()
    all_attempts = []
    best = None

    for target in range(MIN_COMPLETE, min(MAX_COMPLETE, len(prepared_kits)) + 1):
        remaining = total_seconds - (time.time() - started)
        if remaining < 8:
            break
        if target == 10:
            per_run, portfolios = 8.0, 12
        elif target == 11:
            per_run, portfolios = 10.0, 14
        elif target == 12:
            per_run, portfolios = 9.0, 12
        else:
            per_run, portfolios = 7.0, 8

        level, attempts = run_level(
            prepared_kits,
            target,
            seconds_per_run=min(per_run, max(3.0, remaining / max(4, max_workers))),
            max_portfolios=portfolios,
            max_workers=max_workers,
        )
        all_attempts.extend(attempts)

        if level is None:
            # No valid target N: retain N-1 and stop increasing count.
            break
        if best is None or solution_score(level['candidate'].kits, level['result']) > solution_score(best['candidate'].kits, best['result']):
            best = level

    if best is None:
        return {'ok': False, 'error': 'No certified base-10', 'attempts': all_attempts}

    result = dict(best['result'])
    return {
        'ok': True,
        'engine': 'TVT Revolutionary Ensemble V1',
        'completeFigures': len(best['candidate'].kits),
        'selectionStrategy': best['candidate'].label,
        'seed': best['seed'],
        'density': float(result.get('density') or 0.0),
        'stripWidthMm': float(result.get('stripWidthMm') or 0.0),
        'placements': result.get('placements') or [],
        'productionCertificate': best['certificate'],
        'minimumGapMm': best['certificate'].get('minimumGapMmCertified'),
        'requiredGapMm': MIN_GAP_MM,
        'targetDensityReached': float(result.get('density') or 0.0) >= TARGET_DENSITY,
        'attempts': all_attempts,
        'elapsedSeconds': round(time.time() - started, 2),
    }
