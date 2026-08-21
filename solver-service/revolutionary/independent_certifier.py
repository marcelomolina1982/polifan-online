from __future__ import annotations

from shapely.affinity import rotate, translate

PLATE_WIDTH_MM = 1220.0
PLATE_HEIGHT_MM = 580.0


def certify_layout(kits, placed_rows, required_gap_mm=3.0, edge_tolerance_mm=0.05):
    """Independently certify Sparrow placements using the prepared Shapely geometry.

    This does not trust Sparrow's feasibility flag. Every returned transformation is
    applied again with Shapely and checked against plate bounds, intersections and
    pairwise Euclidean separation.
    """
    idmap = {}
    item_id = 0
    for kit in kits:
        for part in kit.get('parts') or []:
            idmap[item_id] = part
            item_id += 1

    transformed = []
    missing_ids = []
    for row in placed_rows or []:
        iid = int(row.get('item_id'))
        part = idmap.get(iid)
        if part is None:
            missing_ids.append(iid)
            continue
        tr = row.get('transformation') or {}
        tx, ty = (tr.get('translation') or [0.0, 0.0])[:2]
        angle = float(tr.get('rotation') or 0.0)
        geom = rotate(part['geom'], angle, origin=(0.0, 0.0), use_radians=False)
        geom = translate(geom, xoff=float(tx), yoff=float(ty))
        transformed.append((part['instanceId'], geom))

    outside = []
    for name, geom in transformed:
        minx, miny, maxx, maxy = geom.bounds
        if (
            minx < -edge_tolerance_mm
            or miny < -edge_tolerance_mm
            or maxx > PLATE_WIDTH_MM + edge_tolerance_mm
            or maxy > PLATE_HEIGHT_MM + edge_tolerance_mm
        ):
            outside.append({
                'instanceId': name,
                'boundsMm': [round(minx, 4), round(miny, 4), round(maxx, 4), round(maxy, 4)],
            })

    minimum_gap = None
    minimum_pair = None
    collisions = []
    gap_violations = []
    for i, (name_a, geom_a) in enumerate(transformed):
        for name_b, geom_b in transformed[i + 1:]:
            intersects = bool(geom_a.intersects(geom_b))
            distance = 0.0 if intersects else float(geom_a.distance(geom_b))
            if minimum_gap is None or distance < minimum_gap:
                minimum_gap = distance
                minimum_pair = [name_a, name_b]
            if intersects:
                collisions.append({'a': name_a, 'b': name_b})
            if distance < float(required_gap_mm) - 1e-6:
                gap_violations.append({'a': name_a, 'b': name_b, 'gapMm': round(distance, 6)})

    expected = len(idmap)
    placed = len(transformed)
    ok = (
        placed == expected
        and not missing_ids
        and not outside
        and not collisions
        and not gap_violations
        and minimum_gap is not None
        and minimum_gap >= float(required_gap_mm) - 1e-6
    )
    return {
        'ok': bool(ok),
        'requiredGapMm': float(required_gap_mm),
        'minimumGapMmCertified': None if minimum_gap is None else float(minimum_gap),
        'minimumGapPair': minimum_pair,
        'collisionCount': len(collisions),
        'gapViolationCount': len(gap_violations),
        'outsidePlateCount': len(outside),
        'expectedItems': expected,
        'placedItems': placed,
        'missingItemIds': missing_ids[:8],
        'closestViolations': sorted(gap_violations, key=lambda x: x['gapMm'])[:8],
        'outside': outside[:8],
        'method': 'independent-shapely-transform-check',
    }
