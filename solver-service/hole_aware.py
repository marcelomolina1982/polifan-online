import math, time
from functools import lru_cache

import app as core
from flask import request, jsonify
from shapely.geometry import box
from shapely.ops import unary_union
from shapely.affinity import rotate as affinity_rotate, translate

app = core.app


def _kit_id(k, i=0):
    return str(k.get('kitId') or f'kit-{i}')


def _kit_load(k):
    total = 0.0
    for p in (k.get('parts') or []):
        w = max(0.0, core._n(p.get('sourceWidthCm') or p.get('widthCm')))
        h = max(0.0, core._n(p.get('sourceHeightCm') or p.get('heightCm')))
        total += w * h * 100.0
    return total


def _part_geometry(part, simplify_mm=0.42, max_vertices=150):
    w = core._n(part.get('sourceWidthCm') or part.get('widthCm'))
    h = core._n(part.get('sourceHeightCm') or part.get('heightCm'))
    if w <= 0 or h <= 0 or not part.get('svgText'):
        return None
    geom, _, _ = core.svg_to_geometry(
        part['svgText'], w, h,
        solver_tolerance_mm=simplify_mm,
        max_vertices=max_vertices,
    )
    return geom


def _placement_free_geometry(result, kits, width_mm, height_mm, spacing_mm):
    by_instance = {}
    for k in kits:
        for p in (k.get('parts') or []):
            iid = str(p.get('instanceId') or '')
            if iid:
                by_instance[iid] = p

    occupied = []
    for pl in (result or {}).get('placements', []):
        p = by_instance.get(str(pl.get('instanceId') or ''))
        if not p:
            continue
        try:
            g = _part_geometry(p)
            if g is None or g.is_empty:
                continue
            angle = core._n(pl.get('angle'))
            g = affinity_rotate(g, angle, origin=(0, 0), use_radians=False)
            g = translate(
                g,
                xoff=core._n(pl.get('xCm')) * 10.0,
                yoff=core._n(pl.get('yCm')) * 10.0,
            )
            occupied.append(g)
        except Exception:
            continue

    plate = box(0, 0, width_mm, height_mm)
    if not occupied:
        return plate
    occ = unary_union(occupied)
    pad = max(0.0, spacing_mm / 2.0)
    if pad:
        occ = occ.buffer(pad, join_style=2)
    free = plate.difference(occ)
    if not free.is_valid:
        free = free.buffer(0)
    return free


def _free_components(free, min_area=120.0):
    if free.is_empty:
        return []
    geoms = list(free.geoms) if hasattr(free, 'geoms') else [free]
    out = [g for g in geoms if not g.is_empty and g.area >= min_area]
    out.sort(key=lambda g: g.area, reverse=True)
    return out


def _candidate_positions(geom, region, rotation_step=15, max_positions=10):
    found = []
    step = max(5, min(45, int(rotation_step or 15)))
    angles = range(0, 360, step)
    rminx, rminy, rmaxx, rmaxy = region.bounds
    rw, rh = rmaxx-rminx, rmaxy-rminy

    for angle in angles:
        rg = affinity_rotate(geom, angle, origin=(0, 0), use_radians=False)
        minx, miny, maxx, maxy = rg.bounds
        w, h = maxx-minx, maxy-miny
        if w > rw + 1e-6 or h > rh + 1e-6 or rg.area > region.area + 1e-6:
            continue
        rg = translate(rg, xoff=-minx, yoff=-miny)
        anchors = [
            (rminx, rminy),
            (rmaxx-w, rminy),
            (rminx, rmaxy-h),
            (rmaxx-w, rmaxy-h),
            (rminx + (rw-w)/2.0, rminy + (rh-h)/2.0),
        ]
        c = region.centroid
        anchors.append((c.x-w/2.0, c.y-h/2.0))
        for x, y in anchors:
            placed = translate(rg, xoff=x, yoff=y)
            try:
                if region.covers(placed):
                    waste = max(0.0, region.area - placed.area)
                    found.append((waste, placed, angle))
                    if len(found) >= max_positions:
                        return sorted(found, key=lambda z: z[0])[:max_positions]
            except Exception:
                pass
    return sorted(found, key=lambda z: z[0])[:max_positions]


