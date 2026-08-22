"""TVT Revolutionary Ensemble V5.0 — progressive foothold + human-style repair.

Laboratory only. This version changes the search philosophy:
1. Do NOT waste most of the budget proving 10 from scratch.
2. Secure a small certified foothold first (6/5/4) and never lose it.
3. Climb N -> N+1, preserving several incumbents.
4. When normal insertion stalls, deliberately free 4-5 blocking figures and
   rebuild that neighborhood (closer to how a human makes room).
5. If local repair stalls, run a same-target fresh rescue race, then continue.
6. Every accepted incumbent is independently certified at >=3 mm.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import time

from revolutionary import ensemble_v4 as v4

ENGINE = 'TVT Revolutionary Ensemble V5.0'
FOOTHOLD_TARGETS = (6, 5, 4)
MAX_COMPLETE = 16


def _attempt(row, target, phase):
    r = row.get('result') or {}
    cert = row.get('certificate') or {}
    return {
        'phase': phase,
        'label': getattr(row.get('candidate'), 'label', ''),
        'seed': row.get('seed'),
        'target': target,
        'certified': bool(row.get('certified')),
        'density': round(float(r.get('density') or 0.0), 2),
        'stripWidthMm': round(float(r.get('stripWidthMm') or 0.0), 2),
        'gapMm': cert.get('minimumGapMmCertified'),
        'fits': bool(r.get('fits')),
        'elapsedSeconds': r.get('elapsedSeconds'),
        'error': str(r.get('error') or '')[:240],
    }


def _broad_blockers(incumbent, n):
    """Choose 4-5 figures that plausibly block a rearrangement.

    Blend right-edge figures and large envelopes instead of just the first N in
    one ranking. This intentionally destroys a larger local neighborhood.
    """
    kits = list(incumbent['candidate'].kits)
    placements = (incumbent.get('result') or {}).get('placements') or []
    by_kit = {}
    for p in placements:
        kid = str(p.get('kitId') or '')
        if kid:
            by_kit.setdefault(kid, []).append(p)

    def right_score(k):
        kid = str(k.get('kitId') or '')
        xs = [float(p.get('xCm') or 0.0) * 10.0 for p in by_kit.get(kid, [])]
        return max(xs) if xs else -1e9

    right = sorted(kits, key=right_score, reverse=True)
    large = sorted(kits, key=lambda k: float(k.get('envelope') or k.get('area') or 0.0), reverse=True)
    chosen = []
    ri = li = 0
    while len(chosen) < min(n, len(kits)):
        source = right if len(chosen) % 2 == 0 else large
        idx = ri if source is right else li
        while idx < len(source):
            kid = str(source[idx].get('kitId') or '')
            idx += 1
            if kid and kid not in chosen:
                chosen.append(kid)
                break
        if source is right:
            ri = idx
        else:
            li = idx
        if ri >= len(right) and li >= len(large):
            break
    return set(chosen)


def broad_lns_grow(beam, all_kits, deadline, max_workers=2):
    attempts, successes, jobs = [], [], []
    seeds = v4.SEEDS
    for bidx, incumbent in enumerate(beam[:v4.BEAM_WIDTH]):
        used = {str(k.get('kitId') or '') for k in incumbent['candidate'].kits}
        extras = sorted([k for k in all_kits if str(k.get('kitId') or '') not in used], key=v4._extra_rank)[:5]
        for eidx, extra in enumerate(extras):
            for n in (4, 5):
                disturbed = _broad_blockers(incumbent, n)
                seed = seeds[(bidx * 11 + eidx * 3 + n) % len(seeds)]
                jobs.append((incumbent, extra, disturbed, f'human-free-{n}', seed))
                if len(jobs) >= 20:
                    break
            if len(jobs) >= 20:
                break
        if len(jobs) >= 20:
            break

    for start in range(0, len(jobs), max_workers):
        remaining = deadline - time.time()
        if remaining < 5.0:
            break
        wave = jobs[start:start + max_workers]
        seconds = max(4.0, min(14.0, remaining / max(1.0, len(wave) / max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(v4._lns_one, inc, extra, disturbed, label, seconds, seed): (inc, extra, label, seed)
                for inc, extra, disturbed, label, seed in wave
            }
            for fut in as_completed(futures):
                inc, extra, label, seed = futures[fut]
                target = len(inc['candidate'].kits) + 1
                try:
                    row = fut.result()
                except Exception as exc:
                    attempts.append({'phase':'broad-lns','label':label,'seed':seed,'target':target,'certified':False,'error':str(exc)[:240]})
                    continue
                attempts.append(_attempt(row, target, 'broad-lns'))
                if row.get('certified'):
                    successes.append(row)
        if v4._unique_beam(successes):
            # Once a certified larger-neighborhood solution exists, preserve time
            # for the next climb instead of exhausting every job.
            break
    return v4._unique_beam(successes), attempts


def _find_foothold(kits, deadline, max_workers, attempts):
    max_available = len(kits)
    targets = [t for t in FOOTHOLD_TARGETS if t <= max_available]
    if not targets and max_available:
        targets = [max_available]
    for target in targets:
        remaining = deadline - time.time()
        if remaining < 5.0:
            break
        local_deadline = min(deadline, time.time() + min(18.0, remaining))
        beam, rows = v4.fresh_beam(
            kits, target, local_deadline,
            max_workers=max(1, min(2, max_workers)),
            portfolios=12,
            per_run=5.0,
            phase=f'foothold-{target}',
        )
        attempts.extend(rows)
        if beam:
            return beam, target
        attempts.append({'phase':'foothold-fallback','target':target,'certified':False,'reason':'no foothold; trying smaller count'})
    return [], 0


def revolutionary_solve_v5(prepared_kits, total_seconds=150.0, max_workers=4):
    started = time.time()
    budget = max(45.0, float(total_seconds))
    deadline = started + budget
    attempts = []

    # Phase A — secure something real quickly instead of gambling the budget on 10.
    foothold_deadline = min(deadline, started + min(34.0, budget * 0.28))
    beam, count = _find_foothold(prepared_kits, foothold_deadline, max_workers, attempts)
    if not beam:
        return {
            'ok': False, 'engine': ENGINE,
            'error': 'No certified foothold found',
            'attempts': attempts,
            'elapsedSeconds': round(time.time()-started, 2),
        }

    best = beam[0]
    initial_count = count
    climb_history = [count]

    # Phase B — climb one complete figure at a time. Never throw away the incumbent.
    ceiling = min(MAX_COMPLETE, len(prepared_kits))
    while count < ceiling:
        remaining = deadline - time.time()
        if remaining < 8.0:
            break
        target = count + 1

        # 1) Cheap/local human-like insertion with 0..3 disturbed figures.
        local_budget = min(24.0 if target <= 10 else 30.0, max(8.0, remaining * 0.42))
        grown, rows = v4.lns_grow_beam(
            beam, prepared_kits,
            deadline=min(deadline, time.time() + local_budget),
            max_workers=max(1, min(3, max_workers)),
            extras_per_base=7 if target <= 11 else 5,
        )
        attempts.extend(rows)

        # 2) If it stalls, imitate the manual move-more-things tactic: free 4-5 kits.
        if not grown and deadline - time.time() >= 8.0:
            broad_budget = min(24.0, max(8.0, (deadline-time.time()) * 0.45))
            grown, rows = broad_lns_grow(
                beam, prepared_kits,
                deadline=min(deadline, time.time()+broad_budget),
                max_workers=max(1, min(2, max_workers)),
            )
            attempts.extend(rows)

        # 3) Escape a local optimum with a fresh same-target rescue race.
        if not grown and deadline - time.time() >= 7.0:
            rescue_budget = min(18.0, deadline-time.time())
            rescue, rows = v4.fresh_beam(
                prepared_kits, target,
                deadline=min(deadline, time.time()+rescue_budget),
                max_workers=max(1, min(2, max_workers)),
                portfolios=16,
                per_run=5.0,
                phase=f'global-rescue-{target}',
            )
            attempts.extend(rows)
            grown = rescue

        if not grown:
            attempts.append({
                'phase':'practical-maximum-v5','target':target,'certified':False,
                'reason':'failed local 0-3, human-style 4-5, and fresh rescue; preserving incumbent'
            })
            break

        beam = grown
        count = len(beam[0]['candidate'].kits)
        climb_history.append(count)
        if v4._score(beam[0]) > v4._score(best):
            best = beam[0]

    # Phase C — compact the best count only if meaningful time remains.
    remaining = deadline - time.time()
    if remaining >= 8.0:
        target = len(best['candidate'].kits)
        refined, rows = v4.fresh_beam(
            prepared_kits, target, deadline,
            max_workers=max(1, min(2, max_workers)),
            portfolios=12, per_run=min(5.0, remaining), phase='v5-final-refine'
        )
        attempts.extend(rows)
        if refined and v4._score(refined[0]) > v4._score(best):
            best = refined[0]

    result = best.get('result') or {}
    cert = best.get('certificate') or {}
    final_count = len(best['candidate'].kits)
    return {
        'ok': True,
        'engine': ENGINE,
        'completeFigures': final_count,
        'commercialTarget': v4.COMMERCIAL_TARGET,
        'initialCertifiedCount': initial_count,
        'adaptiveFloorUsed': initial_count < v4.COMMERCIAL_TARGET,
        'probablePracticalMaximum': final_count,
        'selectionStrategy': best['candidate'].label,
        'seed': best.get('seed'),
        'density': float(result.get('density') or 0.0),
        'stripWidthMm': float(result.get('stripWidthMm') or 0.0),
        'placements': result.get('placements') or [],
        'productionCertificate': cert,
        'minimumGapMm': cert.get('minimumGapMmCertified'),
        'requiredGapMm': v4.MIN_GAP_MM,
        'targetDensityReached': float(result.get('density') or 0.0) >= v4.TARGET_DENSITY,
        'beamWidth': v4.BEAM_WIDTH,
        'localNeighborhoodSizes': [0,1,2,3,4,5],
        'searchPhilosophy': 'certified foothold -> progressive climb -> 0-3 LNS -> 4-5 human repair -> fresh rescue',
        'climbHistory': climb_history,
        'attempts': attempts,
        'elapsedSeconds': round(time.time()-started, 2),
    }
