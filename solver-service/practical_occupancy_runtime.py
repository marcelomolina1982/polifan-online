from flask import request, jsonify
import nest_sparrow as ns
from shapely.affinity import rotate, translate
from shapely.geometry import box, Polygon, MultiPolygon
from shapely.ops import unary_union

# LAB interno: medir ocupación útil REAL según lo que Sparrow puede aprovechar.
# Importante: la versión actual de Sparrow/Jagua rechaza multipolígonos y por lo tanto
# no puede colocar piezas dentro de huecos internos. Esos huecos NO deben contarse como
# espacio útil de nesting aunque geométricamente estén vacíos.
_original_nest = ns.nest_sparrow
PLATE = box(0, 0, ns.PLATE_WIDTH_MM, ns.PLATE_HEIGHT_MM)
PLATE_AREA = float(ns.PLATE_WIDTH_MM * ns.PLATE_HEIGHT_MM)


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


def _geometry_for(part, placement):
    g = rotate(part['geom'], float(placement.get('angle') or 0), origin=(0, 0), use_radians=False)
    return translate(g, xoff=float(placement.get('xCm') or 0) * 10.0, yoff=float(placement.get('yCm') or 0) * 10.0)


def _fill_internal_holes(g):
    """Devuelve la huella que Sparrow realmente trata como ocupada.
    Como Sparrow no soporta multipolígonos/huecos, cada anillo interior se rellena.
    """
    if isinstance(g, Polygon):
        return Polygon(g.exterior)
    if isinstance(g, MultiPolygon):
        return MultiPolygon([Polygon(p.exterior) for p in g.geoms if not p.is_empty])
    polys=[p for p in getattr(g,'geoms',[]) if isinstance(p,Polygon) and not p.is_empty]
    if not polys:
        return g
    if len(polys)==1:
        return Polygon(polys[0].exterior)
    return MultiPolygon([Polygon(p.exterior) for p in polys])


def _metrics(payload, data):
    width_mm = max(1.0, ns._n(data.get('widthCm'), 122) * 10)
    height_mm = max(1.0, ns._n(data.get('heightCm'), 58) * 10)
    gap = max(3.0, ns._n(data.get('gapCm'), .3) * 10)
    raw = sorted(data.get('kits') or [], key=lambda k: (ns._priority(k), str(k.get('date') or ''), str(k.get('figure') or '')))[:64]
    parts = {}
    for k in raw:
        try:
            kit = ns._prep_kit(k, width_mm, height_mm)
            for p in kit.get('parts') or []:
                parts[str(p.get('instanceId') or '')] = p
        except Exception:
            pass

    geoms = []
    for pl in payload.get('placements') or []:
        p = parts.get(str(pl.get('instanceId') or ''))
        if not p:
            continue
        try:
            geoms.append(_geometry_for(p, pl))
        except Exception:
            pass
    if not geoms:
        return None

    # Área física real de polifán, conservando huecos.
    material = unary_union(geoms).intersection(PLATE)

    # Huella utilizable por el solver: los huecos internos se consideran bloqueados
    # porque Sparrow actual no puede meter otra pieza dentro de ellos.
    solver_footprints=[_fill_internal_holes(g) for g in geoms]
    blocked = unary_union([g.buffer(gap / 2.0, join_style=2) for g in solver_footprints]).intersection(PLATE)
    free = PLATE.difference(blocked)
    free_polys = [g for g in getattr(free, 'geoms', [free]) if not g.is_empty and getattr(g, 'area', 0) > 0]
    largest_free = max((float(g.area) for g in free_polys), default=0.0)

    material_pct = 100.0 * float(material.area) / PLATE_AREA
    practical_pct = 100.0 * float(blocked.area) / PLATE_AREA
    free_pct = max(0.0, 100.0 - practical_pct)
    return {
        'materialDensityPct': material_pct,
        'practicalOccupancyPct': practical_pct,
        'practicalFreePct': free_pct,
        'largestFreeRegionPct': 100.0 * largest_free / PLATE_AREA,
        'occupancyGapMm': gap,
        'internalHolesUsableBySolver': False,
        'occupancySolverModel': 'sparrow-simple-polygon-holes-blocked',
    }


def nest_with_practical_occupancy():
    original = _original_nest()
    resp, status, payload = _unwrap(original)
    if status >= 400 or not isinstance(payload, dict) or not payload.get('ok'):
        return original
    try:
        metrics = _metrics(payload, request.get_json(silent=True) or {})
    except Exception:
        metrics = None
    if not metrics:
        return original

    out = dict(payload)
    old_density = float(payload.get('density') or 0)
    out.update(metrics)
    out['legacyDensityPct'] = old_density
    out['density'] = float(metrics['practicalOccupancyPct'])
    out['targetDensityReached'] = float(metrics['practicalOccupancyPct']) >= 80.0
    out['occupancyMetric'] = 'solver-aware-blocked-footprint-gap-aware'
    return jsonify(out)


ns.nest_sparrow = nest_with_practical_occupancy
if 'nest_sparrow' in ns.app.view_functions:
    ns.app.view_functions['nest_sparrow'] = nest_with_practical_occupancy