def _kit_hole_score(kit, free, spacing_mm, rotation_step=15):
    parts = kit.get('parts') or []
    if not parts:
        return -1e18, {'fits': False, 'reason': 'sin-partes'}
    try:
        geoms = [_part_geometry(p) for p in parts]
    except Exception:
        return -1e18, {'fits': False, 'reason': 'geometria'}
    if any(g is None or g.is_empty for g in geoms):
        return -1e18, {'fits': False, 'reason': 'geometria'}

    pad = max(0.0, spacing_mm / 2.0)
    geoms = [g.buffer(pad, join_style=2) if pad else g for g in geoms]
    if sum(g.area for g in geoms) > free.area + 1e-6:
        return -1e18, {'fits': False, 'reason': 'area'}

    order = sorted(range(len(geoms)), key=lambda i: geoms[i].area, reverse=True)
    regions = _free_components(free, min_area=80.0)
    if not regions:
        return -1e18, {'fits': False, 'reason': 'sin-huecos'}

    first_i = order[0]
    first_candidates = []
    for ri, region in enumerate(regions[:10]):
        for waste, placed, angle in _candidate_positions(geoms[first_i], region, rotation_step, 6):
            first_candidates.append((waste, placed, angle, ri))
    first_candidates.sort(key=lambda z: z[0])
    first_candidates = first_candidates[:16]
    if not first_candidates:
        return -1e18, {'fits': False, 'reason': 'parte-principal'}

    best = None
    for first_waste, first_placed, first_angle, _ in first_candidates:
        residual = free.difference(first_placed)
        if not residual.is_valid:
            residual = residual.buffer(0)
        total_waste = first_waste
        placements = 1
        ok = True
        for oi in order[1:]:
            candidates = []
            for region in _free_components(residual, min_area=60.0)[:10]:
                candidates.extend(_candidate_positions(geoms[oi], region, rotation_step, 5))
            if not candidates:
                ok = False
                break
            candidates.sort(key=lambda z: z[0])
            waste, placed, _ = candidates[0]
            total_waste += waste
            placements += 1
            residual = residual.difference(placed)
            if not residual.is_valid:
                residual = residual.buffer(0)
        if ok:
            score = 1_000_000.0 - total_waste - 0.05 * _kit_load(kit)
            if best is None or score > best[0]:
                best = (score, placements)

    if best is None:
        return -1e18, {'fits': False, 'reason': 'par-no-entra'}
    return best[0], {
        'fits': True,
        'parts': len(parts),
        'freeAreaMm2': round(free.area, 1),
        'score': round(best[0], 1),
    }


def _legacy_variants(pool, target, limit=10):
    target = max(1, min(int(target), len(pool)))
    window = pool[:min(len(pool), target+10)]
    variants, seen = [], set()

    def add(rows, label):
        rows = list(rows)[:target]
        if len(rows) != target:
            return
        key = tuple(_kit_id(k) for k in rows)
        if key in seen:
            return
        seen.add(key)
        variants.append((label, rows))

    add(pool[:target], 'prioridad')
    add(sorted(window, key=lambda k:(core._n(k.get('priority'),999999), _kit_load(k), str(k.get('date') or ''))), 'prioridad+compactos')
    base = list(pool[:target])
    extras = list(pool[target:min(len(pool), target+8)])
    removable = sorted(range(len(base)), key=lambda i:_kit_load(base[i]), reverse=True)[:5]
    for ei, extra in enumerate(extras[:6]):
        for ri in removable[:4]:
            c = list(base); c[ri] = extra
            c = sorted(c, key=lambda k:(core._n(k.get('priority'),999999), str(k.get('date') or ''), str(k.get('figure') or '')))
            add(c, f'swap-{ri}-{ei}')
    return variants[:limit]


def _selected_kit_ids(result):
    return {str(p.get('kitId')) for p in (result or {}).get('placements', []) if p.get('kitId') is not None}


