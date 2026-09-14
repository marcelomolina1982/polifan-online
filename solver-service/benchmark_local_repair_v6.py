import math
import time
from copy import deepcopy

from shapely.affinity import rotate as shp_rotate, translate as shp_translate

import benchmark_local_repair_v4 as v4
import benchmark_local_repair_v5 as v5


def _angle_delta(a, b):
    d = abs((float(a) - float(b)) % 360.0)
    return min(d, 360.0 - d)


def _candidate_pose(part, angle, bx, by):
    rg = shp_rotate(part['geom'], angle, origin=(0, 0), use_radians=False)
    minx, miny, _, _ = rg.bounds
    g = shp_translate(rg, xoff=bx-minx, yoff=by-miny)
    return {'angle': angle, 'xCm': (bx-minx)/10.0, 'yCm': (by-miny)/10.0}, g


def _insert_candidates_v6(pid, parts, original_geoms, original_poses, occupied, gap, w, h, limit=18):
    part = parts[pid]
    current = original_geoms[pid]
    cminx, cminy, cmaxx, cmaxy = current.bounds
    a0 = float(original_poses[pid].get('angle') or 0.0) % 360.0
    obstacles = list(occupied.values())

    offsets = [0, -3, 3, -5, 5, -8, 8, -10, 10, -15, 15, -22.5, 22.5, -30, 30, -45, 45, -60, 60, -90, 90, 180]
    angles = []
    for off in offsets:
        a = round((a0 + off) % 360.0, 3)
        if a not in angles:
            angles.append(a)

    found = []
    seen = set()
    for angle in angles:
        rg = shp_rotate(part['geom'], angle, origin=(0, 0), use_radians=False)
        rminx, rminy, rmaxx, rmaxy = rg.bounds
        rw, rh = rmaxx-rminx, rmaxy-rminy
        if rw > w + .35 or rh > h + .35:
            continue

        maxx = max(0.0, w-rw)
        maxy = max(0.0, h-rh)
        xs = [0.0, maxx, max(0.0, min(maxx, cminx))]
        ys = [0.0, maxy, max(0.0, min(maxy, cminy))]

        # Dense local scan to the left of the current frontier; this is what V5 lacked.
        for step in (2.5, 5.0, 10.0):
            for k in range(0, 25):
                xs.append(cminx - k*step)
        for step in (2.5, 5.0, 10.0):
            for k in range(-14, 15):
                ys.append(cminy + k*step)

        # Anchor against actual obstacle boundaries, on both sides and both axes.
        for og in obstacles:
            ominx, ominy, omaxx, omaxy = og.bounds
            xs.extend([
                omaxx + gap,
                ominx - rw - gap,
                ominx,
                omaxx-rw,
                omaxx + gap - rw,
                ominx - gap,
            ])
            ys.extend([
                omaxy + gap,
                ominy - rh - gap,
                ominy,
                omaxy-rh,
                omaxy + gap - rh,
                ominy - gap,
            ])

        # Coarse full-height coverage so narrow cavities are not missed.
        ys.extend(i*10.0 for i in range(int(maxy//10.0)+1))

        xs = sorted(set(round(max(0.0, min(maxx, x)), 3) for x in xs if math.isfinite(x)), key=lambda x: (abs(x-cminx), x))
        ys = sorted(set(round(max(0.0, min(maxy, y)), 3) for y in ys if math.isfinite(y)), key=lambda y: (abs(y-cminy), y))

        angle_hits = 0
        for x in xs:
            for y in ys:
                key = (angle, x, y)
                if key in seen:
                    continue
                seen.add(key)
                pose, g = _candidate_pose(part, angle, x, y)
                if not v4._inside(g, w, h):
                    continue
                if not v4._clear(g, obstacles, gap):
                    continue
                movement = abs(g.bounds[0]-cminx) + abs(g.bounds[1]-cminy)
                score = (g.bounds[2], movement, abs(g.bounds[1]-cminy), _angle_delta(angle, a0))
                found.append((score, pose, g))
                angle_hits += 1
                if angle_hits >= 8:
                    break
            if angle_hits >= 8:
                break
        if len(found) >= limit*5:
            break

    found.sort(key=lambda row: row[0])
    return found[:limit]


def _neighbor_rank(pid, offenders, geoms, gap):
    g = geoms[pid]
    best = float('inf')
    for oid in offenders:
        og = geoms[oid]
        # Physical distance matters more than mere right-edge position.
        d = float(g.distance(og))
        # Favor pieces horizontally in front/behind the offender's movement corridor.
        gx1, gy1, gx2, gy2 = g.bounds
        ox1, oy1, ox2, oy2 = og.bounds
        y_overlap = max(0.0, min(gy2, oy2)-max(gy1, oy1))
        corridor_bonus = -40.0 if y_overlap > 0 else 0.0
        best = min(best, d + corridor_bonus - 0.02*gx2)
    return best


def _frontier_repack_v6(kits, base_result, gap, w, h, seconds):
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

    deadline = time.time() + max(16, int(seconds))
    offenders = [pid for pid, g in geoms.items() if g.bounds[2] > w + .35]
    if not offenders:
        return None, {'reason': 'no-offenders'}
    if len(offenders) > 8:
        return None, {'reason': 'too-many-offenders', 'offenders': len(offenders)}

    neighbors = [pid for pid in geoms if pid not in offenders]
    neighbors.sort(key=lambda pid: _neighbor_rank(pid, offenders, geoms, gap))

    subsets = []
    # Start with the two offenders alone, then absorb their nearest physical blockers.
    for extra in range(0, min(7, len(neighbors))+1):
        subset = tuple(offenders + neighbors[:extra])
        if len(subset) <= 9 and subset not in subsets:
            subsets.append(subset)

    best = None
    best_width = float('inf')
    tested = 0
    empty_first_piece = None

    for subset in subsets:
        if time.time() >= deadline:
            break
        evac = set(subset)
        fixed = {pid: g for pid, g in geoms.items() if pid not in evac}
        if any(g.bounds[2] > w + .35 for g in fixed.values()):
            continue

        # Place the most constrained/right-most pieces first, not simply largest-area first.
        order = sorted(subset, key=lambda pid: (-geoms[pid].bounds[2], -(geoms[pid].area or 0.0)))
        beam = [(max((g.bounds[2] for g in fixed.values()), default=0.0), {}, fixed)]

        for pid in order:
            if time.time() >= deadline:
                beam = []
                break
            next_beam = []
            for _, placed, occupied in beam[:14]:
                candidates = _insert_candidates_v6(pid, parts, geoms, poses, occupied, gap, w, h, limit=18)
                tested += len(candidates)
                if not candidates and not placed and empty_first_piece is None:
                    empty_first_piece = pid
                for score, pose, g in candidates:
                    new_placed = dict(placed)
                    new_placed[pid] = (pose, g)
                    new_occupied = dict(occupied)
                    new_occupied[pid] = g
                    width = max((og.bounds[2] for og in new_occupied.values()), default=0.0)
                    movement = abs(g.bounds[0]-geoms[pid].bounds[0]) + abs(g.bounds[1]-geoms[pid].bounds[1])
                    next_beam.append(((width, movement, score[0]), new_placed, new_occupied))
            next_beam.sort(key=lambda row: row[0])
            beam = [(row[0][0], row[1], row[2]) for row in next_beam[:14]]
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
        return None, {
            'reason': 'beam-no-solution',
            'offenders': len(offenders),
            'testedCandidates': tested,
            'subsetsTried': len(subsets),
            'emptyFirstPiece': empty_first_piece,
        }

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
    result['repairStrategy'] = 'frontier-blocker-aware-v6'
    return result, {
        'reason': 'success' if result['fits'] else 'best-still-wide',
        'testedCandidates': tested,
        'subsetsTried': len(subsets),
        'widthMm': round(best_width, 3),
    }


# Patch V5 in-place so its proven schedule/metrics stay unchanged while only the
# failing frontier repair is replaced.
v5._insert_candidates = _insert_candidates_v6
v5._frontier_repack = _frontier_repack_v6
run_exact_with_repair = v5.run_exact_with_repair

__all__ = ['run_exact_with_repair']
