from flask import request, jsonify
import time
import nest_sparrow as ns
from shapely.affinity import rotate
from shapely.ops import unary_union
from fixed_hole_fill import try_add_complete_fixed, _placed_geometry, _safe_plate, _all_polygons

# Se captura el motor YA parcheado por intelligent_selector_runtime.
# Si esta capa falla por cualquier motivo, SIEMPRE se devuelve esa respuesta base intacta.
_base_nest = ns.nest_sparrow
ANGLES = tuple(float(a) for a in range(0, 360, 15))
MAX_GROWTH = 5                 # 10 -> 15 como techo; normalmente debería cortar al llegar a 80%
MAX_HOLE_CANDIDATES = 18       # sólo las mejores pasan al colocador real
MAX_PREPARED_KITS = 180        # usar la cola real, no sólo las primeras 64
MAX_GROWTH_SECONDS = 48.0      # presupuesto separado: nunca monopolizar Render
TARGET_DENSITY = 80.0
PLATE_AREA = 1220.0 * 580.0


def _unwrap(value):
    status = 200
    resp = value
    if isinstance(value, tuple):
        resp = value[0]
        if len(value) > 1 and isinstance(value[1], int):
            status = value[1]
    try:
        data = resp.get_json()
    except Exception:
        data = None
    try:
        status = int(getattr(resp, 'status_code', status) or status)
    except Exception:
        pass
    return resp, status, data


def _occupied_from_result(selected, result):
    part_by_instance = {}
    for kit in selected:
        for part in kit.get('parts') or []:
            part_by_instance[str(part.get('instanceId') or '')] = part
    geoms = []
    plate = _safe_plate()
    for placement in result.get('placements') or []:
        part = part_by_instance.get(str(placement.get('instanceId') or ''))
        if part is None:
            return None
        geom = _placed_geometry(part, placement)
        if not plate.covers(geom):
            return None
        geoms.append(geom)
    return unary_union(geoms) if geoms else None


def _free_regions(selected, result, gap_mm):
    occupied = _occupied_from_result(selected, result)
    if occupied is None:
        return []
    forbidden = occupied.buffer(float(gap_mm) / 2.0, join_style=2)
    free = _safe_plate().difference(forbidden)
    return sorted(_all_polygons(free), key=lambda g: g.area, reverse=True)[:24]


def _part_hole_options(part, regions):
    """Devuelve varios huecos/ángulos plausibles; es prefiltro barato, no certificación."""
    geom = part.get('geom')
    if geom is None or geom.is_empty:
        return []
    out = []
    for angle in ANGLES:
        rg = rotate(geom, angle, origin=(0, 0), use_radians=False)
        minx, miny, maxx, maxy = rg.bounds
        w = maxx - minx
        h = maxy - miny
        area = max(1.0, float(getattr(rg, 'area', 1.0)))
        for region_index, region in enumerate(regions):
            rx0, ry0, rx1, ry1 = region.bounds
            rw = rx1 - rx0
            rh = ry1 - ry0
            if w > rw + 1e-6 or h > rh + 1e-6:
                continue
            slack = max(0.0, rw - w) + max(0.0, rh - h)
            fill = area / max(area, float(region.area))
            out.append((slack, -fill, region_index, angle, float(region.area)))
    out.sort()
    return out[:8]


def _rank_candidates(selected, all_kits, result, gap_mm):
    regions = _free_regions(selected, result, gap_mm)
    if not regions:
        return [], {'holeCount': 0, 'compatible': 0, 'discarded': 0}
    used = {str(k.get('kitId') or '') for k in selected}
    current_density = float(result.get('density') or 0)
    missing_area = max(0.0, (TARGET_DENSITY - current_density) * PLATE_AREA / 100.0)
    ranked = []
    discarded = 0

    for kit in all_kits:
        if str(kit.get('kitId') or '') in used:
            continue
        parts = list(kit.get('parts') or [])
        if not parts:
            discarded += 1
            continue
        option_sets = [_part_hole_options(part, regions) for part in parts]
        if any(not opts for opts in option_sets):
            discarded += 1
            continue

        # Evitar falsos positivos obvios: si base+tapa sólo parecen caber en el mismo hueco,
        # ese hueco debe tener área suficiente para ambas piezas + margen geométrico.
        if len(option_sets) >= 2:
            viable_pair = False
            for a in option_sets[0]:
                for b in option_sets[1]:
                    if a[2] != b[2]:
                        viable_pair = True
                        break
                    region_area = a[4]
                    parts_area = sum(float(p.get('area') or 0) for p in parts)
                    if parts_area <= region_area * 0.86:
                        viable_pair = True
                        break
                if viable_pair:
                    break
            if not viable_pair:
                discarded += 1
                continue

        best_opts = [opts[0] for opts in option_sets]
        total_slack = sum(opt[0] for opt in best_opts)
        total_fill_bonus = -sum(opt[1] for opt in best_opts)
        kit_area = float(kit.get('area') or sum(float(p.get('area') or 0) for p in parts))
        # Prioridad productiva: acercarse al área que falta para 80% sin desperdiciar el hueco.
        area_gap = abs(missing_area - kit_area) if missing_area > 0 else 0.0
        overshoot_penalty = max(0.0, kit_area - missing_area) * 0.12 if missing_area > 0 else 0.0
        priority = float(kit.get('priority') or 999999)
        # El área útil pesa antes que la holgura: necesitamos dejar de aceptar placas de 70%.
        score = (area_gap + overshoot_penalty, total_slack * 35.0, -kit_area, -total_fill_bonus, priority)
        ranked.append((score, kit))

    ranked.sort(key=lambda row: row[0])
    ordered = [kit for _, kit in ranked[:MAX_HOLE_CANDIDATES]]
    return ordered, {
        'holeCount': len(regions),
        'compatible': len(ranked),
        'discarded': discarded,
        'testedPool': len(ordered),
        'currentDensity': round(current_density, 2),
        'missingAreaTo80Mm2': round(missing_area, 1),
        'topCandidates': [str(k.get('figure') or '') for k in ordered[:10]],
    }


