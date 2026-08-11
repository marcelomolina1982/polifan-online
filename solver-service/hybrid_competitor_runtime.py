from flask import request, jsonify
import time
import nest_sparrow as ns

try:
    from pyckingsolver import InstanceBuilder, Objective, Solver
except Exception:
    InstanceBuilder = Objective = Solver = None

# Captura la cadena existente (selector + Sparrow + crecimiento seguro).
_base_nest = ns.nest_sparrow
PLATE_W = 1220.0
PLATE_H = 580.0
MIN_GAP = 3.0
MAX_COMPETITOR_SECONDS = 42.0
MAX_CANDIDATES = 6
ANGLES = [(float(a), float(a)) for a in range(0, 360, 15)]


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


def _prepare_all(data):
    width = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    raw = sorted(
        data.get('kits') or [],
        key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')),
    )[:180]
    out = []
    for row in raw:
        try:
            out.append(ns._prep_kit(row, width, height))
        except Exception:
            pass
    return out


def _selected_from_payload(payload, kits):
    ids = []
    for p in payload.get('placements') or []:
        kid = str(p.get('kitId') or '')
        if kid and kid not in ids:
            ids.append(kid)
    by_id = {str(k.get('kitId') or ''): k for k in kits}
    return [by_id[kid] for kid in ids if kid in by_id]


def _candidate_rank(base, kits):
    used = {str(k.get('kitId') or '') for k in base}
    remain = [k for k in kits if str(k.get('kitId') or '') not in used]
    # Para 11+, primero figuras compactas y sólidas; luego mayor área útil.
    remain.sort(key=lambda k: (
        float(k.get('envelope') or 1) / max(1.0, float(k.get('area') or 1)),
        -float(k.get('solidity') or 0),
        -float(k.get('area') or 0),
        float(k.get('priority') or 999999),
    ))
    return remain[:MAX_CANDIDATES]


def _run_packingsolver(selected, gap_mm, seconds):
    if InstanceBuilder is None or Solver is None:
        return None, 'pyckingsolver no disponible'
    try:
        builder = InstanceBuilder(Objective.OPEN_DIMENSION_X)
        builder.set_item_item_minimum_spacing(float(gap_mm))
        builder.add_bin_type_rectangle(PLATE_W, PLATE_H, copies=1, item_bin_minimum_spacing=0.0)
        part_map = {}
        item_type_id = 0
        for kit in selected:
            for part in kit.get('parts') or []:
                # Un item type por componente permite reconstruir exactamente la identidad.
                returned = builder.add_item_type(
                    part['geom'],
                    copies=1,
                    allowed_rotations=ANGLES,
                )
                # La API devuelve el id; si una versión no lo devuelve, el orden es estable.
                type_id = item_type_id if returned is None else int(returned)
                part_map[type_id] = part
                item_type_id += 1
        instance = builder.build()
        solver = Solver()
        solution = solver.solve(
            instance,
            time_limit=max(4, int(seconds)),
            verbosity_level=0,
            optimization_mode='Anytime',
            use_tree_search=True,
            use_sequential_single_knapsack=True,
            use_sequential_value_correction=True,
            use_column_generation=False,
            anchor=True,
            anchor_x_weight=1.0,
            anchor_y_weight=1.0,
        )
        items = solution.all_items()
        expected = sum(len(k.get('parts') or []) for k in selected)
        if len(items) != expected or solution.total_bins_used() != 1:
            return None, f'PackingSolver colocó {len(items)}/{expected} piezas'
        placements = []
        xmax = 0.0
        for item in items:
            part = part_map.get(int(item.item_type_id))
            if part is None:
                return None, 'PackingSolver devolvió un item_type desconocido'
            # x/y y angle son la transformación reportada por pyckingsolver.
            x = float(item.x)
            y = float(item.y)
            angle = float(item.angle)
            placements.append({
                'instanceId': part['instanceId'],
                'kitId': part['kitId'],
                'figure': part['figure'],
                'name': part['name'],
                'role': part['role'],
                'xCm': x / 10.0,
                'yCm': y / 10.0,
                'angle': angle,
                'trimXCm': part['trimXmm'] / 10.0,
                'trimYCm': part['trimYmm'] / 10.0,
                'partialExtra': False,
            })
            try:
                xmax = max(xmax, float(item.shapes[0].bounds[2]))
            except Exception:
                pass
        density = 100.0 * sum(float(k.get('area') or 0) for k in selected) / (PLATE_W * PLATE_H)
        return {
            'ok': True,
            'fits': xmax <= PLATE_W + 0.5,
            'placements': placements,
            'density': density,
            'stripWidthMm': xmax,
            'solverDensity': None,
            'continuousRotation': False,
            'source': 'packingsolver-irregular',
        }, None
    except Exception as exc:
        return None, str(exc)[:220]


