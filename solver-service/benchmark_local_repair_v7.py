import math
import time

from shapely.affinity import rotate as shp_rotate

import benchmark_local_repair_v4 as v4
import benchmark_local_repair_v6 as v6


# Hard per-candidate-search guard. V6 could spend many minutes inside one
# _insert_candidates_v6 call, so the outer frontier deadline was never reached.
PER_CALL_SECONDS = 1.15
MAX_TESTED_POSES = 5200
MAX_X = 72
MAX_Y = 84


def _bounded_insert_candidates(pid, parts, original_geoms, original_poses, occupied, gap, w, h, limit=18):
    started = time.time()
    deadline = started + PER_CALL_SECONDS

    part = parts[pid]
    current = original_geoms[pid]
    cminx, cminy, _, _ = current.bounds
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
    tested = 0

    for angle in angles:
        if time.time() >= deadline or tested >= MAX_TESTED_POSES:
            break

        rg = shp_rotate(part['geom'], angle, origin=(0, 0), use_radians=False)
        rminx, rminy, rmaxx, rmaxy = rg.bounds
        rw, rh = rmaxx-rminx, rmaxy-rminy
        if rw > w + .35 or rh > h + .35:
            continue

        maxx = max(0.0, w-rw)
        maxy = max(0.0, h-rh)
        xs = [0.0, maxx, max(0.0, min(maxx, cminx))]
        ys = [0.0, maxy, max(0.0, min(maxy, cminy))]

        # Keep V6's useful dense local search around the current frontier.
        for step in (2.5, 5.0, 10.0):
            for k in range(0, 25):
                xs.append(cminx - k*step)
        for step in (2.5, 5.0, 10.0):
            for k in range(-14, 15):
                ys.append(cminy + k*step)

        # Keep obstacle-edge anchors, but prune later by distance to current pose.
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

        ys.extend(i*10.0 for i in range(int(maxy//10.0)+1))

        xs = sorted(
            set(round(max(0.0, min(maxx, x)), 3) for x in xs if math.isfinite(x)),
            key=lambda x: (abs(x-cminx), x),
        )[:MAX_X]
        ys = sorted(
            set(round(max(0.0, min(maxy, y)), 3) for y in ys if math.isfinite(y)),
            key=lambda y: (abs(y-cminy), y),
        )[:MAX_Y]

        angle_hits = 0
        for x in xs:
            if time.time() >= deadline or tested >= MAX_TESTED_POSES:
                break
            for y in ys:
                tested += 1
                if (tested & 31) == 0 and time.time() >= deadline:
                    break

                key = (angle, x, y)
                if key in seen:
                    continue
                seen.add(key)

                pose, g = v6._candidate_pose(part, angle, x, y)
                if not v4._inside(g, w, h):
                    continue
                if not v4._clear(g, obstacles, gap):
                    continue

                movement = abs(g.bounds[0]-cminx) + abs(g.bounds[1]-cminy)
                score = (
                    g.bounds[2],
                    movement,
                    abs(g.bounds[1]-cminy),
                    v6._angle_delta(angle, a0),
                )
                found.append((score, pose, g))
                angle_hits += 1
                if angle_hits >= 8:
                    break
            if angle_hits >= 8:
                break

        if len(found) >= limit * 5:
            break

    found.sort(key=lambda row: row[0])
    return found[:limit]


# Frontier V6 resolves this function through its module globals at runtime, so
# patching it here makes every beam expansion obey the hard guard above.
v6._insert_candidates_v6 = _bounded_insert_candidates


def run_exact_with_repair(kits, budget=185):
    # Interactive lab guard: keep the complete attempt under a sane envelope.
    # The expensive inner frontier calls now also have their own hard deadline.
    return v6.run_exact_with_repair(kits, budget=min(110, int(budget or 110)))


__all__ = ['run_exact_with_repair']
