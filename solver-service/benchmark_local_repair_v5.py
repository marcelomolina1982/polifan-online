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


def _collective_push(kits, base_result, gap, w, h):
    """Shift the overflowing right-front cluster left as a rigid group.

    If the shifted group would violate the gap with a fixed piece, that piece
    is absorbed into the moving cluster and shifted by the same amount. This
    preserves all distances inside the moving cluster and gives a cheap,
    cooperative repair for layouts that are only a few millimetres too wide.
    """
    parts = v4._part_map(kits)
    placements = base_result.get('placements') or []
    if len(placements) != len(parts):
        return None, {'reason': 'placement-count-mismatch'}

    poses = {str(p.get('instanceId')): deepcopy(p) for p in placements}
    if any(pid not in parts for pid in poses):
        return None, {'reason': 'unknown-instance'}

    geoms = {pid: v4._geom(parts[pid], pose) for pid, pose in poses.items()}
    if not geoms:
        return None, {'reason': 'no-geometries'}

    current_width = max(g.bounds[2] for g in geoms.values())
    over = current_width - w
    if over <= .5:
        out = deepcopy(base_result)
        out['fits'] = True
        out['stripWidthMm'] = current_width
        out['repairApplied'] = True
        out['repairMovedPieces'] = 0
        out['repairStrategy'] = 'frontier-chain-push'
        return out, {'reason': 'already-fits', 'clusterSize': 0}

    offenders = {pid for pid, g in geoms.items() if g.bounds[2] > w + .35}
    if not offenders:
        # Metrics and exact geometry can differ slightly; use the right-most pieces.
        right_edge = current_width - max(25.0, over + 8.0)
        offenders = {pid for pid, g in geoms.items() if g.bounds[2] >= right_edge}

    # Try the minimum shift first, then a little extra room.
    shifts = []
    start = max(1.0, over + .7)
    for extra in (0, 1, 2, 3, 5, 8, 12, 16, 22, 30):
        shifts.append(start + extra)

    best_diag = {'reason': 'no-valid-chain', 'offenders': len(offenders), 'overMm': round(over, 3)}

    for dx in shifts:
        moving = set(offenders)
        # Absorb blockers until the group can move rigidly without violating the gap.
        changed = True
        loops = 0
        while changed and loops < len(geoms) + 2:
            loops += 1
            changed = False
            shifted = {pid: shp_translate(geoms[pid], xoff=-dx, yoff=0.0) for pid in moving}

            if any(not v4._inside(g, w, h) for g in shifted.values()):
                moving = set()
                break

            for pid, sg in list(shifted.items()):
                for oid, og in geoms.items():
                    if oid in moving:
                        continue
                    if sg.distance(og) < gap - 1e-6:
                        moving.add(oid)
                        changed = True
            if len(moving) == len(geoms):
                # Moving the whole layout cannot help if the left edge would leave the plate.
                all_shifted = {pid: shp_translate(g, xoff=-dx, yoff=0.0) for pid, g in geoms.items()}
                if any(not v4._inside(g, w, h) for g in all_shifted.values()):
                    moving = set()
                break

        if not moving:
            continue

        final_geoms = dict(geoms)
        for pid in moving:
            final_geoms[pid] = shp_translate(geoms[pid], xoff=-dx, yoff=0.0)

        new_width = max(g.bounds[2] for g in final_geoms.values())
        if new_width > w + .5:
            best_diag = {
                'reason': 'chain-still-wide', 'clusterSize': len(moving),
                'shiftMm': round(dx, 3), 'widthMm': round(new_width, 3)
            }
            continue

        # Exact pairwise validation after the cooperative move.
        ids = list(final_geoms)
        valid = True
        for i in range(len(ids)):
            gi = final_geoms[ids[i]]
            if not v4._inside(gi, w, h):
                valid = False
                break
            for j in range(i + 1, len(ids)):
                if gi.distance(final_geoms[ids[j]]) < gap - 1e-6:
                    valid = False
                    break
            if not valid:
                break
        if not valid:
            best_diag = {
                'reason': 'chain-validation-failed', 'clusterSize': len(moving),
                'shiftMm': round(dx, 3)
            }
            continue

        out = []
        for p in placements:
            q = deepcopy(p)
            pid = str(q.get('instanceId'))
            if pid in moving:
                q['xCm'] = float(q.get('xCm') or 0.0) - dx / 10.0
            out.append(q)

        result = deepcopy(base_result)
        result['placements'] = out
        result['stripWidthMm'] = float(new_width)
        result['fits'] = True
        result['repairApplied'] = True
        result['repairMovedPieces'] = len(moving)
        result['repairStrategy'] = 'frontier-chain-push'
        return result, {
            'reason': 'success', 'clusterSize': len(moving),
            'shiftMm': round(dx, 3), 'widthMm': round(new_width, 3)
        }

    return None, best_diag


