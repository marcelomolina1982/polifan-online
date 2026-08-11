from flask import request, jsonify
import nest_sparrow as ns
from shapely.affinity import rotate
from shapely.ops import unary_union
from fixed_hole_fill import try_add_complete_fixed, _placed_geometry, _safe_plate, _all_polygons

# Se captura el motor YA parcheado por intelligent_selector_runtime.
# Si esta capa falla por cualquier motivo, SIEMPRE se devuelve esa respuesta base intacta.
_base_nest = ns.nest_sparrow
ANGLES = tuple(float(a) for a in range(0, 360, 15))
MAX_GROWTH = 3          # 10 -> 11 -> 12 -> 13 como máximo en esta etapa
MAX_HOLE_CANDIDATES = 14


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
    # Dos mitades de gap: la ocupación se expande gap/2 y el colocador expandirá
    # la pieza candidata otro gap/2. Este prefiltro sólo descarta imposibles.
    forbidden = occupied.buffer(float(gap_mm) / 2.0, join_style=2)
    free = _safe_plate().difference(forbidden)
    return sorted(_all_polygons(free), key=lambda g: g.area, reverse=True)[:18]


def _part_hole_score(part, regions):
    if not regions:
        return None
    best = None
    geom = part.get('geom')
    if geom is None or geom.is_empty:
        return None
    for angle in ANGLES:
        rg = rotate(geom, angle, origin=(0, 0), use_radians=False)
        minx, miny, maxx, maxy = rg.bounds
        w = maxx - minx
        h = maxy - miny
        for region_index, region in enumerate(regions):
            rx0, ry0, rx1, ry1 = region.bounds
            rw = rx1 - rx0
            rh = ry1 - ry0
            if w > rw + 1e-6 or h > rh + 1e-6:
                continue
            # Menor holgura = forma/tamaño más compatible con ese hueco.
            slack = max(0.0, rw - w) + max(0.0, rh - h)
            area_ratio = float(region.area) / max(1.0, float(getattr(rg, 'area', 1.0)))
            score = (slack, area_ratio, region_index, angle)
            if best is None or score < best:
                best = score
    return best


def _rank_candidates(selected, all_kits, result, gap_mm):
    regions = _free_regions(selected, result, gap_mm)
    if not regions:
        return [], {'holeCount': 0, 'compatible': 0, 'discarded': 0}
    used = {str(k.get('kitId') or '') for k in selected}
    ranked = []
    discarded = 0
    for kit in all_kits:
        if str(kit.get('kitId') or '') in used:
            continue
        part_scores = []
        possible = True
        for part in kit.get('parts') or []:
            s = _part_hole_score(part, regions)
            if s is None:
                possible = False
                break
            part_scores.append(s)
        if not possible or not part_scores:
            discarded += 1
            continue
        # Primero candidatas que encajan con poca holgura; luego piezas compactas.
        total_slack = sum(s[0] for s in part_scores)
        total_ratio = sum(s[1] for s in part_scores)
        priority = float(kit.get('priority') or 999999)
        envelope = float(kit.get('envelope') or 0)
        ranked.append(((total_slack, total_ratio, envelope, priority), kit))
    ranked.sort(key=lambda row: row[0])
    ordered = [kit for _, kit in ranked[:MAX_HOLE_CANDIDATES]]
    return ordered, {
        'holeCount': len(regions),
        'compatible': len(ranked),
        'discarded': discarded,
        'testedPool': len(ordered),
        'topCandidates': [str(k.get('figure') or '') for k in ordered[:8]],
    }


def _build_prepared_kits(data):
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:64]
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

    # Si cualquier línea de esta optimización falla, preservar la BASE 10 certificada.
    try:
        validator = getattr(ns, '_validate_final_geometry', None)
        if not callable(validator):
            return original

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
            ranked, diag = _rank_candidates(best_selected, kits, best_result, gap)
            diag['stage'] = stage + 1
            diag['fromCompleteFigures'] = len(best_selected)
            growth_diagnostics.append(diag)
            if not ranked:
                break

            accepted = None
            # Cada candidata se prueba por separado: el backtracking nunca recibe
            # figuras que el prefiltro geométrico ya considera imposibles.
            for candidate in ranked:
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

        if not added:
            # Importante: no es error. La placa base de 10 sigue siendo la mejor.
            out = dict(payload)
            out.update({
                'bestSolutionPreserved': True,
                'safeHoleGrowth': True,
                'safeHoleGrowthAdded': [],
                'holeAnalysis': growth_diagnostics,
                'growthStatus': 'sin figura completa compatible; se conserva base 10',
            })
            return jsonify(out)

        out = dict(payload)
        out.update({
            'engine': 'Selector inteligente + Sparrow + crecimiento seguro por huecos + V1.7',
            'completeFigures': len(best_selected),
            'placements': best_result.get('placements') or [],
            'density': float(best_result.get('density') or 0),
            'stripWidthMm': float(best_result.get('stripWidthMm') or 0),
            'selectionStrategy': str(payload.get('selectionStrategy') or '') + ' · huecos: ' + ', '.join(added),
            'targetDensityReached': float(best_result.get('density') or 0) >= 80.0,
            'safeHoleGrowth': True,
            'safeHoleGrowthAdded': added,
            'holeAnalysis': growth_diagnostics,
            'bestSolutionPreserved': True,
            'minimumGapMm': best_certificate.get('minimumGapMmCertified'),
            'requiredGapMm': 3.0,
            'productionCertificate': best_certificate,
        })
        return jsonify(out)
    except Exception as exc:
        # Fallo de la optimización ≠ fallo del motor. Nunca reemplazar una placa válida.
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
