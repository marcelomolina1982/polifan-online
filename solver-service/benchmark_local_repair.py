import math
import time
from copy import deepcopy

from shapely.affinity import rotate as shp_rotate, translate as shp_translate


def _placement_key(p):
    return str(p.get('instanceId') or '')


def _part_map(kits):
    return {str(p.get('instanceId')): p for k in kits for p in (k.get('parts') or [])}


def _geom_from_placement(part, placement):
    g = shp_rotate(part['geom'], float(placement.get('angle') or 0.0), origin=(0, 0), use_radians=False)
    g = shp_translate(g, xoff=float(placement.get('xCm') or 0.0) * 10.0, yoff=float(placement.get('yCm') or 0.0) * 10.0)
    return g


def _inside(g, width_mm, height_mm, tol=0.35):
    minx, miny, maxx, maxy = g.bounds
    return minx >= -tol and miny >= -tol and maxx <= width_mm + tol and maxy <= height_mm + tol


def _clear(g, placed, gap_mm):
    for other in placed:
        if g.distance(other) < gap_mm - 0.001:
            return False
    return True


def _candidate_positions(part, placed_geoms, gap_mm, width_mm, height_mm, original, max_keep=42):
    angles = []
    original_angle = float(original.get('angle') or 0.0)
    for a in [original_angle] + [float(x) for x in range(0, 360, 15)]:
        a = a % 360.0
        if all(abs(a - b) > 1e-6 for b in angles):
            angles.append(a)

    x_edges = [0.0]
    y_edges = [0.0]
    for g in placed_geoms:
        minx, miny, maxx, maxy = g.bounds
        x_edges.extend([maxx + gap_mm, minx - gap_mm])
        y_edges.extend([maxy + gap_mm, miny - gap_mm])

    candidates = []
    seen = set()
    for angle in angles:
        rg = shp_rotate(part['geom'], angle, origin=(0, 0), use_radians=False)
        rminx, rminy, rmaxx, rmaxy = rg.bounds
        rw = rmaxx - rminx
        rh = rmaxy - rminy
        if rw > width_mm + 0.35 or rh > height_mm + 0.35:
            continue

        xs = [0.0, width_mm - rw]
        ys = [0.0, height_mm - rh]
        for x in x_edges:
            xs.extend([x, x - rw])
        for y in y_edges:
            ys.extend([y, y - rh])

        ox = float(original.get('xCm') or 0.0) * 10.0 + rminx
        oy = float(original.get('yCm') or 0.0) * 10.0 + rminy
        xs.append(max(0.0, min(width_mm - rw, ox)))
        ys.append(max(0.0, min(height_mm - rh, oy)))

        xs = sorted(set(round(max(0.0, min(width_mm - rw, x)), 3) for x in xs if math.isfinite(x)))
        ys = sorted(set(round(max(0.0, min(height_mm - rh, y)), 3) for y in ys if math.isfinite(y)))

        for x in xs:
            for y in ys:
                key = (round(angle, 3), round(x, 3), round(y, 3))
                if key in seen:
                    continue
                seen.add(key)
                tx = x - rminx
                ty = y - rminy
                g = shp_translate(rg, xoff=tx, yoff=ty)
                if not _inside(g, width_mm, height_mm):
                    continue
                if not _clear(g, placed_geoms, gap_mm):
                    continue
                _, _, maxx, _ = g.bounds
                score = (
                    maxx,
                    abs(x - max(0.0, min(width_mm - rw, ox))) + abs(y - max(0.0, min(height_mm - rh, oy))),
                    y,
                    x,
                )
                candidates.append((score, {
                    'angle': angle,
                    'xCm': tx / 10.0,
                    'yCm': ty / 10.0,
                }, g))

    candidates.sort(key=lambda row: row[0])
    return candidates[:max_keep]


def _repair_subset(kits, base_result, movable_ids, gap_mm, width_mm, height_mm, deadline):
    parts = _part_map(kits)
    original = {str(p.get('instanceId')): deepcopy(p) for p in (base_result.get('placements') or [])}
    if not original or any(pid not in original or pid not in parts for pid in movable_ids):
        return None

    fixed_ids = [pid for pid in original if pid not in movable_ids]
    fixed_geoms = [_geom_from_placement(parts[pid], original[pid]) for pid in fixed_ids]
    if any(not _inside(g, width_mm, height_mm) for g in fixed_geoms):
        return None

    order = sorted(
        movable_ids,
        key=lambda pid: (
            -float(parts[pid].get('area') or 0.0),
            -_geom_from_placement(parts[pid], original[pid]).bounds[2],
        ),
    )

    chosen = {}

    def backtrack(idx, placed_geoms):
        if time.time() >= deadline:
            return False
        if idx >= len(order):
            return True
        pid = order[idx]
        part = parts[pid]
        candidates = _candidate_positions(part, placed_geoms, gap_mm, width_mm, height_mm, original[pid])
        for _, pose, geom in candidates:
            chosen[pid] = (pose, geom)
            if backtrack(idx + 1, placed_geoms + [geom]):
                return True
            chosen.pop(pid, None)
        return False

    if not backtrack(0, fixed_geoms):
        return None

    placements = []
    maxx = 0.0
    for p in (base_result.get('placements') or []):
        pid = str(p.get('instanceId'))
        q = deepcopy(p)
        if pid in chosen:
            pose, geom = chosen[pid]
            q['angle'] = pose['angle']
            q['xCm'] = pose['xCm']
            q['yCm'] = pose['yCm']
        else:
            geom = _geom_from_placement(parts[pid], q)
        maxx = max(maxx, float(geom.bounds[2]))
        placements.append(q)

    result = deepcopy(base_result)
    result['placements'] = placements
    result['stripWidthMm'] = maxx
    result['fits'] = maxx <= width_mm + 0.5
    result['repairApplied'] = True
    result['repairMovedPieces'] = len(movable_ids)
    return result


