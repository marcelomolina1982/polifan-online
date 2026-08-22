"""TVT Revolutionary Ensemble V4.0 — laboratory only.

Key ideas:
- 10 complete figures is a commercial target, not a geometric hard floor.
- If 10 is not certifiably feasible, search 9, 8, ... instead of declaring failure.
- To grow N -> N+1, do not only search an empty hole: deliberately perturb 1-3
  incumbent kits and let Sparrow repair/repack around the injected complete kit.
- Keep several certified incumbents (beam) so one unlucky base does not dominate.
- Never accept a result without the existing independent production geometry
  validation and a real >= 3.0 mm gap.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import subprocess
import tempfile
import time

import nest_sparrow as ns
from revolutionary.selector_v2 import portfolios as select_portfolios

COMMERCIAL_TARGET = 10
MIN_SEARCH_COMPLETE = 6
MAX_COMPLETE = 16
MIN_GAP_MM = 3.0
SOLVER_GAP_MM = 3.2
TARGET_DENSITY = 70.0
BEAM_WIDTH = 4
SEEDS = (41, 429, 1701, 7919, 31337, 65537, 104729, 130363)
SPARROW_BIN = os.environ.get('SPARROW_BIN', '/usr/local/bin/sparrow')


def _score(row):
    kits = row['candidate'].kits
    result = row.get('result') or {}
    return (
        len(kits),
        float(result.get('density') or 0.0),
        -float(result.get('stripWidthMm') or 1e18),
        -float(result.get('elapsedSeconds') or 1e18),
    )


def _certified(selected, result):
    if not result or not result.get('ok') or not result.get('fits'):
        return False, {}
    validator = getattr(ns, '_validate_final_geometry', None)
    if validator is None:
        return False, {'reason': 'certifier unavailable'}
    valid, cert = validator(selected, result)
    gap = cert.get('minimumGapMmCertified')
    ok = bool(
        valid and gap is not None and float(gap) >= MIN_GAP_MM
        and int(cert.get('collisionCount') or 0) == 0
        and int(cert.get('outsidePlateCount') or 0) == 0
    )
    return ok, cert


def _run_fresh(candidate, seconds, seed):
    result = ns._run_sparrow(candidate.kits, MIN_GAP_MM, seconds, seed, continuous=True)
    ok, cert = _certified(candidate.kits, result)
    return {'candidate': candidate, 'seed': seed, 'result': result, 'certified': ok, 'certificate': cert}


def _attempt(row, target, phase):
    r = row.get('result') or {}
    cert = row.get('certificate') or {}
    return {
        'phase': phase,
        'label': row['candidate'].label,
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


def _unique_beam(rows, width=BEAM_WIDTH):
    out = []
    seen = set()
    for row in sorted(rows, key=_score, reverse=True):
        sig = tuple(sorted(str(k.get('kitId') or '') for k in row['candidate'].kits))
        if sig in seen:
            continue
        seen.add(sig)
        out.append(row)
        if len(out) >= width:
            break
    return out


def fresh_beam(kits, target, deadline, max_workers=4, portfolios=16, per_run=6.0, phase='fresh'):
    candidates = select_portfolios(kits, target, portfolios)
    if not candidates:
        return [], []
    jobs = []
    for idx, c in enumerate(candidates):
        jobs.append((c, SEEDS[(idx * 2) % len(SEEDS)]))
        jobs.append((c, SEEDS[(idx * 2 + 1) % len(SEEDS)]))
    successes = []
    attempts = []
    wave_size = max_workers * 2
    for start in range(0, len(jobs), wave_size):
        remaining = deadline - time.time()
        if remaining < 2.8:
            break
        wave = jobs[start:start + wave_size]
        seconds = max(2.5, min(per_run, remaining / max(1.0, len(wave) / max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {pool.submit(_run_fresh, c, seconds, seed): (c, seed) for c, seed in wave}
            for fut in as_completed(futures):
                c, seed = futures[fut]
                try:
                    row = fut.result()
                except Exception as exc:
                    attempts.append({'phase': phase, 'label': c.label, 'seed': seed, 'target': target, 'certified': False, 'error': str(exc)[:240]})
                    continue
                attempts.append(_attempt(row, target, phase))
                if row['certified']:
                    successes.append(row)
        if len(_unique_beam(successes)) >= BEAM_WIDTH:
            break
    return _unique_beam(successes), attempts


def _extra_rank(k):
    area = max(1.0, float(k.get('area') or 1.0))
    env = max(area, float(k.get('envelope') or area))
    solidity = max(0.01, float(k.get('solidity') or area / env))
    priority = float(k.get('priority') or 999999)
    return (priority, env / solidity, -area)


def _blocker_plans(incumbent):
    """Return disturbance sets of 0..3 kits.

    We deliberately try several notions of 'blocker': right-edge kits, large
    envelopes, and mixed right-edge/large combinations. This is cheap and gives
    Sparrow different local neighborhoods to rebuild.
    """
    kits = list(incumbent['candidate'].kits)
    placements = (incumbent.get('result') or {}).get('placements') or []
    by_kit = {}
    for p in placements:
        kid = str(p.get('kitId') or '')
        if not kid:
            continue
        by_kit.setdefault(kid, []).append(p)

    def right_score(k):
        kid = str(k.get('kitId') or '')
        xs = [float(p.get('xCm') or 0.0) * 10.0 for p in by_kit.get(kid, [])]
        return max(xs) if xs else -1e9

    right = sorted(kits, key=right_score, reverse=True)
    large = sorted(kits, key=lambda k: float(k.get('envelope') or k.get('area') or 0.0), reverse=True)
    compact = sorted(kits, key=_extra_rank)
    raw = [([], 'direct')]
    for n in (1, 2, 3):
        raw.append(([str(k.get('kitId')) for k in right[:n]], f'right-{n}'))
        raw.append(([str(k.get('kitId')) for k in large[:n]], f'large-{n}'))
        mix = []
        for k in (right[:2] + large[:2] + compact[:2]):
            kid = str(k.get('kitId'))
            if kid and kid not in mix:
                mix.append(kid)
            if len(mix) >= n:
                break
        raw.append((mix, f'mixed-{n}'))
    out = []
    seen = set()
    for ids, label in raw:
        sig = tuple(sorted(ids))
        if sig in seen:
            continue
        seen.add(sig)
        out.append((set(ids), label))
    return out


def _warm_result(selected, out, elapsed, log_tail=''):
    sol = (out or {}).get('solution') or {}
    layout = sol.get('layout') or {}
    rows = layout.get('placed_items') or []
    idmap = {}
    item_id = 0
    for kit in selected:
        for part in kit.get('parts') or []:
            idmap[item_id] = part
            item_id += 1
    placements = []
    for row in rows:
        part = idmap.get(int(row.get('item_id', -1)))
        if not part:
            continue
        tr = row.get('transformation') or {}
        trans = tr.get('translation') or [0, 0]
        tx = float(trans[0] if len(trans) > 0 else 0.0)
        ty = float(trans[1] if len(trans) > 1 else 0.0)
        placements.append({
            'instanceId': part['instanceId'], 'kitId': part['kitId'], 'figure': part['figure'],
            'name': part['name'], 'role': part['role'], 'xCm': tx / 10.0, 'yCm': ty / 10.0,
            'angle': float(tr.get('rotation') or 0.0), 'trimXCm': part['trimXmm'] / 10.0,
            'trimYCm': part['trimYmm'] / 10.0, 'partialExtra': False,
        })
    expected = sum(len(k.get('parts') or []) for k in selected)
    strip = float(sol.get('strip_width') or 1e18)
    density = 100.0 * sum(float(k.get('area') or 0.0) for k in selected) / (1220.0 * 580.0)
    return {
        'ok': True,
        'fits': len(placements) == expected and strip <= 1220.5,
        'stripWidthMm': strip,
        'density': density,
        'placements': placements,
        'elapsedSeconds': round(elapsed, 2),
        'solverDensity': float(sol.get('density') or 0.0) * 100.0,
        'placedParts': len(placements),
        'expectedParts': expected,
        'continuousRotation': True,
        'log': log_tail,
    }


def _lns_one(incumbent, extra, disturbed_ids, disturbance_label, seconds, seed):
    selected = list(incumbent['candidate'].kits) + [extra]
    base_placements = {(p.get('instanceId') or ''): p for p in ((incumbent.get('result') or {}).get('placements') or [])}
    extra_id = str(extra.get('kitId') or '')
    items = []
    placed = []
    item_id = 0
    # Multiple staging anchors intentionally create different local rebuilds.
    anchors = ((850.0, 30.0), (1010.0, 300.0), (690.0, 180.0), (920.0, 430.0), (540.0, 70.0), (760.0, 330.0))
    anchor_shift = int(seed) % len(anchors)
    disturbed_counter = 0

    for kit in selected:
        kid = str(kit.get('kitId') or '')
        is_free = kid == extra_id or kid in disturbed_ids
        for part_index, part in enumerate(kit.get('parts') or []):
            items.append({'id': item_id, 'demand': 1, 'shape': part['shape']})
            bp = base_placements.get(part.get('instanceId') or '')
            if bp is not None and not is_free:
                tx = float(bp.get('xCm') or 0.0) * 10.0
                ty = float(bp.get('yCm') or 0.0) * 10.0
                # Existing V3 warm-start used the incumbent rotation directly;
                # preserve that behavior for untouched pieces.
                rot = float(bp.get('angle') or 0.0)
            else:
                minx, miny, maxx, maxy = part['geom'].bounds
                ax, ay = anchors[(anchor_shift + disturbed_counter + part_index) % len(anchors)]
                tx = max(-minx, min(1220.0 - maxx, ax - minx))
                ty = max(-miny, min(580.0 - maxy, ay - miny))
                rot = 0.0
                disturbed_counter += 1
            placed.append({'item_id': item_id, 'transformation': {'rotation': rot, 'translation': [float(tx), float(ty)]}})
            item_id += 1

    area = sum(float(k.get('area') or 0.0) for k in selected)
    warm = {
        'name': 'tvt_lns_grow',
        'items': items,
        'strip_height': 580.0,
        'solution': {
            'strip_width': 1220.0,
            'layout': {'container_id': 0, 'placed_items': placed, 'density': area / (1220.0 * 580.0)},
            'density': area / (1220.0 * 580.0),
            'run_time_sec': 0,
        },
    }
    started = time.time()
    with tempfile.TemporaryDirectory(prefix='tvt-lns-grow-') as td:
        inp = os.path.join(td, 'warm.json')
        with open(inp, 'w', encoding='utf-8') as f:
            json.dump(warm, f, separators=(',', ':'))
        cmd = [
            SPARROW_BIN, '-i', inp, '-t', str(max(2, int(seconds))),
            '--min-item-separation', str(SOLVER_GAP_MM), '--workers', '1',
            '-s', str(int(seed)), '-x'
        ]
        try:
            proc = subprocess.run(cmd, cwd=td, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=seconds + 18)
        except subprocess.TimeoutExpired as exc:
            tail = exc.stdout[-1000:] if isinstance(exc.stdout, str) else ''
            candidate = type('LNSCandidate', (), {'label': f'lns-{disturbance_label}', 'kits': selected})()
            return {'candidate': candidate, 'seed': seed, 'result': {'ok': False, 'error': 'lns timeout', 'log': tail}, 'certified': False, 'certificate': {}}
        outpath = os.path.join(td, 'output', 'final_tvt_lns_grow.json')
        if proc.returncode != 0 or not os.path.exists(outpath):
            candidate = type('LNSCandidate', (), {'label': f'lns-{disturbance_label}', 'kits': selected})()
            return {'candidate': candidate, 'seed': seed, 'result': {'ok': False, 'error': f'lns exit {proc.returncode}', 'log': (proc.stdout or '')[-1000:]}, 'certified': False, 'certificate': {}}
        with open(outpath, 'r', encoding='utf-8') as f:
            out = json.load(f)

    result = _warm_result(selected, out, time.time() - started, (proc.stdout or '')[-900:])
    ok, cert = _certified(selected, result)
    label = f"lns-{disturbance_label} + {str(extra.get('figure') or extra_id)[:36]}"
    candidate = type('LNSCandidate', (), {'label': label, 'kits': selected})()
    return {'candidate': candidate, 'seed': seed, 'result': result, 'certified': ok, 'certificate': cert}


def lns_grow_beam(beam, all_kits, deadline, max_workers=4, extras_per_base=6):
    attempts = []
    successes = []
    jobs = []
    for bidx, incumbent in enumerate(beam[:BEAM_WIDTH]):
        used = {str(k.get('kitId') or '') for k in incumbent['candidate'].kits}
        extras = sorted([k for k in all_kits if str(k.get('kitId') or '') not in used], key=_extra_rank)[:extras_per_base]
        plans = _blocker_plans(incumbent)
        # Direct insertion + selected 1/2/3-kit neighborhoods. Cap job count.
        selected_plans = plans[:7]
        for eidx, extra in enumerate(extras):
            for pidx, (disturbed, label) in enumerate(selected_plans):
                seed = SEEDS[(bidx * 13 + eidx * 3 + pidx) % len(SEEDS)]
                jobs.append((incumbent, extra, disturbed, label, seed))
                if len(jobs) >= 48:
                    break
            if len(jobs) >= 48:
                break
        if len(jobs) >= 48:
            break

    wave_size = max_workers
    for start in range(0, len(jobs), wave_size):
        remaining = deadline - time.time()
        if remaining < 4.0:
            break
        wave = jobs[start:start + wave_size]
        seconds = max(3.0, min(12.0, remaining / max(1.0, len(wave) / max_workers)))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = {
                pool.submit(_lns_one, inc, extra, disturbed, label, seconds, seed): (inc, extra, disturbed, label, seed)
                for inc, extra, disturbed, label, seed in wave
            }
            for fut in as_completed(futures):
                inc, extra, disturbed, label, seed = futures[fut]
                target = len(inc['candidate'].kits) + 1
                try:
                    row = fut.result()
                except Exception as exc:
                    attempts.append({'phase': 'lns-grow', 'label': label, 'seed': seed, 'target': target, 'certified': False, 'error': str(exc)[:240]})
                    continue
                attempts.append(_attempt(row, target, 'lns-grow'))
                if row['certified']:
                    successes.append(row)
        if len(_unique_beam(successes)) >= BEAM_WIDTH:
            break
    return _unique_beam(successes), attempts


def _find_initial_beam(prepared_kits, deadline, max_workers, attempts):
    """Find the highest practical certified starting count.

    Try the commercial target first, then gracefully fall to 9, 8... when the
    geometry genuinely cannot sustain 10 (e.g. bulky repeated shapes).
    """
    max_target = min(COMMERCIAL_TARGET, len(prepared_kits))
    floor = min(MIN_SEARCH_COMPLETE, max_target)
    for target in range(max_target, floor - 1, -1):
        remaining = deadline - time.time()
        if remaining < 5.0:
            break
        slice_seconds = min(24.0 if target == COMMERCIAL_TARGET else 14.0, remaining)
        beam, rows = fresh_beam(
            prepared_kits, target,
            deadline=min(deadline, time.time() + slice_seconds),
            max_workers=max_workers,
            portfolios=18 if target >= 10 else 12,
            per_run=6.0 if target >= 10 else 4.5,
            phase=f'initial-{target}',
        )
        attempts.extend(rows)
        if beam:
            return beam, target
        attempts.append({'phase': 'adaptive-floor', 'target': target, 'certified': False, 'reason': 'no certified layout at this count; trying lower count'})
    return [], 0


def revolutionary_solve(prepared_kits, total_seconds=150.0, max_workers=4):
    started = time.time()
    budget = max(30.0, float(total_seconds))
    global_deadline = started + budget
    attempts = []

    initial_deadline = min(global_deadline, started + min(48.0, budget * 0.34))
    beam, initial_count = _find_initial_beam(prepared_kits, initial_deadline, max_workers, attempts)
    if not beam:
        return {
            'ok': False,
            'engine': 'TVT Revolutionary Ensemble V4.0',
            'error': 'No certified practical layout found down to adaptive floor',
            'attempts': attempts,
            'elapsedSeconds': round(time.time() - started, 2),
        }

    best = beam[0]
    current_count = initial_count
    # Iterative LNS: N -> N+1, preserving a beam of several certified incumbents.
    while current_count < min(MAX_COMPLETE, len(prepared_kits)):
        remaining = global_deadline - time.time()
        if remaining < 9.0:
            break
        step_budget = min(42.0, max(9.0, remaining * 0.62))
        grown, rows = lns_grow_beam(
            beam, prepared_kits,
            deadline=min(global_deadline, time.time() + step_budget),
            max_workers=max_workers,
            extras_per_base=7 if current_count <= 10 else 5,
        )
        attempts.extend(rows)
        if not grown:
            attempts.append({
                'phase': 'practical-maximum',
                'target': current_count + 1,
                'certified': False,
                'reason': f'no N+1 solution after direct + 1/2/3-kit local perturbations from {len(beam)} certified incumbents',
            })
            break
        beam = grown
        current_count += 1
        if _score(beam[0]) > _score(best):
            best = beam[0]

    # Use a small final fresh race only when enough time remains; it can improve
    # compactness but can never replace a higher-count incumbent with a lower one.
    remaining = global_deadline - time.time()
    if remaining >= 8.0:
        target = len(best['candidate'].kits)
        fresh, rows = fresh_beam(
            prepared_kits, target,
            deadline=global_deadline,
            max_workers=max_workers,
            portfolios=14,
            per_run=min(6.0, remaining),
            phase='same-count-refine',
        )
        attempts.extend(rows)
        if fresh and _score(fresh[0]) > _score(best):
            best = fresh[0]

    result = best.get('result') or {}
    cert = best.get('certificate') or {}
    count = len(best['candidate'].kits)
    return {
        'ok': True,
        'engine': 'TVT Revolutionary Ensemble V4.0',
        'completeFigures': count,
        'commercialTarget': COMMERCIAL_TARGET,
        'initialCertifiedCount': initial_count,
        'adaptiveFloorUsed': initial_count < COMMERCIAL_TARGET,
        'probablePracticalMaximum': count,
        'selectionStrategy': best['candidate'].label,
        'seed': best.get('seed'),
        'density': float(result.get('density') or 0.0),
        'stripWidthMm': float(result.get('stripWidthMm') or 0.0),
        'placements': result.get('placements') or [],
        'productionCertificate': cert,
        'minimumGapMm': cert.get('minimumGapMmCertified'),
        'requiredGapMm': MIN_GAP_MM,
        'targetDensityReached': float(result.get('density') or 0.0) >= TARGET_DENSITY,
        'beamWidth': BEAM_WIDTH,
        'localNeighborhoodSizes': [0, 1, 2, 3],
        'attempts': attempts,
        'elapsedSeconds': round(time.time() - started, 2),
    }