def _hole_variants(pool, target, seed_result, width_mm, height_mm, spacing_mm, limit=8):
    if not seed_result or not seed_result.get('feasible'):
        return []
    selected_ids = _selected_kit_ids(seed_result)
    seed_rows = [k for k in pool if _kit_id(k) in selected_ids]
    if len(seed_rows) != target - 1:
        return []

    free = _placement_free_geometry(seed_result, pool, width_mm, height_mm, spacing_mm)
    ranked = []
    for k in pool:
        kid = _kit_id(k)
        if kid in selected_ids:
            continue
        score, diag = _kit_hole_score(k, free, spacing_mm, rotation_step=15)
        if diag.get('fits'):
            priority = core._n(k.get('priority'),999999)
            ranked.append((score - priority*0.01, k, diag))
    ranked.sort(key=lambda row: row[0], reverse=True)

    out = []
    for i, (_, k, diag) in enumerate(ranked[:limit]):
        rows = seed_rows + [k]
        rows = sorted(rows, key=lambda x:(core._n(x.get('priority'),999999), str(x.get('date') or ''), str(x.get('figure') or '')))
        out.append((f'huecos-rank-{i+1}', rows, diag))
    return out


def nest_hole_aware():
    started = time.time()
    try:
        data = request.get_json(silent=True) or {}
        job_id = data.get('jobId')
        core._job_update(job_id, 4, 'Preparando geometrías · motor hole-aware…')
        kits = data.get('kits') or []
        if not kits:
            raise ValueError('No llegaron figuras completas al motor industrial')

        width_mm = core._n(data.get('widthCm'),122)*10
        height_mm = core._n(data.get('heightCm'),58)*10
        spacing_mm = max(2.5, core._n(data.get('gapCm'),.3)*10)
        target_density = max(0.0, min(100.0, core._n(data.get('targetDensity'),80)))
        if width_mm <= 0 or height_mm <= 0:
            raise ValueError('La medida de la placa es inválida')

        kits = sorted(kits, key=lambda k:(core._n(k.get('priority'),999999), str(k.get('date') or ''), str(k.get('figure') or '')))
        pool = kits[:min(32,len(kits))]
        minimum = min(10,len(pool))
        attempts = []

        def packed_score(r):
            if not r or not r.get('feasible'):
                return (-1,-1,-1)
            return (int(r.get('target',0)), float(r.get('density',0) or 0), float(r.get('compactness',0) or 0))

        def run_rows(rows, target, step, seconds, stage, percent):
            core._job_update(job_id, percent, stage, requestedCompleteFigures=int(target))
            r = core.solve_prefix(
                rows, int(target), width_mm, height_mm, spacing_mm,
                seconds=max(2,seconds), rotation_step=step,
                simplify_mm=0.38 if step>=15 else 0.30,
                max_vertices=165 if step>=15 else 190,
            )
            attempts.append({
                'stage': stage,
                'ok': bool(r and r.get('feasible')),
                'completeFigures': int(r.get('target',0)) if r and r.get('feasible') else 0,
                'density': round(float((r or {}).get('density',0) or 0),2),
                'timeout': bool((r or {}).get('timeout')),
            })
            return r

        def search_legacy(target, step=15, seconds=5, max_variants=8, percent=30):
            best_local = None
            variants = _legacy_variants(pool,target,max_variants)
            for vi,(label,rows) in enumerate(variants):
                if time.time()-started > 132:
                    break
                r = run_rows(rows,target,step,seconds,f'{target} completas · {label}',percent)
                if packed_score(r) > packed_score(best_local):
                    best_local = r
                    if r and r.get('feasible'):
                        r['subsetLabel'] = label
                if best_local and int(best_local.get('target',0)) >= target:
                    break
            return best_local

        best = None
        base_target = min(len(pool), max(1, minimum))
        seed = None
        if base_target > 1:
            seed = search_legacy(base_target-1, step=15, seconds=4, max_variants=4, percent=10)

        hole_variants = _hole_variants(pool, base_target, seed, width_mm, height_mm, spacing_mm, limit=8)
        for vi,(label,rows,diag) in enumerate(hole_variants):
            if time.time()-started > 112:
                break
            r = run_rows(rows,base_target,10,5,f'{base_target} completas · análisis de huecos {vi+1}/{len(hole_variants)}',20+vi)
            attempts[-1]['selector'] = 'hole-aware'
            attempts[-1]['holeScore'] = diag.get('score')
            if packed_score(r) > packed_score(best):
                best = r
                if r and r.get('feasible'):
                    r['subsetLabel'] = label
            if best and best.get('feasible'):
                break

        if not best or not best.get('feasible'):
            fallback = search_legacy(base_target, step=15, seconds=5, max_variants=8, percent=36)
            if packed_score(fallback) > packed_score(best):
                best = fallback

        if not best or not best.get('feasible'):
            for target in range(base_target-1,0,-1):
                if time.time()-started > 118:
                    break
                candidate = search_legacy(target,step=15,seconds=5,max_variants=7,percent=45)
                if packed_score(candidate) > packed_score(best):
                    best = candidate
                if best and best.get('feasible'):
                    break

        if not best or not best.get('feasible'):
            raise RuntimeError('No se pudo generar una placa completa válida.')

        core._job_update(job_id, 55, f"Base guardada: {best.get('target',0)} figuras · {best.get('density',0):.1f}% real", completeFigures=int(best.get('target',0)))

        current = int(best.get('target',0))
        hard_cap = min(len(pool), max(current+6,16))
        failed_growth = 0
        while current < hard_cap and failed_growth < 2 and time.time()-started < 124:
            target = current + 1
            variants = _hole_variants(pool,target,best,width_mm,height_mm,spacing_mm,limit=7)
            improved = False
            for vi,(label,rows,diag) in enumerate(variants):
                if time.time()-started > 128:
                    break
                candidate = run_rows(rows,target,10,5,f'Subiendo a {target} · hueco compatible {vi+1}/{len(variants)}',62)
                attempts[-1]['selector'] = 'hole-aware'
                attempts[-1]['holeScore'] = diag.get('score')
                if packed_score(candidate) > packed_score(best):
                    best = candidate
                    current = target
                    failed_growth = 0
                    improved = True
                    core._job_update(job_id,74,f'¡Mejora! {current} completas · {best.get("density",0):.1f}% real',completeFigures=current)
                    break
            if not improved:
                fallback = search_legacy(target,step=10,seconds=4,max_variants=3,percent=70)
                if packed_score(fallback) > packed_score(best):
                    best = fallback
                    current = target
                    failed_growth = 0
                    improved = True
                else:
                    failed_growth += 1

        current = int(best.get('target',0))
        for step,seconds,percent in [(5,5,84),(10,4,90)]:
            if time.time()-started > 132:
                break
            candidate = search_legacy(current,step=step,seconds=seconds,max_variants=4,percent=percent)
            if packed_score(candidate) > packed_score(best):
                best = candidate

        core._job_update(job_id,97,f"Validando {spacing_mm:.1f} mm · {best.get('target',0)} figuras · {best.get('density',0):.1f}% real",completeFigures=int(best.get('target',0)))

        hole_attempts = [a for a in attempts if a.get('selector') == 'hole-aware']
        return jsonify(
            ok=True,
            engine='PackingSolver C++ · HOLE-AWARE KITS v22.2',
            selector='huecos → candidatas compatibles → PackingSolver',
            completeFigures=int(best.get('target',0)),
            placements=best['placements'],
            density=best['density'],
            compactness=best['compactness'],
            usedWidthMm=best['usedWidthMm'],
            usedHeightMm=best['usedHeightMm'],
            attempts=attempts,
            holeAwareAttempts=len(hole_attempts),
            partial=int(best.get('target',0))<minimum,
            minimumTarget=minimum,
            targetDensity=target_density,
            reachedMinimum=int(best.get('target',0))>=minimum,
            reachedDensity=float(best.get('density',0) or 0)>=target_density,
            elapsedSeconds=round(time.time()-started,2),
            rotationStep=best.get('rotationStep'),
            simplifyMm=best.get('simplifyMm'),
            candidatePool=len(pool),
        )
    except Exception as e:
        return jsonify(ok=False,error=str(e),elapsedSeconds=round(time.time()-started,2)),500


def health_hole_aware():
    return jsonify(ok=True,engine='PackingSolver C++',version='22.2-hole-aware',status='ready')


core.nest = nest_hole_aware
app.view_functions['nest'] = nest_hole_aware
if 'health' in app.view_functions:
    app.view_functions['health'] = health_hole_aware


if __name__ == '__main__':
    app.run(host='0.0.0.0',port=int(__import__('os').environ.get('PORT','10000')))