def _local_repair(kits, base_result, gap_mm, width_mm, height_mm, seconds=55):
    placements = base_result.get('placements') or []
    parts = _part_map(kits)
    if not placements or len(placements) != len(parts):
        return None

    rows = []
    for p in placements:
        pid = _placement_key(p)
        part = parts.get(pid)
        if not part:
            return None
        g = _geom_from_placement(part, p)
        rows.append((pid, g, float(part.get('area') or 0.0)))

    offenders = [pid for pid, g, _ in rows if g.bounds[2] > width_mm + 0.35]
    rightmost = [pid for pid, _, _ in sorted(rows, key=lambda r: r[1].bounds[2], reverse=True)]
    deadline = time.time() + max(8, int(seconds))

    subsets = []
    base = []
    for pid in offenders:
        if pid not in base:
            base.append(pid)
    for extra_count in range(0, 6):
        s = list(base)
        for pid in rightmost:
            if pid not in s:
                s.append(pid)
            if len(s) >= len(base) + extra_count:
                break
        if s and len(s) <= 8 and s not in subsets:
            subsets.append(s)

    best = None
    for movable in subsets:
        if time.time() >= deadline:
            break
        repaired = _repair_subset(kits, base_result, movable, gap_mm, width_mm, height_mm, deadline)
        if repaired is None:
            continue
        if repaired.get('fits'):
            return repaired
        if best is None or float(repaired.get('stripWidthMm') or 1e18) < float(best.get('stripWidthMm') or 1e18):
            best = repaired
    return best


def run_exact_with_repair(kits, budget=185):
    import benchmark_routes as br

    started = time.time()
    attempts = []
    best_fit = None
    best_near = None

    schedule = [
        (1777, False, 34),
        (3911, False, 30),
        (1777, True, 30),
        (907, True, 28),
    ]

    for seed, continuous, seconds in schedule:
        remaining = budget - (time.time() - started)
        if remaining < 20:
            break
        seconds = min(seconds, max(8, int(remaining - 12)))
        result = br.core._run_sparrow(kits, br.GAP_MM, seconds, seed, continuous=continuous)
        m = br._metrics(kits, result) if result.get('ok') else {}
        attempts.append({
            'seed': seed,
            'rotation': 'continua' if continuous else '15deg',
            'seconds': seconds,
            'phase': 'sparrow',
            'fits': bool(result.get('fits')),
            'stripWidthMm': m.get('stripWidthMm'),
            'stripWidthUsagePct': m.get('stripWidthUsagePct'),
            'geometricOccupancyPct': m.get('geometricOccupancyPct'),
            'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
            'error': result.get('error'),
        })
        if result.get('ok'):
            if result.get('fits'):
                if best_fit is None or float(result.get('stripWidthMm') or 1e18) < float(best_fit.get('stripWidthMm') or 1e18):
                    best_fit = result
            elif len(result.get('placements') or []) == sum(len(k.get('parts') or []) for k in kits):
                if best_near is None or float(result.get('stripWidthMm') or 1e18) < float(best_near.get('stripWidthMm') or 1e18):
                    best_near = result

    if best_fit is not None:
        return best_fit, attempts, round(time.time() - started, 2)

    if best_near is not None:
        remaining = budget - (time.time() - started)
        if remaining >= 10:
            repaired = _local_repair(
                kits,
                best_near,
                br.GAP_MM,
                br.PLATE_WIDTH_MM,
                br.PLATE_HEIGHT_MM,
                seconds=min(55, max(8, int(remaining - 2))),
            )
            if repaired is not None:
                m = br._metrics(kits, repaired)
                attempts.append({
                    'seed': None,
                    'rotation': 'local-backtracking',
                    'seconds': round(time.time() - started, 2),
                    'phase': 'local-repair',
                    'fits': bool(repaired.get('fits')),
                    'stripWidthMm': m.get('stripWidthMm'),
                    'stripWidthUsagePct': m.get('stripWidthUsagePct'),
                    'geometricOccupancyPct': m.get('geometricOccupancyPct'),
                    'materialInsideUsedStripPct': m.get('materialInsideUsedStripPct'),
                    'movedPieces': repaired.get('repairMovedPieces'),
                    'error': None,
                })
                if repaired.get('fits'):
                    return repaired, attempts, round(time.time() - started, 2)

    return None, attempts, round(time.time() - started, 2)
