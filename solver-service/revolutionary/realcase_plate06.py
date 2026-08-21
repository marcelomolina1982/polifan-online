from __future__ import annotations

import base64
import gzip
import json
from pathlib import Path
from shapely.geometry import Polygon
from shapely.geometry.polygon import orient

from revolutionary.ensemble_v1 import revolutionary_solve

CASE_PATH = Path(__file__).resolve().parent / 'cases' / 'plate06_mama_case.gz.b64'
MAX_SOLVER_VERTICES = 240


def _solver_geom(coords):
    """Keep the real raster geometry but reduce solver preprocessing cost.

    Production SVG parsing already caps polygon complexity. The historical case
    was rasterized at ~0.333 mm, so a topology-preserving 0.35..1.25 mm adaptive
    simplification is below the 3 mm production gap and prevents Sparrow from
    spending its whole run preparing overly-dense contours.
    """
    geom=Polygon(coords)
    if not geom.is_valid:
        geom=geom.buffer(0)
    if geom.is_empty:
        raise ValueError('empty geometry')
    if geom.geom_type != 'Polygon':
        geom=max(list(geom.geoms), key=lambda g:g.area)
    tolerance=0.35
    while len(geom.exterior.coords)-1 > MAX_SOLVER_VERTICES and tolerance <= 1.25:
        candidate=geom.simplify(tolerance,preserve_topology=True)
        if not candidate.is_empty and candidate.geom_type == 'Polygon' and candidate.area > 0:
            geom=candidate
        tolerance += 0.15
    # Final deterministic sampling only if an unusually complex contour survives.
    pts=list(geom.exterior.coords)[:-1]
    if len(pts) > MAX_SOLVER_VERTICES:
        step=len(pts)/MAX_SOLVER_VERTICES
        pts=[pts[int(i*step)] for i in range(MAX_SOLVER_VERTICES)]
        geom=Polygon(pts)
        if not geom.is_valid:
            geom=geom.buffer(0)
        if geom.geom_type != 'Polygon':
            geom=max(list(geom.geoms),key=lambda g:g.area)
    return orient(geom,sign=1.0)


def _load_prepared():
    packed = CASE_PATH.read_text(encoding='utf-8').strip()
    payload = json.loads(gzip.decompress(base64.b64decode(packed)).decode('utf-8'))
    pieces = payload.get('pieces') or []
    if len(pieces) != 22:
        raise RuntimeError(f'plate06_mama expected 22 pieces, got {len(pieces)}')

    kits=[]; vertex_counts=[]
    for ki in range(11):
        parts=[]
        for pi, coords in enumerate(pieces[ki*2:ki*2+2]):
            geom=_solver_geom(coords)
            if geom.is_empty:
                raise RuntimeError(f'empty geometry at kit {ki+1} part {pi+1}')
            minx,miny,maxx,maxy=geom.bounds
            area=float(geom.area)
            env=max(1.0,float((maxx-minx)*(maxy-miny)))
            vertex_counts.append(len(geom.exterior.coords)-1)
            parts.append({
                'instanceId':f'plate06-{ki+1:02d}-p{pi}',
                'kitId':f'plate06-{ki+1:02d}',
                'figure':'Mamá manual' if ki == 10 else f'Plate06 kit {ki+1:02d}',
                'name':'base' if pi == 0 else 'tapa',
                'role':'base' if pi == 0 else 'tapa',
                'geom':geom,
                'shape':{'type':'simple_polygon','data':[[float(x),float(y)] for x,y in list(geom.exterior.coords)[:-1]]},
                'trimXmm':0.0,
                'trimYmm':0.0,
                'area':area,
                'envelope':env,
            })
        area=sum(p['area'] for p in parts)
        env=sum(p['envelope'] for p in parts)
        kits.append({
            'kitId':f'plate06-{ki+1:02d}',
            'figure':'Mamá manual' if ki == 10 else f'Plate06 kit {ki+1:02d}',
            'priority':1.0,
            'date':'2026-08-21',
            'parts':parts,
            'area':area,
            'envelope':env,
            'solidity':area/max(1.0,env),
        })
    payload['_solverVertexCounts']=vertex_counts
    return kits, payload


def run_plate06_mama(seconds=105.0):
    kits,payload=_load_prepared()
    result=revolutionary_solve(kits,total_seconds=seconds,max_workers=4)
    result['benchmark']='plate06_mama_real_geometry'
    result['caseResolutionMm']=payload.get('resolutionMm')
    counts=payload.get('_solverVertexCounts') or []
    result['solverVertices']={'max':max(counts) if counts else 0,'total':sum(counts),'pieces':len(counts)}
    result['historicalEngineComplete']=10
    result['manualKnownComplete']=11
    result['passedHistoricalGate']=bool(
        result.get('ok')
        and int(result.get('completeFigures') or 0) >= 11
        and float(result.get('minimumGapMm') or 0.0) >= 3.0
        and int((result.get('productionCertificate') or {}).get('collisionCount') or 0) == 0
        and int((result.get('productionCertificate') or {}).get('outsidePlateCount') or 0) == 0
    )
    return result
