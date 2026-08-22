from __future__ import annotations

import base64, gzip, json, time
from collections import defaultdict
from copy import deepcopy
from pathlib import Path

from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from revolutionary.ensemble_v4 import revolutionary_solve

CASES_DIR = Path(__file__).resolve().parent / 'cases'

CASE_SPECS = {
    'plate02-cactus': {
        'file': 'plate02_cactus_real_case.gz.b64',
        'kind': 'real+manual-known',
        'historicalComplete': 10,
        'manualKnownComplete': 11,
        'seconds': 90.0,
    },
    'plate10-rightstrip': {
        'file': 'plate10_rightstrip_real_case.gz.b64',
        'kind': 'real+derived-extra-pool',
        'historicalComplete': 10,
        'historicalFreeRightMmApprox': 212.0,
        'seconds': 90.0,
        'deriveExtras': 4,
    },
    'homogeneous-real-stress': {
        'file': 'homogeneous_real_stress_case.gz.b64',
        'kind': 'stress-derived-from-real-geometry',
        'seconds': 100.0,
    },
}


def _load_payload(filename):
    raw = base64.b64decode((CASES_DIR / filename).read_text(encoding='utf-8').strip())
    return json.loads(gzip.decompress(raw).decode('utf-8'))


def _prepared_from_payload(payload):
    grouped = defaultdict(list)
    for row in payload.get('pieces') or []:
        grouped[str(row.get('kitId') or '')].append(row)
    kits = []
    for order, (kid, rows) in enumerate(grouped.items()):
        if not kid:
            continue
        parts = []
        for idx, row in enumerate(rows):
            pts = row.get('points') or []
            if len(pts) < 3:
                continue
            g = orient(Polygon([(float(x), float(y)) for x, y in pts]), sign=1.0)
            if not g.is_valid:
                g = g.buffer(0)
            if g.geom_type != 'Polygon':
                g = max(g.geoms, key=lambda q: q.area)
            minx, miny, maxx, maxy = g.bounds
            area = float(g.area)
            env = max(1.0, float((maxx-minx)*(maxy-miny)))
            role = str(row.get('role') or ('base' if idx == 0 else 'tapa'))
            parts.append({
                'instanceId': str(row.get('instanceId') or f'{kid}-p{idx}'),
                'kitId': kid,
                'figure': str(row.get('figure') or kid),
                'name': role,
                'role': role,
                'geom': g,
                'shape': {'type':'simple_polygon','data':[[float(x),float(y)] for x,y in list(g.exterior.coords)[:-1]]},
                'trimXmm': 0.0,
                'trimYmm': 0.0,
                'area': area,
                'envelope': env,
            })
        if not parts:
            continue
        area = sum(p['area'] for p in parts)
        env = sum(p['envelope'] for p in parts)
        kits.append({
            'kitId': kid,
            'figure': str(rows[0].get('figure') or kid),
            'priority': 1.0,
            'date': '2026-08-21',
            'parts': parts,
            'area': area,
            'envelope': env,
            'solidity': area/max(1.0,env),
            '_order': order,
        })
    return kits


def _derive_extra_pool(kits, count):
    complete = [k for k in kits if len(k.get('parts') or []) >= 2]
    ranked = sorted(complete, key=lambda k:(float(k.get('envelope') or 0), -float(k.get('solidity') or 0)))
    out = list(kits)
    for i, src in enumerate(ranked[:max(0, int(count))], 1):
        k = deepcopy(src)
        old = str(k['kitId'])
        new = f'derived-extra-{i:02d}-{old}'
        k['kitId'] = new
        k['figure'] = f"extra copy {src.get('figure') or old}"
        k['priority'] = 2.0
        for j,p in enumerate(k['parts']):
            p['kitId'] = new
            p['figure'] = k['figure']
            p['instanceId'] = f'{new}-p{j}'
        out.append(k)
    return out


def run_case(case_id, seconds=None):
    spec = CASE_SPECS[case_id]
    payload = _load_payload(spec['file'])
    kits = _prepared_from_payload(payload)
    original_kits = len(kits)
    if spec.get('deriveExtras'):
        kits = _derive_extra_pool(kits, spec['deriveExtras'])
    started = time.time()
    result = revolutionary_solve(kits, total_seconds=float(seconds or spec['seconds']), max_workers=4)
    result['benchmarkCase'] = case_id
    result['benchmarkKind'] = spec['kind']
    result['source'] = payload.get('source')
    result['sourceResolutionMm'] = payload.get('resolutionMm')
    result['originalCandidateKits'] = original_kits
    result['candidateKitsUsed'] = len(kits)
    result['historicalComplete'] = spec.get('historicalComplete')
    result['manualKnownComplete'] = spec.get('manualKnownComplete')
    result['historicalFreeRightMmApprox'] = spec.get('historicalFreeRightMmApprox')
    result['benchmarkElapsedSeconds'] = round(time.time()-started, 2)
    result['productionUntouched'] = True
    if case_id == 'plate02-cactus':
        result['passedCaseGate'] = bool(result.get('ok') and int(result.get('completeFigures') or 0) >= 11 and float(result.get('minimumGapMm') or 0) >= 3.0)
    elif case_id == 'plate10-rightstrip':
        result['passedCaseGate'] = bool(result.get('ok') and int(result.get('completeFigures') or 0) >= 10 and float(result.get('minimumGapMm') or 0) >= 3.0)
    else:
        result['passedCaseGate'] = bool(result.get('ok') and float(result.get('minimumGapMm') or 0) >= 3.0)
    return result


def run_suite(seconds_each=None):
    rows = []
    for case_id in CASE_SPECS:
        try:
            r = run_case(case_id, seconds=seconds_each)
            rows.append({
                'case': case_id,
                'ok': bool(r.get('ok')),
                'completeFigures': r.get('completeFigures'),
                'initialCertifiedCount': r.get('initialCertifiedCount'),
                'adaptiveFloorUsed': r.get('adaptiveFloorUsed'),
                'probablePracticalMaximum': r.get('probablePracticalMaximum'),
                'density': r.get('density'),
                'stripWidthMm': r.get('stripWidthMm'),
                'minimumGapMm': r.get('minimumGapMm'),
                'selectionStrategy': r.get('selectionStrategy'),
                'passedCaseGate': r.get('passedCaseGate'),
                'elapsedSeconds': r.get('benchmarkElapsedSeconds'),
            })
        except Exception as exc:
            rows.append({'case':case_id,'ok':False,'passedCaseGate':False,'error':repr(exc)})
    return {
        'ok': all(bool(r.get('passedCaseGate')) for r in rows),
        'engine': 'TVT Revolutionary Ensemble V4.0',
        'suite': 'TVT fixed regression suite v1',
        'cases': rows,
        'productionUntouched': True,
    }