def _build_prepared_kits(data):
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:MAX_PREPARED_KITS]
    kits = []
    for raw_kit in raw:
        try:
            kits.append(ns._prep_kit(raw_kit, width_mm, height_mm))
        except Exception:
            pass
    return kits


def nest_with_safe_hole_growth():
    original = _base_nest()
    resp, status, payload = _unwrap(original)
    if status >= 400 or not isinstance(payload, dict) or not payload.get('ok'):
        return original
    if int(payload.get('completeFigures') or 0) != 10 or payload.get('partialExtra'):
        return original

    try:
        validator = getattr(ns, '_validate_final_geometry', None)
        if not callable(validator):
            return original

        growth_started = time.monotonic()
        data = request.get_json(silent=True) or {}
        gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
        kits = _build_prepared_kits(data)
        if len(kits) < 11:
            return original

        selected_ids = []
        for placement in payload.get('placements') or []:
            kid = str(placement.get('kitId') or '')
            if kid and kid not in selected_ids:
                selected_ids.append(kid)
        kit_map = {str(k.get('kitId') or ''): k for k in kits}
        selected = [kit_map[kid] for kid in selected_ids if kid in kit_map]
        if len(selected) != 10:
            return original

        result = {
            'fits': True,
            'density': float(payload.get('density') or 0),
            'stripWidthMm': float(payload.get('stripWidthMm') or 1220),
            'placements': list(payload.get('placements') or []),
            'solverDensity': payload.get('solverDensity'),
            'continuousRotation': False,
        }
        best_selected = list(selected)
        best_result = dict(result)
        best_certificate = payload.get('productionCertificate') or {}
        added = []
        growth_diagnostics = []

        for stage in range(MAX_GROWTH):
            if float(best_result.get('density') or 0) >= TARGET_DENSITY:
                break
            if time.monotonic() - growth_started >= MAX_GROWTH_SECONDS:
                growth_diagnostics.append({'stage': stage + 1, 'stopped': 'growth time budget reached'})
                break

            ranked, diag = _rank_candidates(best_selected, kits, best_result, gap)
            diag['stage'] = stage + 1
            diag['fromCompleteFigures'] = len(best_selected)
            growth_diagnostics.append(diag)
            if not ranked:
                break

            accepted = None
            # Se prueba la lista ya filtrada. Cada intento sigue siendo independiente y reversible.
            for candidate in ranked:
                if time.monotonic() - growth_started >= MAX_GROWTH_SECONDS:
                    break
                grown = try_add_complete_fixed(
                    best_selected,
                    best_result,
                    best_selected + [candidate],
                    gap,
                    max_candidates=1,
                )
                if not grown:
                    continue
                candidate_selected, candidate_result, added_kit = grown
                valid, certificate = validator(candidate_selected, candidate_result)
                if not valid:
                    continue
                accepted = (candidate_selected, candidate_result, added_kit, certificate)
                break

            if accepted is None:
                break

            best_selected, best_result, added_kit, best_certificate = accepted
            added.append(str(added_kit.get('figure') or ''))

        elapsed = round(time.monotonic() - growth_started, 2)
        if not added:
            out = dict(payload)
            out.update({
                'bestSolutionPreserved': True,
                'safeHoleGrowth': True,
                'safeHoleGrowthAdded': [],
                'holeAnalysis': growth_diagnostics,
                'growthElapsedSeconds': elapsed,
                'growthStatus': 'sin figura completa compatible; se conserva base 10',
            })
            return jsonify(out)

        out = dict(payload)
        final_density = float(best_result.get('density') or 0)
        out.update({
            'engine': 'Selector inteligente + Sparrow + crecimiento seguro por huecos + V1.7',
            'completeFigures': len(best_selected),
            'placements': best_result.get('placements') or [],
            'density': final_density,
            'stripWidthMm': float(best_result.get('stripWidthMm') or 0),
            'selectionStrategy': str(payload.get('selectionStrategy') or '') + ' · huecos: ' + ', '.join(added),
            'targetDensityReached': final_density >= TARGET_DENSITY,
            'safeHoleGrowth': True,
            'safeHoleGrowthAdded': added,
            'holeAnalysis': growth_diagnostics,
            'growthElapsedSeconds': elapsed,
            'bestSolutionPreserved': True,
            'minimumGapMm': best_certificate.get('minimumGapMmCertified'),
            'requiredGapMm': 3.0,
            'productionCertificate': best_certificate,
        })
        return jsonify(out)
    except Exception as exc:
        try:
            out = dict(payload)
            out.update({
                'bestSolutionPreserved': True,
                'safeHoleGrowth': True,
                'safeHoleGrowthAdded': [],
                'growthStatus': 'optimización omitida; se conserva base 10',
                'growthDiagnosticError': str(exc)[:220],
            })
            return jsonify(out)
        except Exception:
            return original


if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = nest_with_safe_hole_growth
