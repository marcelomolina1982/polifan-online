"""TVT Revolutionary Ensemble V2.

Laboratory-only nesting ensemble. Production is not wired to this module.
The geometry core stays Sparrow/Jagua; the orchestration is TVT-specific:
complete figures first, real 3 mm certification, geometry-aware portfolios,
and multiple deterministic seeds.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import time

import nest_sparrow as ns
from revolutionary.selector_v2 import portfolios as select_portfolios

MIN_COMPLETE = 10
MAX_COMPLETE = 16
MIN_GAP_MM = 3.0
TARGET_DENSITY = 70.0
SEEDS = (41, 429, 1701, 7919, 31337, 65537, 104729, 130363)


def solution_score(selected, result):
    """Lexicographic TVT objective: complete count dominates everything."""
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


def _attempt_row(row, target):
    c = row['candidate']
    r = row['result'] or {}
    return {
        'label': c.label,
        'seed': row['seed'],
        'target': target,
        'certified': row['certified'],
        'density': round(float(r.get('density') or 0.0), 2),
        'stripWidthMm': round(float(r.get('stripWidthMm') or 0.0), 2),
        'elapsedSeconds': r.get('elapsedSeconds'),
        'gapMm': row['certificate'].get('minimumGapMmCertified'),
        'fits': bool(r.get('fits')),
    }


def run_level(kits, target, deadline, seconds_per_run=8.0, max_portfolios=14, max_workers=4):
    """Race diverse portfolios until the level budget is exhausted.

    We submit in small waves instead of launching the whole combinatorial set at
    once. That lets a successful base-10 return quickly and saves most time for
    the harder 10->11 and 11->12 transitions.
    """
    candidates = select_portfolios(kits, target, max_portfolios)
    if not candidates:
        return None, []

    jobs=[]
    for idx,c in enumerate(candidates):
        jobs.append((c, SEEDS[(idx*2) % len(SEEDS)]))
        jobs.append((c, SEEDS[(idx*2+1) % len(SEEDS)]))

    best=None
    attempts=[]
    wave_size=max_workers*2
    for start in range(0,len(jobs),wave_size):
        remaining=deadline-time.time()
        if remaining < 3.0:
            break
        wave=jobs[start:start+wave_size]
        per=max(2.5,min(seconds_per_run, remaining/max(1,len(wave)/max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            future_map={pool.submit(_run_one,c,per,seed):(c,seed) for c,seed in wave}
            for fut in as_completed(future_map):
                try:
                    row=fut.result()
                except Exception as exc:
                    c,seed=future_map[fut]
                    attempts.append({'label':c.label,'seed':seed,'target':target,'certified':False,'error':str(exc)[:180]})
                    continue
                attempts.append(_attempt_row(row,target))
                if not row['certified']:
                    continue
                if best is None or solution_score(row['candidate'].kits,row['result']) > solution_score(best['candidate'].kits,best['result']):
                    best=row

        # Base 10 is a safety floor, not where we want to spend the budget.
        if target == 10 and best is not None:
            break
        # For higher levels, a very compact certified result is good enough to
        # advance; otherwise keep racing more portfolios within the level budget.
        if best is not None:
            r=best['result'] or {}
            if float(r.get('density') or 0.0) >= 72.0 and float(r.get('stripWidthMm') or 1e18) <= 1180.0:
                break
    return best, attempts


def revolutionary_solve(prepared_kits, total_seconds=150.0, max_workers=4):
    """Count-first progressive ensemble with guaranteed fallback.

    A certified lower solution is never discarded when a higher count fails.
    Target 11 receives the largest budget because that is the recurrent real
    production bottleneck observed in TVT plates.
    """
    started=time.time()
    global_deadline=started+max(30.0,float(total_seconds))
    all_attempts=[]
    best=None
    highest_success=0

    last_target=min(MAX_COMPLETE,len(prepared_kits))
    for target in range(MIN_COMPLETE,last_target+1):
        remaining=global_deadline-time.time()
        if remaining < 5.0:
            break

        if target == 10:
            share=0.20; per_run=6.0; portfolios=16
        elif target == 11:
            share=0.48; per_run=9.0; portfolios=28
        elif target == 12:
            share=0.38; per_run=8.0; portfolios=24
        else:
            share=0.28; per_run=6.0; portfolios=16

        # Every level gets a bounded slice, but unused global time remains
        # available to later levels.
        level_seconds=max(8.0,min(remaining, total_seconds*share))
        level_deadline=min(global_deadline,time.time()+level_seconds)
        level,attempts=run_level(
            prepared_kits,
            target,
            deadline=level_deadline,
            seconds_per_run=per_run,
            max_portfolios=portfolios,
            max_workers=max_workers,
        )
        all_attempts.extend(attempts)

        if level is None:
            # A failed N does not prove N+1 impossible when portfolio selection is
            # heuristic, but once we already have a certified base we spend one
            # rescue level at most instead of burning the whole request.
            if best is None:
                break
            if target > highest_success + 1:
                break
            continue

        highest_success=target
        if best is None or solution_score(level['candidate'].kits,level['result']) > solution_score(best['candidate'].kits,best['result']):
            best=level

    if best is None:
        return {
            'ok':False,
            'engine':'TVT Revolutionary Ensemble V2',
            'error':'No certified base-10',
            'attempts':all_attempts,
            'elapsedSeconds':round(time.time()-started,2),
        }

    result=dict(best['result'])
    cert=best['certificate'] or {}
    return {
        'ok':True,
        'engine':'TVT Revolutionary Ensemble V2',
        'completeFigures':len(best['candidate'].kits),
        'selectionStrategy':best['candidate'].label,
        'seed':best['seed'],
        'density':float(result.get('density') or 0.0),
        'stripWidthMm':float(result.get('stripWidthMm') or 0.0),
        'placements':result.get('placements') or [],
        'productionCertificate':cert,
        'minimumGapMm':cert.get('minimumGapMmCertified'),
        'requiredGapMm':MIN_GAP_MM,
        'targetDensityReached':float(result.get('density') or 0.0) >= TARGET_DENSITY,
        'attempts':all_attempts,
        'elapsedSeconds':round(time.time()-started,2),
    }
