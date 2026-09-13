import math
import time
from copy import deepcopy

from shapely.affinity import rotate as shp_rotate, translate as shp_translate

import benchmark_local_repair_v4 as v4


def _attempt(br, kits, result, seed, seconds, continuous, phase):
    placements = result.get('placements') or []
    m = br._metrics(kits, result) if result.get('stripWidthMm') else {}
    return {
        'seed': seed,
        'rotation': 'continua' if continuous else '15deg',
        'seconds': seconds,
        'phase': phase,
        'fits': bool(result.get('fits')),
        'placementCount': len(placements),
        'repairEligible': True,
        'stripWidthMm': m.get('stripWidthMm'),
        'stripWidthUsagePct': m.get('stripWidthUsagePct'),
        'geometricOccupancyPct': m.get('geometricOccupancyPct'),
        'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
        'error': result.get('error')
    }


def _angle_delta(a, b):
    d = abs((float(a) - float(b)) % 360.0)
    return min(d, 360.0 - d)


def _insert_candidates(pid, parts, original_geoms, original_poses, occupied, gap, w, h, limit=18):
    part = parts[pid]
    current = original_geoms[pid]
    cminx, cminy, _, _ = current.bounds
    a0 = float(original_poses[pid].get('angle') or 0.0) % 360.0
    obstacles = list(occupied.values())
    offsets = [0, -5, 5, -10, 10, -15, 15, -30, 30, -45, 45, -90, 90, 180]
    angles = []
    for off in offsets:
        a = round((a0 + off) % 360.0, 3)
        if a not in angles:
            angles.append(a)

    found = []
    for angle in angles:
        if len(found) >= limit * 3:
            break
        rg = shp_rotate(part['geom'], angle, origin=(0, 0), use_radians=False)
        rminx, rminy, rmaxx, rmaxy = rg.bounds
        rw, rh = rmaxx - rminx, rmaxy - rminy
        if rw > w + .35 or rh > h + .35:
            continue

        xs = [0.0, w-rw, max(0.0, min(w-rw, cminx))]
        ys = [0.0, h-rh, max(0.0, min(h-rh, cminy))]
        for og in obstacles:
            ominx, ominy, omaxx, omaxy = og.bounds
            xs.extend([omaxx + gap, ominx - rw - gap, ominx, omaxx-rw])
            ys.extend([omaxy + gap, ominy - rh - gap, ominy, omaxy-rh])

        ys.extend(i * 10.0 for i in range(int(max(0.0, h-rh) // 10.0) + 1))

        xs = sorted(set(round(max(0.0, min(w-rw, x)), 3) for x in xs if math.isfinite(x)))
        if len(xs) > 34:
            near = sorted(xs, key=lambda x: abs(x-cminx))[:10]
            xs = sorted(set(xs[:24] + near))
        ys = sorted(
            set(round(max(0.0, min(h-rh, y)), 3) for y in ys if math.isfinite(y)),
            key=lambda y: (abs(y-cminy), y)
        )
        if len(ys) > 54:
            ys = ys[:54]

        for x in xs:
            for y in ys:
                g = shp_translate(rg, xoff=x-rminx, yoff=y-rminy)
                if not v4._inside(g, w, h):
                    continue
                if not v4._clear(g, obstacles, gap):
                    continue
                pose = {
                    'angle': angle,
                    'xCm': (x-rminx)/10.0,
                    'yCm': (y-rminy)/10.0
                }
                score = (
                    g.bounds[2],
                    g.bounds[0],
                    abs(y-cminy),
                    _angle_delta(angle, a0)
                )
                found.append((score, pose, g))
                if len(found) >= limit * 3:
                    break
            if len(found) >= limit * 3:
                break

    found.sort(key=lambda row: row[0])
    return found[:limit]


def _frontier_repack(kits, base_result, gap, w, h, seconds):
    parts = v4._part_map(kits)
    placements = base_result.get('placements') or []
    if len(placements) != len(parts):
        return None

    poses = {str(p.get('instanceId')): deepcopy(p) for p in placements}
    if any(pid not in parts for pid in poses):
        return None
    geoms = {pid: v4._geom(parts[pid], pose) for pid, pose in poses.items()}
    if not geoms:
        return None

    deadline = time.time() + max(20, int(seconds))
    offenders = [pid for pid, g in geoms.items() if g.bounds[2] > w + .35]
    right = sorted(geoms, key=lambda pid: geoms[pid].bounds[2], reverse=True)

    if len(offenders) > 6:
        return None
    min_size = max(2, len(offenders))
    max_size = min(6, max(min_size, len(offenders) + 3))

    subsets = []
    offender_set = set(offenders)
    for size in range(min_size, max_size + 1):
        chosen = list(offenders)
        for pid in right:
            if pid not in offender_set and pid not in chosen:
                chosen.append(pid)
            if len(chosen) >= size:
                break
        key = tuple(chosen[:size])
        if len(key) == size and key not in subsets:
            subsets.append(key)

    if len(right) >= min_size + 2:
        for skip in (1, 2):
            chosen = list(offenders)
            for idx, pid in enumerate(right):
                if pid in offender_set or idx == skip:
                    continue
                if pid not in chosen:
                    chosen.append(pid)
                if len(chosen) >= min(max_size, max(min_size, len(offenders)+2)):
                    break
            key = tuple(chosen)
            if len(key) >= min_size and key not in subsets:
                subsets.append(key)

    best = None
    best_width = float('inf')
    for subset in subsets:
        if time.time() >= deadline:
            break
        evac = set(subset)
        fixed = {pid: g for pid, g in geoms.items() if pid not in evac}

        if any(g.bounds[2] > w + .35 for g in fixed.values()):
            continue

        order = sorted(
            subset,
            key=lambda pid: (
                -(geoms[pid].area or 0.0),
                -(geoms[pid].bounds[2]-geoms[pid].bounds[0])
            )
        )
        beam = [(max((g.bounds[2] for g in fixed.values()), default=0.0), {}, fixed)]

        for pid in order:
            if time.time() >= deadline:
                beam = []
                break
            next_beam = []
            for _, placed, occupied in beam[:12]:
                if time.time() >= deadline:
                    break
                candidates = _insert_candidates(
                    pid, parts, geoms, poses, occupied, gap, w, h, limit=16
                )
                for score, pose, g in candidates:
                    new_placed = dict(placed)
                    new_placed[pid] = (pose, g)
                    new_occupied = dict(occupied)
                    new_occupied[pid] = g
                    width = max((og.bounds[2] for og in new_occupied.values()), default=0.0)
                    movement = abs(g.bounds[0]-geoms[pid].bounds[0]) + abs(g.bounds[1]-geoms[pid].bounds[1])
                    next_beam.append(((width, score[0], movement), new_placed, new_occupied))
            next_beam.sort(key=lambda row: row[0])
            beam = [(row[0][0], row[1], row[2]) for row in next_beam[:12]]
            if not beam:
                break

        if not beam:
            continue
        width, placed, occupied = min(beam, key=lambda row: row[0])
        if len(placed) != len(subset):
            continue
        if width < best_width:
            best_width = width
            best = placed
        if width <= w + .35:
            break

    if best is None:
        return None

    out = []
    moved = 0
    for p in placements:
        pid = str(p.get('instanceId'))
        q = deepcopy(p)
        if pid in best:
            q.update(best[pid][0])
            moved += 1
        out.append(q)

    result = deepcopy(base_result)
    result['placements'] = out
    result['stripWidthMm'] = float(best_width)
    result['fits'] = best_width <= w + .5
    result['repairApplied'] = True
    result['repairMovedPieces'] = moved
    result['repairStrategy'] = 'frontier-evict-reinsert'
    return result


def run_exact_with_repair(kits, budget=185):
    import benchmark_routes as br
    started = time.time()
    attempts = []
    expected = sum(len(k.get('parts') or []) for k in kits)
    best = None

    schedule = [
        (2713, False, 18, 'sparrow-v5-discrete'),
        (6151, False, 18, 'sparrow-v5-discrete'),
        (1777, True, 24, 'sparrow-v5-continuous'),
        (10429, True, 18, 'sparrow-v5-continuous'),
    ]

    for seed, continuous, seconds, phase in schedule:
        remaining = budget - (time.time()-started)
        if remaining < 64:
            break
        seconds = min(seconds, max(10, int(remaining-56)))
        result = br.core._run_sparrow(kits, br.GAP_MM, seconds, seed, continuous=continuous)
        placements = result.get('placements') or []
        row = _attempt(br, kits, result, seed, seconds, continuous, phase)
        row['repairEligible'] = len(placements) == expected
        attempts.append(row)
        if len(placements) != expected:
            continue
        if result.get('fits'):
            return result, attempts, round(time.time()-started, 2)
        if best is None or float(result.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18):
            best = result

    if best is None:
        return None, attempts, round(time.time()-started, 2)

    rs = time.time()
    compacted = v4._global_compact(
        kits, best, br.GAP_MM, br.PLATE_WIDTH_MM, br.PLATE_HEIGHT_MM, 22
    )
    compact_seconds = round(time.time()-rs, 2)
    repair_base = compacted if compacted is not None else best
    if compacted is not None:
        m = br._metrics(kits, compacted)
        attempts.append({
            'seed': None,
            'rotation': 'coordinate-global',
            'seconds': compact_seconds,
            'phase': 'global-coordinate-v5',
            'fits': bool(compacted.get('fits')),
            'placementCount': len(compacted.get('placements') or []),
            'repairEligible': True,
            'baseStripWidthMm': round(float(best.get('stripWidthMm') or 0), 3),
            'stripWidthMm': m.get('stripWidthMm'),
            'stripWidthUsagePct': m.get('stripWidthUsagePct'),
            'geometricOccupancyPct': m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
            'movedPieces': compacted.get('repairMovedPieces'),
            'error': None
        })
        if compacted.get('fits'):
            return compacted, attempts, round(time.time()-started, 2)

    remaining = budget - (time.time()-started)
    rs = time.time()
    repacked = _frontier_repack(
        kits, repair_base, br.GAP_MM, br.PLATE_WIDTH_MM, br.PLATE_HEIGHT_MM,
        max(24, min(48, int(remaining-2)))
    )
    repack_seconds = round(time.time()-rs, 2)
    if repacked is not None:
        m = br._metrics(kits, repacked)
        attempts.append({
            'seed': None,
            'rotation': 'frontier-repack',
            'seconds': repack_seconds,
            'phase': 'frontier-repack-v5',
            'fits': bool(repacked.get('fits')),
            'placementCount': len(repacked.get('placements') or []),
            'repairEligible': True,
            'baseStripWidthMm': round(float(repair_base.get('stripWidthMm') or 0), 3),
            'stripWidthMm': m.get('stripWidthMm'),
            'stripWidthUsagePct': m.get('stripWidthUsagePct'),
            'geometricOccupancyPct': m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
            'movedPieces': repacked.get('repairMovedPieces'),
            'strategy': repacked.get('repairStrategy'),
            'error': None
        })
        if repacked.get('fits'):
            return repacked, attempts, round(time.time()-started, 2)

    return None, attempts, round(time.time()-started, 2)


__all__ = ['run_exact_with_repair']