def hybrid_competition():
    original = _base_nest()
    resp, status, payload = _unwrap(original)
    if status >= 400 or not isinstance(payload, dict) or not payload.get('ok'):
        return original
    if int(payload.get('completeFigures') or 0) < 10:
        return original

    started = time.time()
    diagnostics = []
    try:
        validator = getattr(ns, '_validate_final_geometry', None)
        if not callable(validator):
            out = dict(payload)
            out['hybridStatus'] = 'PackingSolver omitido: certificador no disponible'
            return jsonify(out)

        data = request.get_json(silent=True) or {}
        gap = max(MIN_GAP, ns._n(data.get('gapCm'), .3) * 10)
        kits = _prepare_all(data)
        base = _selected_from_payload(payload, kits)
        # Esta primera versión compite sobre una base de exactamente 10.
        if len(base) != 10:
            out = dict(payload)
            out['hybridStatus'] = 'PackingSolver omitido: no se pudo reconstruir la base 10'
            return jsonify(out)

        candidates = _candidate_rank(base, kits)
        best = None
        for idx, extra in enumerate(candidates):
            elapsed = time.time() - started
            remaining = MAX_COMPETITOR_SECONDS - elapsed
            if remaining < 5:
                break
            # Reacomoda las 10 + candidata desde cero; no depende de huecos fijos.
            result, error = _run_packingsolver(base + [extra], gap, min(8, remaining - 1))
            row = {
                'candidate': str(extra.get('figure') or ''),
                'ok': bool(result and result.get('ok')),
                'fits': bool(result and result.get('fits')),
                'error': error,
            }
            if result and result.get('fits'):
                valid, certificate = validator(base + [extra], result)
                row['certified'] = bool(valid)
                row['gapMm'] = (certificate or {}).get('minimumGapMmCertified')
                if valid:
                    best = (base + [extra], result, certificate, extra)
                    diagnostics.append(row)
                    break
            diagnostics.append(row)

        if best is None:
            out = dict(payload)
            out.update({
                'hybridCompetition': True,
                'hybridWinner': 'Sparrow',
                'hybridStatus': 'PackingSolver probó reacomodar 10+1; no superó la base certificada',
                'hybridDiagnostics': diagnostics,
            })
            return jsonify(out)

        selected, result, certificate, extra = best
        out = dict(payload)
        out.update({
            'engine': 'Híbrido Sparrow + PackingSolver irregular + Certificador V1.7',
            'completeFigures': len(selected),
            'placements': result.get('placements') or [],
            'density': float(result.get('density') or 0),
            'stripWidthMm': float(result.get('stripWidthMm') or 0),
            'selectionStrategy': str(payload.get('selectionStrategy') or '') + ' · PackingSolver +1: ' + str(extra.get('figure') or ''),
            'targetDensityReached': float(result.get('density') or 0) >= 80.0,
            'minimumGapMm': certificate.get('minimumGapMmCertified'),
            'requiredGapMm': MIN_GAP,
            'productionCertificate': certificate,
            'hybridCompetition': True,
            'hybridWinner': 'PackingSolver',
            'hybridStatus': 'PackingSolver reacomodó la base y agregó una figura completa',
            'hybridDiagnostics': diagnostics,
            'bestSolutionPreserved': True,
        })
        return jsonify(out)
    except Exception as exc:
        out = dict(payload)
        out.update({
            'hybridCompetition': True,
            'hybridWinner': 'Sparrow',
            'hybridStatus': 'Competidor omitido; se conserva Sparrow',
            'hybridDiagnosticError': str(exc)[:220],
            'hybridDiagnostics': diagnostics,
        })
        return jsonify(out)


if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = hybrid_competition
