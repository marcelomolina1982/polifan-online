from __future__ import annotations

import base64, gzip, json
from collections import defaultdict
from pathlib import Path
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

CASES_DIR = Path(__file__).resolve().parent / 'cases'


def load_payload(filename: str):
    text = (CASES_DIR / filename).read_text(encoding='utf-8').strip()
    text += '=' * (-len(text) % 4)
    return json.loads(gzip.decompress(base64.b64decode(text)).decode('utf-8'))


def prepared_from_payload(payload, require_complete_pair: bool = True):
    pieces = payload.get('pieces') or []
    grouped = defaultdict(list)
    if pieces and isinstance(pieces[0], dict):
        for row in pieces:
            grouped[str(row.get('kitId') or '')].append(row)
    else:
        for i, coords in enumerate(pieces):
            kid = f'fixture-{i//2+1:02d}'
            grouped[kid].append({
                'kitId': kid,
                'figure': kid,
                'role': 'base' if i % 2 == 0 else 'tapa',
                'points': coords,
            })

    kits = []
    rejected = []
    for order, (kid, rows) in enumerate(grouped.items()):
        if not kid:
            continue
        parts = []
        roles = set()
        for idx, row in enumerate(rows):
            pts = row.get('points') or []
            if len(pts) < 3:
                continue
            try:
                g = orient(Polygon([(float(x), float(y)) for x, y in pts]), sign=1.0)
                if not g.is_valid:
                    g = g.buffer(0)
                if g.is_empty:
                    continue
                if g.geom_type != 'Polygon':
                    g = max(g.geoms, key=lambda q: q.area)
            except Exception:
                continue
            minx, miny, maxx, maxy = g.bounds
            area = float(g.area)
            env = max(1.0, float((maxx-minx)*(maxy-miny)))
            role = str(row.get('role') or ('base' if idx == 0 else 'tapa')).lower()
            roles.add(role)
            parts.append({
                'instanceId': str(row.get('instanceId') or f'{kid}-p{idx}'),
                'kitId': kid,
                'figure': str(row.get('figure') or kid),
                'name': role,
                'role': role,
                'geom': g,
                'shape': {'type': 'simple_polygon', 'data': [[float(x), float(y)] for x, y in list(g.exterior.coords)[:-1]]},
                'trimXmm': 0.0,
                'trimYmm': 0.0,
                'area': area,
                'envelope': env,
            })

        complete = len(parts) == 2 and ('base' in roles and ('tapa' in roles or 'top' in roles or 'lid' in roles))
        if require_complete_pair and not complete:
            rejected.append({'kitId': kid, 'reason': f'incomplete-kit parts={len(parts)} roles={sorted(roles)}'})
            continue
        if not parts:
            continue

        area = sum(p['area'] for p in parts)
        env = sum(p['envelope'] for p in parts)
        kits.append({
            'kitId': kid,
            'figure': str(rows[0].get('figure') or kid),
            'priority': 1.0,
            'date': '2026-08-22',
            'parts': parts,
            'area': area,
            'envelope': env,
            'solidity': area / max(1.0, env),
            '_order': order,
        })
    return kits, rejected