def _insert_candidates(pid, parts, original_geoms, original_poses, occupied, gap, w, h, limit=12):
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
    per_angle = max(2, limit // 3)
    for angle in angles:
        if len(found) >= limit * 4:
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

        # Sparse scan; obstacle anchors do most of the work and keep runtime bounded.
        ys.extend(i * 20.0 for i in range(int(max(0.0, h-rh) // 20.0) + 1))
        xs = sorted(set(round(max(0.0, min(w-rw, x)), 3) for x in xs if math.isfinite(x)))
        ys = sorted(set(round(max(0.0, min(h-rh, y)), 3) for y in ys if math.isfinite(y)), key=lambda y: (abs(y-cminy), y))
        xs = xs[:28]
        ys = ys[:34]

        angle_found = 0
        for x in xs:
            for y in ys:
                g = shp_translate(rg, xoff=x-rminx, yoff=y-rminy)
                if not v4._inside(g, w, h):
                    continue
                if not v4._clear(g, obstacles, gap):
                    continue
                pose = {'angle': angle, 'xCm': (x-rminx)/10.0, 'yCm': (y-rminy)/10.0}
                score = (g.bounds[2], g.bounds[0], abs(y-cminy), _angle_delta(angle, a0))
                found.append((score, pose, g))
                angle_found += 1
                if angle_found >= per_angle:
                    break
            if angle_found >= per_angle:
                break

    found.sort(key=lambda row: row[0])
    return found[:limit]


def _frontier_repack(kits, base_result, gap, w, h, seconds):
    parts = v4._part_map(kits)
    placements = base_result.get('placements') or []
    if len(placements) != len(parts):
        return None, {'reason': 'placement-count-mismatch'}

    poses = {str(p.get('instanceId')): deepcopy(p) for p in placements}
    if any(pid not in parts for pid in poses):
        return None, {'reason': 'unknown-instance'}
    geoms = {pid: v4._geom(parts[pid], pose) for pid, pose in poses.items()}
    if not geoms:
        return None, {'reason': 'no-geometries'}

    deadline = time.time() + max(12, int(seconds))
    offenders = [pid for pid, g in geoms.items() if g.bounds[2] > w + .35]
    right = sorted(geoms, key=lambda pid: geoms[pid].bounds[2], reverse=True)

    # Always include all offenders; allow a slightly larger cooperative set than V5.1.
    if len(offenders) > 8:
        return None, {'reason': 'too-many-offenders', 'offenders': len(offenders)}
    min_size = max(2, len(offenders))
    max_size = min(8, max(min_size, len(offenders) + 3))

    subsets = []
    for size in range(min_size, max_size + 1):
        chosen = list(offenders)
        for pid in right:
            if pid not in chosen:
                chosen.append(pid)
            if len(chosen) >= size:
                break
        key = tuple(chosen[:size])
        if len(key) == size and key not in subsets:
            subsets.append(key)

    best = None
    best_width = float('inf')
    tested = 0
    for subset in subsets:
        if time.time() >= deadline:
            break
        evac = set(subset)
        fixed = {pid: g for pid, g in geoms.items() if pid not in evac}
        if any(g.bounds[2] > w + .35 for g in fixed.values()):
            continue

        order = sorted(subset, key=lambda pid: (-(geoms[pid].area or 0.0), -(geoms[pid].bounds[2]-geoms[pid].bounds[0])))
        beam = [(max((g.bounds[2] for g in fixed.values()), default=0.0), {}, fixed)]

        for pid in order:
            if time.time() >= deadline:
                beam = []
                break
            next_beam = []
            for _, placed, occupied in beam[:8]:
                if time.time() >= deadline:
                    break
                candidates = _insert_candidates(pid, parts, geoms, poses, occupied, gap, w, h, limit=10)
                tested += len(candidates)
                for score, pose, g in candidates:
                    new_placed = dict(placed)
                    new_placed[pid] = (pose, g)
                    new_occupied = dict(occupied)
                    new_occupied[pid] = g
                    width = max((og.bounds[2] for og in new_occupied.values()), default=0.0)
                    movement = abs(g.bounds[0]-geoms[pid].bounds[0]) + abs(g.bounds[1]-geoms[pid].bounds[1])
                    next_beam.append(((width, score[0], movement), new_placed, new_occupied))
            next_beam.sort(key=lambda row: row[0])
            beam = [(row[0][0], row[1], row[2]) for row in next_beam[:8]]
            if not beam:
                break

        if not beam:
            continue
        width, placed, _ = min(beam, key=lambda row: row[0])
        if len(placed) != len(subset):
            continue
        if width < best_width:
            best_width = width
            best = placed
        if width <= w + .35:
            break

    if best is None:
        return None, {'reason': 'beam-no-solution', 'offenders': len(offenders), 'testedCandidates': tested}

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
    return result, {'reason': 'success' if result['fits'] else 'best-still-wide', 'testedCandidates': tested, 'widthMm': round(best_width, 3)}


def _repair_attempt(br, kits, result, phase, seconds, base_width, diag=None):
    row = {
        'seed': None,
        'rotation': phase,
        'seconds': seconds,
        'phase': phase,
        'fits': bool(result and result.get('fits')),
        'placementCount': len((result or {}).get('placements') or []),
        'repairEligible': True,
        'baseStripWidthMm': round(float(base_width or 0), 3),
        'error': None,
    }
    if result is not None:
        m = br._metrics(kits, result)
        row.update({
            'stripWidthMm': m.get('stripWidthMm'),
            'stripWidthUsagePct': m.get('stripWidthUsagePct'),
            'geometricOccupancyPct': m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
            'movedPieces': result.get('repairMovedPieces'),
            'strategy': result.get('repairStrategy'),
        })
    if diag:
        row['diagnostic'] = diag
    return row


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
    compacted = v4._global_compact(kits, best, br.GAP_MM, br.PLATE_WIDTH_MM, br.PLATE_HEIGHT_MM, 18)
    compact_seconds = round(time.time()-rs, 2)
    repair_base = compacted if compacted is not None else best
    if compacted is not None:
        attempts.append(_repair_attempt(br, kits, compacted, 'global-coordinate-v5', compact_seconds, best.get('stripWidthMm')))
        if compacted.get('fits'):
            return compacted, attempts, round(time.time()-started, 2)

    # Fast cooperative repair first: ideal for small residual over-widths.
    rs = time.time()
    pushed, push_diag = _collective_push(kits, repair_base, br.GAP_MM, br.PLATE_WIDTH_MM, br.PLATE_HEIGHT_MM)
    push_seconds = round(time.time()-rs, 2)
    attempts.append(_repair_attempt(br, kits, pushed, 'frontier-chain-push-v5', push_seconds, repair_base.get('stripWidthMm'), push_diag))
    if pushed is not None and pushed.get('fits'):
        return pushed, attempts, round(time.time()-started, 2)

    remaining = budget - (time.time()-started)
    rs = time.time()
    repack_seconds_budget = max(12, min(28, int(max(12, remaining-2))))
    repacked, repack_diag = _frontier_repack(kits, repair_base, br.GAP_MM, br.PLATE_WIDTH_MM, br.PLATE_HEIGHT_MM, repack_seconds_budget)
    repack_seconds = round(time.time()-rs, 2)
    attempts.append(_repair_attempt(br, kits, repacked, 'frontier-repack-v5', repack_seconds, repair_base.get('stripWidthMm'), repack_diag))
    if repacked is not None and repacked.get('fits'):
        return repacked, attempts, round(time.time()-started, 2)

    return None, attempts, round(time.time()-started, 2)


__all__ = ['run_exact_with_repair']
